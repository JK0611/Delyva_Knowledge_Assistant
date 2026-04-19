async function test() {
  const start = Date.now();
  try {
    const res = await fetch('https://faq-bot-one.vercel.app/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        history: [{ role: 'user', parts: [{ text: "what is delyva" }] }],
        selectedModel: "gemini-2.5-flash",
        inputValue: "what is delyva"
      })
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Time Taken (ms):", Date.now() - start);
  } catch (e) {
    console.error(e);
  }
}
test();
