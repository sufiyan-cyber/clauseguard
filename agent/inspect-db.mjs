/**
 * ClauseGuard Database Inspector
 * Inspects both MongoDB Atlas and the local fallback mirror.
 */
import { MongoClient } from "mongodb";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "clauseguard";

async function inspectAtlas() {
  console.log("=================================================");
  console.log(" 🌐 1. CHECKING MONGODB ATLAS CLOUD");
  console.log("=================================================");
  console.log("Target URI :", uri ? uri.replace(/:([^:@]+)@/, ":****@") : "(Not set)");
  console.log("Database   :", dbName);

  if (!uri) {
    console.log("⚠️ No MONGODB_URI found in .env\n");
    return;
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000 });
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!\n");
    const db = client.db(dbName);
    const cols = await db.listCollections().toArray();
    
    if (cols.length === 0) {
      console.log(`Database '${dbName}' is connected, but has no collections yet.`);
    } else {
      console.log(`Found ${cols.length} collections in '${dbName}':\n`);
      for (const c of cols) {
        const count = await db.collection(c.name).countDocuments();
        console.log(`  📂 ${c.name.padEnd(20)}: ${count} document(s)`);
        const sample = await db.collection(c.name).findOne({});
        if (sample) {
          const keys = Object.keys(sample).filter(k => k !== "_id");
          console.log(`     Fields: ${keys.join(", ")}`);
        }
      }
    }
    await client.close();
  } catch (err) {
    console.log("❌ Atlas Connection Note:", err.message);
    console.log("👉 If you see 'bad auth', check your Atlas user password in cloud.mongodb.com -> Database Access.");
    console.log("👉 If you see 'network timeout', check Network Access -> Add IP Address -> Allow Access from Anywhere (0.0.0.0/0).");
  }
}

async function inspectLocalMirror() {
  console.log("\n=================================================");
  console.log(" 💾 2. LOCAL DUAL-PERSISTENCE DATA MIRROR");
  console.log("=================================================");
  console.log("ClauseGuard automatically mirrors all MongoDB collections to local storage.\n");

  try {
    const local = createClient({ url: "file:clauseguard-app.db" });
    const tables = ["documents", "clauses", "runs", "enkrypt_verdicts", "llm_traces", "qa_messages", "review_feedback"];
    
    for (const t of tables) {
      const res = await local.execute(`SELECT count(*) as cnt FROM ${t}`);
      const count = res.rows[0].cnt;
      console.log(`  📂 ${t.padEnd(20)}: ${count} document(s)`);
    }

    console.log("\n--- Sample Document from 'documents' ---");
    const doc = await local.execute("SELECT id, title, filename, status, created_at FROM documents LIMIT 1");
    if (doc.rows.length > 0) {
      console.log(JSON.stringify(doc.rows[0], null, 2));
    }

    console.log("\n--- Sample Clause from 'clauses' ---");
    const clause = await local.execute("SELECT id, document_id, ordinal, clause_type, risk_level, risk_score FROM clauses WHERE risk_level IS NOT NULL LIMIT 1");
    if (clause.rows.length > 0) {
      console.log(JSON.stringify(clause.rows[0], null, 2));
    }
  } catch (err) {
    console.log("Local check error:", err.message);
  }
}

async function run() {
  await inspectAtlas();
  await inspectLocalMirror();
  console.log("\n=================================================");
}

run();
