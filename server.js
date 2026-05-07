import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import * as cheerio from 'cheerio';

import bm25 from 'wink-bm25-text-search';
import winkNLP from 'wink-nlp-utils';
import * as lancedb from '@lancedb/lancedb';
import './instrumentation.js';
import { startActiveObservation } from '@langfuse/tracing';

dotenv.config();

// Initialize Google AI client once (reused across all requests)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });



// Retry wrapper for external API calls (handles 429/503 gracefully)
async function fetchWithRetry(url, options, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    if (res.ok || (res.status !== 429 && res.status !== 503)) return res;
    console.warn(`Retry ${i + 1}/${retries} for ${res.status} on ${url}`);
    await new Promise(r => setTimeout(r, 1000 * (i + 1)));
  }
  return fetch(url, options); // final attempt
}

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 1. Load Knowledge Base
let kbData = [];
try {
  kbData = JSON.parse(
    fs.readFileSync(path.resolve('./src/data/kb.json'), 'utf-8')
  );
  console.log(`Loaded ${kbData.length} baseline KB items.`);
} catch (e) {
  console.error("Failed to load kb.json");
}


// 2. Load Vector Store (LanceDB - O(log N) indexed search)
let lanceTable = null;
async function getLanceTable() {
  if (lanceTable) return lanceTable;
  try {
    const db = await lancedb.connect('./src/data/lancedb');
    lanceTable = await db.openTable('vectors');
    const count = await lanceTable.countRows();
    console.log(`LanceDB loaded with ${count} vectors (IVF-PQ indexed).`);
  } catch (e) {
    console.warn("LanceDB not found. Run 'node migrate_to_lancedb.mjs' first.", e.message);
  }
  return lanceTable;
}

// Setup Sparse Keyword Matcher (BM25)
let engine = bm25();

function rebuildBM25Engine() {
  engine = bm25();
  engine.defineConfig({ fldWeights: { title: 2, content: 1 } });
  engine.definePrepTasks([
    winkNLP.string.lowerCase, 
    winkNLP.string.tokenize0, 
    winkNLP.tokens.removeWords, 
    winkNLP.tokens.stem,
    winkNLP.tokens.propagateNegations
  ]);

  kbData.forEach((doc, i) => {
    engine.addDoc(doc, i);
  });
  engine.consolidate();
  console.log(`BM25 Engine consolidated with ${kbData.length} documents.`);
}

rebuildBM25Engine();

