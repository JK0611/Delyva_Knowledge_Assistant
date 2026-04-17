import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

// Load environment config
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY });

async function buildVectorDB() {
  try {
    const kbPath = path.join(__dirname, '../src/data/kb.json');
    const kbRaw = await fs.readFile(kbPath, 'utf-8');
    const kbData = JSON.parse(kbRaw);

    console.log(`Loaded ${kbData.length} articles from kb.json`);
    
    // The vector store will map vectors to their parent chunk IDs
    const vectorStore = [];

    // Process entirely sequentially to respect standard API rate limits 
    // Usually, you might batch requests depending on the Google Gen AI API rate constraints
    let count = 0;
    for (const item of kbData) {
      // Create a semantic chunk mapping representation
      // We combine tags and summary text to build a mathematically dense target
      const semanticTarget = `Title: ${item.title}\nTags: ${item.tags ? item.tags.join(', ') : 'None'}\nSummary: ${item.content.substring(0, 500)}`;
      
      console.log(`[${count + 1}/${kbData.length}] Embedding: ${item.title}...`);

      const response = await ai.models.embedContent({
        model: 'gemini-embedding-2-preview',
        contents: semanticTarget,
        config: {
          taskType: 'RETRIEVAL_DOCUMENT' // optimized for database storage
        }
      });

      vectorStore.push({
        id: count,
        title: item.title,
        tags: item.tags,
        // The original large item gets kept untouched for standard retrieval
        parentDocument: item, 
        embedding: response.embeddings[0].values // mathematical vector representation
      });

      count++;
      
      // Simple rate limit backoff (avoid 429 quota exhausted limits during massive batch processing)
      // 1000ms delay helps on standard free-tier endpoints
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const outPath = path.join(__dirname, '../src/data/vector_store.json');
    await fs.writeFile(outPath, JSON.stringify(vectorStore));
    console.log(`\nSuccess! Wrote ${vectorStore.length} dense vectors to src/data/vector_store.json`);
  } catch (err) {
    console.error("Vector DB Build Error:", err);
  }
}

buildVectorDB();
