import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cors from 'cors';

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
const engine = bm25();
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
    // PHASE 3: CROSS-ENCODER RERANKING (By-passed for performance)
    // ----------------------------------------------------
    // We rely solely on the Reciprocal Rank Fusion (hybridTop10) which provides
    // mathematically excellent ranking without the 4-30s latency penalty of a second LLM cycle.
    let bestDocs = hybridTop10.slice(0, 2);

    // Log retrieval results to observability
    await startActiveObservation("retrieval", async (span) => {
      span.update({ input: { query: optimizedQuery }, output: { dense: denseResults.length, sparse: bm25Results.length, fused: hybridTop10.length, bestDocs: bestDocs.map(d => d.title) } });
    });

    // ----------------------------------------------------
    // PHASE 4: CONTEXT-INJECTED GENERATION
    // ----------------------------------------------------
    const systemInstruction = `
You are a strict customer support routing assistant for DelyvaNow.
Your ONLY task is to evaluate the provided knowledge base articles and return links to them ONLY IF they exactly match the user's query.

RULES:
1. STRICT RELEVANCE CHECK: If the provided articles do not EXPLICITLY answer the exact primary topic the user is asking about (e.g., if they ask for 'refund' but the article is about 'cancellations'), DO NOT return the article.
2. If NO articles are an exact match, you MUST reply ONLY with: "I cannot find an article about that. Please contact our live chat team."
3. DO NOT answer the user's question directly. Only provide links.
4. If there are relevant articles, reply ONLY with a short, polite message containing the link(s) formatted strictly in Markdown like this: 1. [Article Title](URL)
5. DO NOT make up URLs or hallucinate articles.

POTENTIAL KNOWLEDGE BASE MATCHES (You must evaluate these strictly, they might be completely irrelevant):
${JSON.stringify(bestDocs)}`;

    console.log(`Sending final prompt to: ${selectedModel || "gemini-2.5-flash-lite"} with ${bestDocs.length} perfect documents...`);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // ----------------------------------------------------
    // GROQ API CALL (Llama 4 Scout 17B)
    // ----------------------------------------------------
    if (selectedModel === "Llama 4 Scout 17B") {
      const mappedHistory = history.map(h => ({
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
      contents: history,
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
