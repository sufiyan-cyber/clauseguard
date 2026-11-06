import { MongoClient } from "mongodb";

const uri = "mongodb+srv://techpalace789_db_user:testpassword%40909%23%24@clauseguard.kzzqfy9.mongodb.net/clauseguard?retryWrites=true&w=majority";
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

async function check() {
  try {
    console.log("Connecting to Atlas cluster...");
    await client.connect();
    console.log("✅ Successfully connected to MongoDB Atlas!");
    const db = client.db("clauseguard");
    const cols = await db.listCollections().toArray();
    console.log("\nFound collections in 'clauseguard':");
    if (cols.length === 0) {
      console.log("  (Database currently has no collections)");
    }
    for (const c of cols) {
      const count = await db.collection(c.name).countDocuments();
      console.log(`  • ${c.name}: ${count} document(s)`);
      const sample = await db.collection(c.name).findOne({});
      if (sample) {
        console.log(`    Sample fields:`, Object.keys(sample).join(", "));
      }
    }
  } catch (err) {
    console.log("❌ MongoDB connection error:", err.message);
  } finally {
    await client.close();
  }
}

check();
