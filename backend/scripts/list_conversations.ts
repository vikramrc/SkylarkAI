import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

async function main() {
  const client = new MongoClient(uri);
  const threadId = '69c20ef74d5c2e7259c4c867';
  
  try {
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection('checkpoints');

    // Query latest checkpoint for this thread
    const item = await collection.findOne({ thread_id: threadId }, { sort: { $natural: -1 } });
    
    if (item && item.channel_values) {
        console.log(`\n--- 🔍 FOUND CHECKPOINT FOR THREAD ${threadId} ---`);
        const toolResults = item.channel_values.toolResults;
        if (toolResults) {
            console.log(JSON.stringify(toolResults, null, 2));
        } else {
            console.log("⚠️ No toolResults in channel_values.");
            console.log("Full channel_values keys:", Object.keys(item.channel_values));
        }
    } else {
        console.log("⚠️ No checkpoint found for this thread.");
    }

  } catch (err) {
    console.error("🚨 Error querying database:", err);
  } finally {
    await client.close();
    process.exit(0);
  }
}

main();
