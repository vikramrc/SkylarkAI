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

        // 1. Find the absolute latest checkpoint to get the active threadId
        const latestRaw = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
        if (!latestRaw) {
            console.log('❌ No checkpoints found in the database.');
            return;
        }

        const threadId = latestRaw.thread_id;
        console.log(`✅ Analyzing Thread ID: \x1b[36m${threadId}\x1b[0m`);

        // 2. Fetch all checkpoints for this thread to reconstruct history
        const checkpoints = await db.collection('checkpoints')
            .find({ thread_id: threadId })
            .sort({ _id: 1 }) // Chronological order
            .toArray();

        console.log(`📊 Found ${checkpoints.length} state transitions in this thread.\n`);

        for (let i = 0; i < checkpoints.length; i++) {
            const cp = checkpoints[i];
            const cv = cp.channel_values || {};
            
            // Extract and summarize turns
            if (cv.messages && cv.messages.length > 0) {
                const latestMsg = cv.messages[cv.messages.length - 1];
                let role = 'unknown';
                let content = '';

                if (latestMsg.lc === 1) {
                    role = latestMsg.id[latestMsg.id.length - 1];
                    content = latestMsg.kwargs?.content || '';
                    if (latestMsg.kwargs?.tool_calls) {
                      content += `\n   [TOOL CALLS]: ${JSON.stringify(latestMsg.kwargs.tool_calls)}`;
                    }
                } else {
                    role = latestMsg.role || 'unknown';
                    content = typeof latestMsg.content === 'string' ? latestMsg.content : JSON.stringify(latestMsg.content);
                }

                console.log(`--- [TURN ${i + 1}] Role: ${role} ---`);
                console.log(`${content.substring(0, 500)}${content.length > 500 ? '...' : ''}`);
                
                if (cv.workingMemory?.reasoning) {
                  console.log(`🧠 Reasoning: ${cv.workingMemory.reasoning}`);
                }
                
                if (cv.toolResults) {
                  const toolCount = Object.keys(cv.toolResults).length;
                  console.log(`🛠️ Results: ${toolCount} tool(s) returned data.`);
                }
                console.log('');
            }
        }

    } catch (err) {
        console.error("🚨 Diagnostic Error:", err);
    } finally {
        await client.close();
    }
}

main();