app.post('/api/chat', async (req, res) => {
  try {
    const { history, selectedModel, inputValue } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const userQuery = inputValue || history[history.length - 1]?.parts[0]?.text || "";

    // Start observability trace for this request
    await startActiveObservation("chat", async (traceSpan) => {
      traceSpan.update({ input: userQuery, metadata: { model: selectedModel } });

      // ----------------------------------------------------
    // PHASE 1.5 & 2: SEARCH WITH OPTIONAL REWRITE
    // ----------------------------------------------------
    let optimizedQuery = userQuery;
    let textToEmbed = userQuery;
    let denseResults = [];
    let bm25Results = [];
    let sparseResultsRaw = [];

    const performSearch = async (q, embedText) => {
      let dRes = [];
      const table = await getLanceTable();
      if (table) {
        try {
          const embedRes = await ai.models.embedContent({
            model: 'gemini-embedding-2-preview',
            contents: embedText,
            config: { taskType: 'RETRIEVAL_QUERY' }
          });
          const queryVector = embedRes.embeddings[0].values;
          
          // LanceDB handles the math internally with IVF-PQ indexing
          const results = await table.vectorSearch(queryVector).limit(10).toArray();
          dRes = results.map(row => ({
            item: { title: row.title, category: row.category, url: row.url, content: row.content },
            score: 1 - row._distance,
            distance: row._distance
          }));
        } catch (e) {
          console.error("Dense search failed (LanceDB):", e);
        }
      }

      // BM25 excels at exact keyword matching with TF-IDF weighting.
      const bRes = engine.search(q).slice(0, 10);
      const sResRaw = bRes.map(res => ({
        item: kbData[res[0]], // res[0] is the document index
        score: res[1]         // res[1] is the bm25 score
      }));

      return { dRes, bRes, sResRaw };
    };

    // 1. Initial Search
    let searchOutput = await performSearch(userQuery, userQuery);
    denseResults = searchOutput.dRes;
    bm25Results = searchOutput.bRes;
    sparseResultsRaw = searchOutput.sResRaw;

    // 2. Evaluate if we "failed to find something"
    const bestDenseDist = denseResults.length > 0 ? denseResults[0].distance : 1.0;
    // We consider it a failure if BM25 found absolutely no keywords, or if the best dense result is very far (> 0.65 L2 distance)
    const failedToFind = bm25Results.length === 0 || bestDenseDist > 0.65;

    if (failedToFind && process.env.GROQ_API_KEY) {
        console.log(`Poor initial search results (BM25: ${bm25Results.length}, Dense L2: ${bestDenseDist.toFixed(3)}). Rewriting query...`);
        try {
            const rewriteRes = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    response_format: { type: "json_object" },
                    messages: [{
                        role: "system",
                        content: "You are a search optimizer. The user's query failed to find results. 1. First, fix grammar and typos. 2. Do NOT change the meaning too much; rewrite with almost similar meaning. 3. Write a short, fake hypothetical answer to help semantic search. Output EXACTLY in JSON format: {\"query\": \"optimized question\", \"answer\": \"fake answer\"}"
                    }, {
                        role: "user",
                        content: userQuery
                    }],
                    temperature: 0.1,
                    max_tokens: 150
                })
            });
            if (rewriteRes.ok) {
                const rewriteData = await rewriteRes.json();
                try {
                    const parsed = JSON.parse(rewriteData.choices[0].message.content);
                    optimizedQuery = parsed.query || userQuery;
                    textToEmbed = optimizedQuery + "\n" + (parsed.answer || "");
                    console.log(`SLM Optimized Query: "${optimizedQuery}"`);
                    
                    // 3. Retry Search with Rewritten Query
                    searchOutput = await performSearch(optimizedQuery, textToEmbed);
                    denseResults = searchOutput.dRes;
                    bm25Results = searchOutput.bRes;
                    sparseResultsRaw = searchOutput.sResRaw;
                } catch(err) {
                    optimizedQuery = rewriteData.choices[0].message.content;
                    textToEmbed = optimizedQuery;
                }
            }
        } catch (e) {
            console.error("SLM Rewrite failed.", e);
        }
    }

    // Log query rewrite to observability
    if (optimizedQuery !== userQuery) {
      await startActiveObservation("query_rewrite", async (span) => {
        span.update({ input: { original: userQuery }, output: { optimized: optimizedQuery } });
      });
    }

    // ----------------------------------------------------
    // PHASE 2C: HYBRID FUSION (Reciprocal Rank Fusion - RRF)
    // ----------------------------------------------------
    const fusionScores = new Map();
    const k = 60; // Standard RRF mathematical constant
    
    // Give dense semantic rank scores
    denseResults.forEach((doc, rank) => {
      const title = doc.item.title;
      fusionScores.set(title, { item: doc.item, score: 1 / (k + rank + 1) });
    });

    // Merge sparse keyword rank scores
    sparseResultsRaw.forEach((doc, rank) => {
      const title = doc.item.title;
      if (fusionScores.has(title)) {
        const current = fusionScores.get(title);
        current.score += 1 / (k + rank + 1);
      } else {
        fusionScores.set(title, { item: doc.item, score: 1 / (k + rank + 1) });
      }
    });

    const hybridTop10 = Array.from(fusionScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(x => x.item);

    // ----------------------------------------------------
    // PHASE 3: INTELLIGENT RERANKING (LLM-Based Cross-Encoder Alternative)
    // ----------------------------------------------------
    let bestDocs = hybridTop10.slice(0, 2); // Default fallback

    if (hybridTop10.length > 0 && process.env.GROQ_API_KEY) {
      console.log("Triggering LLM Reranker for top 5 candidates...");
      try {
        const top5 = hybridTop10.slice(0, 5);
        const docsForRerank = top5.map((d, i) => `[DOC ${i}]: ${d.title}\n${d.content.substring(0, 300)}`).join('\n\n');

        const rerankPrompt = `You are a strict relevance reranker. 
User Query: "${optimizedQuery}"

Evaluate these 5 documents. Return a JSON object with a single key "best_indices" containing an array of the indices (0-4) of the 1 or 2 most relevant documents, ordered from best to worst. 
If no document answers the query perfectly, return an empty array [].

Documents:
${docsForRerank}`;

        const rerankRes = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: rerankPrompt }],
            temperature: 0.1,
            max_tokens: 50
          })
        });

        if (rerankRes.ok) {
          const rerankData = await rerankRes.json();
          const parsed = JSON.parse(rerankData.choices[0].message.content);
          if (parsed.best_indices && Array.isArray(parsed.best_indices)) {
             if (parsed.best_indices.length > 0) {
               bestDocs = parsed.best_indices.map(idx => top5[idx]).filter(Boolean).slice(0, 2);
               console.log(`LLM Reranker selected indices: ${parsed.best_indices}`);
             } else {
               bestDocs = [];
               console.log("LLM Reranker decided no documents were relevant.");
             }
          }
        }
      } catch (e) {
        console.error("LLM Reranking failed, falling back to RRF top 2.", e);
      }
    }

    // Log retrieval results to observability
    await startActiveObservation("retrieval", async (span) => {
      span.update({ input: { query: optimizedQuery }, output: { dense: denseResults.length, sparse: bm25Results.length, fused: hybridTop10.length, bestDocs: bestDocs.map(d => d.title) } });
    });

    // ----------------------------------------------------
    // PHASE 4: CONTEXT-INJECTED GENERATION
    // ----------------------------------------------------
    const contextText = bestDocs.map((d, index) => {
      const preFormattedLink = d.url && d.url.startsWith('http') ? `[${d.title}](${d.url})` : null;
      return `Article ${index + 1}:\nTitle: ${d.title}\nURL: ${d.url}\n${preFormattedLink ? `Pre-formatted link: ${preFormattedLink}` : ''}\nContent: ${d.content}`;
    }).join('\n\n');

    const systemInstruction = `
You are a customer support assistant for DelyvaNow.
Your task is to help users find answers based ONLY on the provided knowledge base articles.

RULES:
1. WEB LINKS (Priority): If a relevant article has a real web URL (starting with "http"), do NOT answer the question directly. Instead, output ONLY the "Pre-formatted link" value from the article EXACTLY as-is. Do NOT modify, rewrite, or remove any part of it. Copy it character for character.
2. UPLOADED FILES: If the most relevant article has a URL of "uploaded-file", you MUST read the provided content and answer the user's question directly and concisely in text. Do NOT provide the link "uploaded-file".
3. STRICT RELEVANCE: If the provided articles do not answer the user's specific query, you MUST reply: "I cannot find an article about that. Please contact our live chat team."
4. DO NOT make up information or URLs outside of the provided context.

POTENTIAL KNOWLEDGE BASE MATCHES:
${contextText}`;

    console.log(`Sending final prompt to: ${selectedModel || "gemini-2.5-flash-lite"} with ${bestDocs.length} perfect documents...`);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // ----------------------------------------------------
    // GROQ API CALL (Llama 4 Scout 17B)
    // ----------------------------------------------------
    if (selectedModel === "Llama 4 Scout 17B") {
      const mappedHistory = history.slice(-6).map(h => ({
        role: h.role === 'model' ? 'assistant' : 'user',
        content: h.parts[0].text
      }));
      
      mappedHistory.unshift({ role: "system", content: systemInstruction });

      const groqRes = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: mappedHistory,
          temperature: 0,
          max_tokens: 250,
          stream: false // Groq is so fast (0.6s) we don't need SSE streaming overhead
        })
      });

      const data = await groqRes.json();
      if (!groqRes.ok) {
        throw new Error(data.error?.message || "Groq API Error");
      }

      const reply = data.choices[0].message.content;
      res.write(reply);
      await startActiveObservation("llm", async (span) => {
        span.update({ model: 'llama-4-scout-17b', input: systemInstruction.substring(0, 200), output: reply });
      }, { asType: "generation" });
      res.end();
      return;
    }

    // ----------------------------------------------------
    // GEMINI API CALL (Fallback/Alternative)
    // ----------------------------------------------------
    const mappedModel = selectedModel === "Gemini 3.1 Flash Lite" ? "gemini-3.1-flash-lite-preview" : "gemini-2.5-flash-lite";

    const stream = await ai.models.generateContentStream({
      model: mappedModel,
      contents: history.slice(-6),
      config: {
        systemInstruction: systemInstruction
      }
    });

    let geminiReply = '';
    for await (const chunk of stream) {
      if (chunk.text) {
        geminiReply += chunk.text;
        res.write(chunk.text);
      }
    }
    await startActiveObservation("llm", async (span) => {
      span.update({ model: mappedModel, input: systemInstruction.substring(0, 200), output: geminiReply });
    }, { asType: "generation" });
    res.end();
  }); // End of chat traceSpan
  } catch (error) {
    console.error('Error in /api/chat execution:', error);
    if (!res.headersSent) {
      // Return details to the frontend if error happens
      res.status(error.status || 500).json({ 
        error: 'Failed to generate response', 
        details: error.message 
      });
    } else {
      res.end();
    }
  }
});

