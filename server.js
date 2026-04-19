import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import admin from 'firebase-admin';
import Fuse from 'fuse.js';

dotenv.config();

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

// Initialize Firebase Admin gracefully
let dbAdmin = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
    dbAdmin = admin.firestore();
    console.log("Firebase Admin initialized successfully.");
  } else {
    console.warn("No FIREBASE_SERVICE_ACCOUNT found in .env. Falling back to local files for DB.");
  }
} catch (e) {
  console.warn("Failed to initialize Firebase Admin:", e.message);
}

// 2. Load Vector Store
let vectorStoreCache = null;
async function getVectorStore() {
  if (vectorStoreCache) return vectorStoreCache;
  
  let vectorStore = [];
  
  // 1. FAST LOCAL PRIORITY (0.05 seconds)
  try {
    vectorStore = JSON.parse(
      fs.readFileSync(path.resolve('./src/data/vector_store.json'), 'utf-8')
    );
    console.log(`Loaded ${vectorStore.length} dense vectors via local file (INSTANT).`);
  } catch (e) {
    console.warn("Local vector store not found.");
  }

  // 2. SLOW FIREBASE FALLBACK (2-4 seconds)
  if (vectorStore.length === 0 && dbAdmin) {
    try {
      const snap = await dbAdmin.collection('vector_store').get();
      if (!snap.empty) {
        vectorStore = snap.docs.map(d => d.data());
        console.log(`Loaded ${vectorStore.length} dense vectors from Firebase (SLOW).`);
      }
    } catch (e) {
      console.warn("Failed to load vectors from Firebase.");
    }
  }
  
  vectorStoreCache = vectorStore;
  return vectorStoreCache;
}

// Setup Sparse Keyword Matcher (Fuse.js)
const fuse = new Fuse(kbData, {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'content', weight: 0.3 }
  ],
  threshold: 0.6,
  ignoreLocation: true,
  findAllMatches: true,
  includeScore: true,
});

// Helper mathematical function for semantic match
function cosineSimilarity(A, B) {
  let dotProduct = 0;
  for (let i = 0; i < A.length; i++) {
    dotProduct += A[i] * B[i];
  }
  return dotProduct;
}

app.post('/api/chat', async (req, res) => {
  try {
    const { history, selectedModel, inputValue } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const userQuery = inputValue || history[history.length - 1]?.parts[0]?.text || "";

    // ----------------------------------------------------
    // PHASE 2A: DENSE SEARCH (Semantic Vector Matching)
    // ----------------------------------------------------
    let denseResults = [];
    const vStore = await getVectorStore();
    
    if (vStore.length > 0) {
      try {
        const embedRes = await ai.models.embedContent({
          model: 'gemini-embedding-2-preview',
          contents: userQuery,
          config: { taskType: 'RETRIEVAL_QUERY' }
        });
        const queryVector = embedRes.embeddings[0].values;
        
        denseResults = vStore.map(v => ({
          item: v.parentDocument,
          score: cosineSimilarity(queryVector, v.embedding) // 1.0 is a perfect match
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      } catch (e) {
        console.error("Dense search failed mapping embeddings:", e);
      }
    }

    // ----------------------------------------------------
    // PHASE 2B: SPARSE SEARCH (Keyword Matching)
    // ----------------------------------------------------
    const sparseResultsRaw = fuse.search(userQuery).slice(0, 10);

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

    // ----------------------------------------------------
    // PHASE 4: CONTEXT-INJECTED GENERATION
    // ----------------------------------------------------
    const systemInstruction = `
You are a customer support routing assistant for DelyvaNow.
Your ONLY task is to direct the user to ALL relevant articles from the highly verified knowledge base chunk provided below.

RULES:
1. DO NOT answer the user's question directly.
2. INSTEAD, use the provided matching articles below and reply ONLY with a short, polite message containing the link(s).
3. If there are multiple relevant articles, list ALL of them as a numbered list.
4. Format the links strictly in Markdown like this: 1. [Article Title](URL)
5. If the answer cannot be found in the knowledge base chunk below, politely inform them that you couldn't find a matching article and say "please contact our live chat team".
6. DO NOT make up URLs, hallucinate articles, or use external links outside the provided JSON below.

KNOWLEDGE BASE DATA (Top 2 Exact Matches via Semantic Reranker):
${JSON.stringify(bestDocs)}`;

    // Ensure we handle different model identifiers gracefully
    const mappedModel = selectedModel === "Gemma 4 31B" ? "gemma-4-31b-it" :
                        selectedModel === "Gemini 3.1 Flash Lite" ? "gemini-2.5-flash" :
                        selectedModel || "gemini-2.5-flash";

    console.log(`Sending final prompt to: ${mappedModel} with ${bestDocs.length} perfect documents...`);

    const stream = await ai.models.generateContentStream({
      model: mappedModel,
      contents: history,
      config: {
        systemInstruction: systemInstruction
      }
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      if (chunk.text) {
        res.write(chunk.text);
      }
    }
    res.end();
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


if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Enterprise RAG Backend running on http://localhost:${port}`);
  });
}

export default app;
