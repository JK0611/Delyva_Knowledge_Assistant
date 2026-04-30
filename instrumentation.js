import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import dotenv from "dotenv";

dotenv.config();

const sdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_BASEURL || process.env.LANGFUSE_HOST || "https://cloud.langfuse.com",
    }),
  ],
});

if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
  sdk.start();
  console.log("Langfuse OpenTelemetry observability initialized.");
} else {
  console.log("No Langfuse keys found. Observability disabled.");
}

export { sdk };