// Setup multer for in-memory file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Fetch recent uploads (last 20)
app.get('/api/kb-recent', (req, res) => {
  try {
    const recent = kbData.slice(-20).reverse();
    res.json(recent);
  } catch (e) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// Delete an entry from KB and LanceDB
app.post('/api/kb-delete', async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url && !title) return res.status(400).json({ error: "Missing identifier" });

    // 1. Remove from kb.json
    const initialLength = kbData.length;
    // Remove exact match OR anything starting with "Title [Part"
    kbData = kbData.filter(doc => {
      const isExact = (doc.url === url && doc.title === title);
      const isPart = (doc.url === url && doc.title.startsWith(`${title} [Part `));
      return !(isExact || isPart);
    });
    
    if (kbData.length === initialLength) {
      return res.status(404).json({ error: "Entry not found" });
    }

    fs.writeFileSync(path.resolve('./src/data/kb.json'), JSON.stringify(kbData, null, 2), 'utf-8');

    // 2. Remove from LanceDB
    const table = await getLanceTable();
    if (table) {
      // Delete exact OR prefix match
      await table.delete(`url = "${url}" AND (title = "${title}" OR title LIKE "${title} [Part %")`);
    }

    // 3. Rebuild BM25
    rebuildBM25Engine();

    res.json({ success: true });
  } catch (error) {
    console.error("Delete failed:", error);
    res.status(500).json({ error: "Delete failed" });
  }
});

