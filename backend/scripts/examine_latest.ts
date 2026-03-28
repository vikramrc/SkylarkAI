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
    console.log(`\n🔍 Inspecting Thread: ${threadId}`);
    
    const checkpoints = await db.collection('checkpoints').find({ thread_id: threadId }).sort({ _id: -1 }).limit(10).toArray();
    
    checkpoints.reverse().forEach((cp, idx) => {
        let values: any = {};
        try {
            if (cp.type === 'json' && typeof cp.checkpoint === 'string') {
                const decoded = Buffer.from(cp.checkpoint, 'base64').toString();
                const json = JSON.parse(decoded);
                values = json.channel_values || {};
            } else {
                values = cp.checkpoint?.channel_values || cp.channel_values || {};
            }
        } catch (e) {}

        const messages = values.messages || [];
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            const content = lastMsg.lc_kwargs?.content || lastMsg.content || lastMsg.kwargs?.content || "No content";
            const role = lastMsg.id?.[lastMsg.id.length - 1] || lastMsg.role || "unknown";
            
            if (role === 'ai' || role === 'AIMessage') {
                console.log(`\n--- [STEP ${idx}] AI ---`);
                console.log(`[CONTENT]: ${typeof content === 'string' ? content.substring(0, 300) : 'Non-string content'}...`);
                const tcalls = lastMsg.kwargs?.tool_calls || lastMsg.tool_calls;
                if (tcalls) {
                    console.log(`📡 TOOL CALLS (${tcalls.length}):`, JSON.stringify(tcalls.map(tc => tc.name || tc.function?.name), null, 2));
                    // console.log(`ARGS SAMPLE:`, JSON.stringify(tcalls[0].args || tcalls[0].function?.arguments, null, 2));
                }
            }
        }
    });

  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
}

main();
