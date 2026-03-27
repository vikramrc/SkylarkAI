import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

async function main() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);
    
    const latestCheckpoint = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
    if (!latestCheckpoint) {
        console.log("No checkpoints");
        return;
    }
    const threadId = latestCheckpoint.thread_id;
    
    // Quick dump of the latest state values
    const checkpoint = await db.collection('checkpoints').findOne({ thread_id: threadId }, { sort: { _id: -1 } });
    const values = checkpoint?.channel_values;
    
    console.log("Thread ID:", threadId);
    console.log("Selected Result Keys:", JSON.stringify(values?.selectedResultKeys || []));

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
