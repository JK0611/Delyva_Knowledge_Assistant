import admin from 'firebase-admin';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ ERROR: Missing FIREBASE_SERVICE_ACCOUNT in .env");
  process.exit(1);
}

// Initialize Firebase
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
});

const db = admin.firestore();

async function clearVectors() {
  console.log("Clearing existing vectors from Firebase Firestore...");
  const snapshot = await db.collection("vector_store").get();
  
  const batchArray = [];
  batchArray.push(db.batch());
  let operationCounter = 0;
  let batchIndex = 0;

  snapshot.docs.forEach((doc) => {
    batchArray[batchIndex].delete(doc.ref);
    operationCounter++;

    if (operationCounter === 20) {
      batchArray.push(db.batch());
      batchIndex++;
      operationCounter = 0;
    }
  });

  console.log(`Executing ${batchArray.length} batches to delete ${snapshot.docs.length} documents...`);
  for (const batch of batchArray) {
    await batch.commit();
  }
  
  console.log("✅ Successfully cleared existing vectors!");
}

clearVectors();
