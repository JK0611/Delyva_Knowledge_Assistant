import dotenv from 'dotenv';
dotenv.config();

async function testGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    console.error("GROQ_API_KEY is not set correctly in .env");
    return;
  }

  const prompt = `You are a customer support routing assistant for DelyvaNow.
Your ONLY task is to direct the user to ALL relevant articles from the highly verified knowledge base chunk provided below.

RULES:
1. DO NOT answer the user's question directly.
2. INSTEAD, use the provided matching articles below and reply ONLY with a short, polite message containing the link(s).
3. If there are multiple relevant articles, list ALL of them as a numbered list.
4. Format the links strictly in Markdown like this: 1. [Article Title](URL)

KNOWLEDGE BASE DATA:
[
  {
    "title": "What to do if courier does not show up?",
    "url": "https://delyva.com/my/blog/kb/what-to-do-if-courier-does-not-show-up/",
    "content": "The usual pick-up time for courier service is from 9 am – 6 pm..."
  }
]

User Query: "no pick up"`;

  console.log("Sending request to Groq API (meta-llama/llama-4-scout-17b-16e-instruct)...");

  const startTime = performance.now();

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "meta-llama/llama-4-scout-17b-16e-instruct",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 150
      })
    });

    const data = await response.json();
    const endTime = performance.now();

    if (!response.ok) {
      console.error("Error from API:", data);
      return;
    }

    console.log("\n--- RESPONSE ---");
    console.log(data.choices[0].message.content);
    console.log("----------------\n");
    console.log(`Time taken: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

  } catch (err) {
    console.error("Fetch failed:", err);
  }
}

testGroq();
