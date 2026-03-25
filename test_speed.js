import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function testModel(modelName) {
  const start = Date.now();
  console.log(`Testing ${modelName}...`);
  try {
    const res = await ai.models.generateContent({
        model: modelName,
        contents: "Hi, respond with 'hello' only."
    });
    console.log(`${modelName} took ${Date.now() - start}ms`);
  } catch (e) {
    console.log(`${modelName} err:`, e.message);
  }
}

async function run() {
  await testModel('gemini-3.1-flash-lite-preview');
  await testModel('gemini-3.1-flash-image-preview');
  await testModel('gemini-2.5-flash-lite');
  await testModel('gemini-2.0-flash-lite');
  await testModel('gemini-flash-lite-latest');
  await testModel('gemini-2.0-flash');
}
run();
