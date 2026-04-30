/**
 * Migration Script: vector_store.json → LanceDB
 * 
 * Converts the existing JSON-based vector store into an optimized
 * LanceDB database for O(log N) vector search instead of O(N) brute force.
 * 
 * Run once: node migrate_to_lancedb.mjs
 */
import * as lancedb from '@lancedb/lancedb';
import fs from 'fs';
import path from 'path';

const VECTOR_STORE_PATH = './src/data/vector_store.json';
const LANCEDB_PATH = './src/data/lancedb';

async function migrate() {
  console.log('Reading vector_store.json...');
  const rawData = JSON.parse(fs.readFileSync(path.resolve(VECTOR_STORE_PATH), 'utf-8'));
  console.log(`Found ${rawData.length} documents.`);

  // Transform data into LanceDB-compatible format
  // LanceDB expects flat rows with a "vector" column
  const rows = rawData.map((doc, i) => ({
    id: doc.id || i,
    title: doc.parentDocument.title,
    category: doc.parentDocument.category,
    url: doc.parentDocument.url,
    content: doc.parentDocument.content,
    vector: doc.embedding  // LanceDB uses "vector" as the default column name
  }));

  console.log(`Transformed ${rows.length} rows. Embedding dimension: ${rows[0].vector.length}`);

  // Connect to LanceDB (creates folder if not exists)
  const db = await lancedb.connect(LANCEDB_PATH);

  // Drop existing table if re-running migration
  try {
    await db.dropTable('vectors');
    console.log('Dropped existing "vectors" table.');
  } catch (e) {
    // Table doesn't exist yet, that's fine
  }

  // Create table with data
  const table = await db.createTable('vectors', rows);
  const count = await table.countRows();
  console.log(`✅ Migration complete! LanceDB table "vectors" created with ${count} rows.`);
  console.log(`📁 Database stored at: ${path.resolve(LANCEDB_PATH)}`);
}

migrate().catch(console.error);
