import express from 'express';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import Fuse from 'fuse.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Load knowledge base
const kbData = JSON.parse(
  fs.readFileSync(path.resolve('./src/data/kb.json'), 'utf-8')
);

// Setup Fuse.js for fuzzy search (RAG mechanism)
const fuse = new Fuse(kbData, {
  keys: [
    { name: 'title', weight: 0.7 },
    { name: 'content', weight: 0.3 }
  ],
  threshold: 0.6,       // 0.6 is much looser, ensuring we catch partial sentence matches
  ignoreLocation: true, // Don't penalize matches found deep inside
  findAllMatches: true,
  includeScore: true,
});

app.post('/api/chat', async (req, res) => {
  try {
    const { history } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
    }

    // Extract the latest user question to use for our local RAG search
    const latestUserMessage = history[history.length - 1]?.parts[0]?.text || "";

    // Search the KB for the top relevant articles (Increased to top 5)
    const searchResults = fuse.search(latestUserMessage);
    const topResults = searchResults.slice(0, 5).map(result => result.item);

    // Provide only the injected TOP 5 results to Gemini instead of the whole file
    const systemInstruction = `
You are a customer support routing assistant for DelyvaNow.
Your ONLY task is to direct the user to ALL relevant articles from the provided JSON knowledge base.

RULES:
1. DO NOT answer the user's question directly.
2. INSTEAD, use the provided matching articles below and reply ONLY with a short, polite message containing the link(s) to those articles.
3. If there are multiple relevant articles, list ALL of them as bullet points.
4. Format the links strictly in Markdown like this: - [Article Title](URL)
5. If the answer cannot be found in the provided knowledge base chunk below, politely inform them that you couldn't find a matching article and say "please contact our live chat team".
6. DO NOT make up URLs, hallucinate articles, or use external links outside the provided JSON below.

KNOWLEDGE BASE DATA (Top Relevant Results Only):
${JSON.stringify(topResults)}
    `;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    // Gemma 3 does not support systemInstruction config, so append it to the last user message
    if (history.length > 0) {
      history[history.length - 1].parts[0].text = systemInstruction + '\n\nUSER QUESTION:\n' + history[history.length - 1].parts[0].text;
    }

    // Call Gemma 3 27B Intruct model
    const response = await ai.models.generateContent({
      model: 'text-embedding-004',
      contents: history
    });

    res.json({ text: response.text });
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    res.status(500).json({ error: 'Failed to generate response' });
  }
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});
