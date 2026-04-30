import { Langfuse } from 'langfuse';
import dotenv from 'dotenv';
dotenv.config();

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || "https://cloud.langfuse.com"
});

async function test() {
  console.log("Sending trace to", langfuse.baseUrl, "...");
  const trace = langfuse.trace({
    name: 'test_trace_123',
    input: 'Hello Langfuse',
  });
  
  trace.span({
    name: 'test_span',
    input: 'test',
    output: 'test success'
  });

  await langfuse.flushAsync();
  console.log("Done! Check your dashboard for 'test_trace_123'.");
}

test().catch(console.error);
