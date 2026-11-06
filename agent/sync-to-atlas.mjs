/**
 * ClauseGuard: Push local data to MongoDB Atlas
 * Usage: node sync-to-atlas.mjs
 */
import { MongoClient } from "mongodb";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "clauseguard";

async function sync() {
  if (!uri) {
    console.error("No MONGODB_URI found in .env");
    process.exit(1);
  }

  const client = new MongoClient(uri);
  const local = createClient({ url: "file:clauseguard-app.db" });

  try {
    console.log("Connecting to MongoDB Atlas...");
    await client.connect();
    console.log(" Connected to Atlas successfully!");
    const db = client.db(dbName);

    const tables = [
      { name: "documents", pk: "id" },
      { name: "clauses", pk: "id" },
      { name: "runs", pk: "run_id", mongoPk: "runId" },
      { name: "enkrypt_verdicts", pk: "id" },
      { name: "llm_traces", pk: "id" },
      { name: "qa_messages", pk: "id" },
      { name: "review_feedback", pk: "id" },
    ];

    for (const { name, pk, mongoPk } of tables) {
      const col = db.collection(name);
      const rows = (await local.execute(`SELECT * FROM ${name}`)).rows;
      console.log(`\nSyncing ${rows.length} records into '${name}'...`);

      for (const row of rows) {
        const doc = {};
        for (const [k, v] of Object.entries(row)) {
          // camelCase conversion
          const camelKey = k.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
          if (typeof v === "string" && (v.startsWith("{") || v.startsWith("["))) {
            try {
              doc[camelKey] = JSON.parse(v);
              continue;
            } catch {
              // keep as string
            }
          }
          doc[camelKey] = v;
        }

        const filterKey = mongoPk || pk;
        const filterVal = doc[filterKey];
        if (filterVal) {
          await col.replaceOne({ [filterKey]: filterVal }, doc, { upsert: true });
        }
      }
      const count = await col.countDocuments();
      console.log(`  ✓ ${name}: ${count} total documents in Atlas.`);
    }

    console.log("\n All ClauseGuard records synced to MongoDB Atlas successfully!");
  } catch (err) {
    console.error("Sync failed:", err.message);
  } finally {
    await client.close();
  }
}

sync();
