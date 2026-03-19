import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  try {
    const list = await ai.models.list();
    // In SDK 1.29.0, it might return an async iterator
    for await (const model of list) {
        if (model.name.includes("gemma")) {
            console.log(model.name);
        }
    }
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
