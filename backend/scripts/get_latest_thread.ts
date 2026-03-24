import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('checkpoints');

    console.log(`[Lookup] Fetching latest checkpoints from ${dbName}...`);
    const items = await collection.find({}, { projection: { thread_id: 1 } })
                                 .sort({ _id: -1 })
                                 .limit(5)
                                 .toArray();

    if (items.length === 0) {
      console.log("No checkpoints found.");
    } else {
      console.log("\n--- 🔍 LATEST THREADS ---");
      items.forEach((item, index) => {
        console.log(`[${index + 1}] Thread ID: ${item.thread_id}`);
      });
    }

  } catch (err) {
    console.error("🚨 Error querying database:", err);
  } finally {
    await client.close();
    process.exit(0);
  }
}

main();
