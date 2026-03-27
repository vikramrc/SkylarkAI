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
    
    // Find the latest thread that had more than 1 turn
    const thread = await db.collection('checkpoints').findOne({ "channel_values.toolResults.1": { $exists: true } }, { sort: { _id: -1 } });
    
    if (!thread) {
        console.log("No multi-turn threads found");
        return;
    }

    const values = thread.channel_values;
    const results = values.toolResults || [];
    const selection = values.selectedResultKeys || [];
    
    console.log("Thread ID:", thread.thread_id);
    console.log("Iteration Count:", values.iterationCount);
    console.log("Selected Keys:", JSON.stringify(selection));
    console.log("Turn History Count:", results.length);
    
    results.forEach((turn: any, i: number) => {
        console.log(`\nTurn ${i} Keys [${Object.keys(turn).length}]:`);
        Object.keys(turn).forEach(k => {
            const res = turn[k];
            let label = res?.uiTabLabel || "No Label";
            if (!label) {
                 try {
                     const parsed = JSON.parse(res?.content?.[0]?.text);
                     label = parsed.uiTabLabel;
                 } catch {}
            }
            console.log(` - ${k} | Label: ${label}`);
        });
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
