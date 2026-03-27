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
    
    const checkpoint = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
    if (!checkpoint) {
        console.log("No checkpoints found");
        return;
    }
    const results = checkpoint.channel_values.toolResults;
    console.log("Turn History Count:", results.length);
    results.forEach((turn: any, i: number) => {
        console.log(`Turn ${i} keys:`, Object.keys(turn));
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