// AI-powered intelligent chunking (Semantic/Agentic)
async function getAgenticChunks(text, title) {
  try {
    const chunkPrompt = `You are a document processing expert. I have text from "${title}". 
    Split this into logical, self-contained sections (chunks). 
    DO NOT summarize; keep original detail. 
    Aim for 600-1200 characters per chunk. 
    Return a VALID JSON array of strings: ["chunk1", "chunk2", ...]
    
    TEXT:
    ${text.substring(0, 20000)}`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: [{ role: 'user', parts: [{ text: chunkPrompt }] }]
    });
    const responseText = (result.text || "").trim();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : [text];
  } catch (e) {
    console.error("Agentic chunking failed:", e);
    return [text];
  }
}

app.post('/api/update-kb', upload.array('files'), async (req, res) => {
  try {
    const { type, urls } = req.body;
    let newDocs = [];

    if (type === 'file' && req.files) {
      for (const file of req.files) {
        if (file.mimetype === 'application/pdf') {
          // 1. Use LangChain PDFLoader
          const blob = new Blob([file.buffer]);
          const loader = new PDFLoader(blob);
          const docs = await loader.load();
          const fullText = docs.map(d => d.pageContent).join('\n');

          // 2. Generate Metadata with AI
          let generatedTitle = file.originalname;
          let generatedCategory = "PDF Document";
          try {
            const metaPrompt = `Analyze this PDF content and return a JSON object with "title" and "category". 
            Title: descriptive, Category: one-word (e.g., Shipping, Account, API). 
            Text: ${fullText.substring(0, 2000)}`;
            const metaRes = await ai.models.generateContent({
              model: "gemini-2.5-flash-lite",
              contents: [{ role: 'user', parts: [{ text: metaPrompt }] }]
            });
            const metaJson = JSON.parse((metaRes.text || "").match(/\{[\s\S]*\}/)[0]);
            generatedTitle = metaJson.title;
            generatedCategory = metaJson.category;
          } catch (e) { console.error("AI metadata failed:", e); }

          // 3. Agentic Chunking
          const chunks = await getAgenticChunks(fullText, generatedTitle);
          chunks.forEach((chunk, i) => {
            newDocs.push({
              title: chunks.length > 1 ? `${generatedTitle} [Part ${i+1}]` : generatedTitle,
              url: "uploaded-file",
              category: generatedCategory,
              content: chunk
            });
          });
        }
      }
    } else if (type === 'url' && urls) {
      const parsedUrls = JSON.parse(urls);
      for (const url of parsedUrls) {
        try {
          const response = await fetchWithRetry(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const html = await response.text();
          const $ = cheerio.load(html);
          
          $('script, style, noscript, iframe, header, footer, nav, aside, svg, button, form, .menu, #menu, .mobile-menu, .search-modal, .skip-link, .skip-to-content').remove();
          $('#header, #footer, .header, .footer, .nav, .navigation, .sidebar, #sidebar, .widgets, .related-posts, .social-share').remove();
          
          const contentSelectors = ['main', 'article', '#content', '.content', '#main', '.main-content', '.post-content', '.entry-content', 'body'];
          let mainContent = null;
          for (const selector of contentSelectors) {
            const found = $(selector);
            if (found.length > 0) { mainContent = found.first(); break; }
          }
          
          let rawContent = (mainContent || $('body')).text().replace(/\s+/g, ' ').trim();
          let cleanedContent = rawContent;
          
          // AI Clean
          try {
            const cleanPrompt = `Extract ONLY the primary informative content from this scraped text. Remove noise. 
            Keep original detail.
            TEXT: ${rawContent.substring(0, 10000)}`;
            const cleanRes = await ai.models.generateContent({
              model: "gemini-2.5-flash-lite",
              contents: [{ role: 'user', parts: [{ text: cleanPrompt }] }]
            });
            cleanedContent = (cleanRes.text || "").trim();
          } catch (e) { console.error("AI cleaning failed:", e); }

          const pageTitle = $('title').text() || url;
          const chunks = await getAgenticChunks(cleanedContent, pageTitle);
          
          chunks.forEach((chunk, i) => {
            newDocs.push({
              title: chunks.length > 1 ? `${pageTitle} [Part ${i+1}]` : pageTitle,
              url: url,
              category: "Web Link",
              content: chunk
            });
          });
        } catch (e) { console.error(`Failed URL ${url}:`, e); }
      }
    }

    if (newDocs.length === 0) {
      return res.status(400).json({ error: "No valid content found to update." });
    }

    // 1. Update LanceDB
    const table = await getLanceTable();
    if (table) {
      const lanceRows = [];
      for (const doc of newDocs) {
        // Generate embedding
        const embedRes = await ai.models.embedContent({
          model: 'gemini-embedding-2-preview',
          contents: doc.title + "\\n" + doc.content,
          config: { taskType: 'RETRIEVAL_DOCUMENT' }
        });
        
        lanceRows.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          title: doc.title,
          category: doc.category,
          url: doc.url,
          content: doc.content,
          vector: embedRes.embeddings[0].values
        });
      }
      
      await table.add(lanceRows);
      console.log(`Added ${lanceRows.length} new documents to LanceDB.`);
    }

    // 2. Update BM25 Engine
    newDocs.forEach((doc) => {
      kbData.push(doc);
    });
    rebuildBM25Engine();

    // 3. Update kb.json file
    fs.writeFileSync(path.resolve('./src/data/kb.json'), JSON.stringify(kbData, null, 2), 'utf-8');

    res.json({ success: true, count: newDocs.length });
  } catch (error) {
    console.error("Error updating KB:", error);
    res.status(500).json({ error: "Failed to update database: " + error.message });
  }
});

// Health check endpoint (used by self-ping to prevent Render sleep)
app.get('/health', (req, res) => res.send('OK'));

// Serve the static React frontend in production
app.use(express.static(path.join(process.cwd(), 'dist')));

// Fallback all other routes to React Router (if you add routing later)
app.get('*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
});

// Always start the server (Render requires binding to a port)
app.listen(port, () => {
  console.log(`Enterprise RAG Backend running on port ${port}`);
});

// Self-ping to prevent Render free tier from sleeping (spins down after 15 min inactivity)
if (process.env.RENDER_EXTERNAL_URL) {
  const PING_INTERVAL = 14 * 60 * 1000; // 14 minutes
  setInterval(() => {
    fetch(`${process.env.RENDER_EXTERNAL_URL}/health`)
      .then(() => console.log(`Keep-alive ping sent to ${process.env.RENDER_EXTERNAL_URL}/health`))
      .catch(() => {});
  }, PING_INTERVAL);
  console.log(`Keep-alive enabled: pinging ${process.env.RENDER_EXTERNAL_URL}/health every 14 min.`);
}

export default app;
