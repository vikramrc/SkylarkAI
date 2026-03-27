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
    
    // Find latest thread_id from checkpoints
    const latestCheckpoint = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
    if (!latestCheckpoint) {
      console.log('No checkpoints found.');
      return;
    }
    const threadId = latestCheckpoint.thread_id;
    console.log(`Latest Thread ID: ${threadId}`);
    
    const { skylarkGraph } = await import('../src/langgraph/graph.js');
    console.log(`🔍 Fetching state for threadId: ${threadId}`);
    
    const state = await skylarkGraph.getState({ configurable: { thread_id: threadId } });
    const cv = state.values;
    
    if (cv) {
        console.log(`--- STATE VALUES ---`);
        console.log(`Iteration: ${cv.iterationCount}`);
        console.log(`Working Memory: ${JSON.stringify(cv.workingMemory, null, 2)}`);
        console.log(`\n--- MESSAGES ---`);
        cv.messages.forEach((m: any, idx: number) => {
            const role = m._getType?.() || m.role || 'unknown';
            console.log(`[${idx}] [${role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
        });
    } else {
        console.log("⚠️ No state found for this thread.");
    }

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
