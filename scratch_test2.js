async function test() {
  try {
    const res = await fetch('https://faq-bot-w8yp.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: [
          { role: 'model', parts: [{ text: "Hello! How can i help you today?" }] },
          { role: 'user', parts: [{ text: "hello" }] }
        ],
        selectedModel: "Gemini 3.1 Flash Lite",
        inputValue: "hello"
      })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Body:", text);
  } catch (e) {
    console.error(e);
  }
}
test();
