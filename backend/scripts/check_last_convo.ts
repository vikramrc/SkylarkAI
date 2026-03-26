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
        console.log(`Iteration: ${cv.iterationCount}`);
        console.log(`Verdict: ${cv.feedBackVerdict}`);
        console.log(`Reasoning: ${cv.reasoning?.substring(0, 100)}...`);
        if (cv.toolResults) {
          const results = Array.isArray(cv.toolResults) ? cv.toolResults : [cv.toolResults];
          console.log(`Tool Results turns: ${results.length}`);
          results.forEach((turn: any, tIdx: number) => {
             console.log(`  Turn ${tIdx}: ${Object.keys(turn || {}).join(', ')}`);
             Object.entries(turn || {}).forEach(([k, v]) => {
                const itemsCount = (v as any)?.items?.length ?? (Array.isArray(v) ? v.length : "N/A");
                console.log(`    - ${k}: ${itemsCount} items`);
             });
          });
        }
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
