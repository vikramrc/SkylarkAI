import { skylarkGraph } from '../src/langgraph/graph.js';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

async function getLatestThreadId(): Promise<string | null> {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        const latest = await db.collection('checkpoints').find({}, { projection: { thread_id: 1 } }).sort({ _id: -1 }).limit(1).toArray();
        return latest[0]?.thread_id || null;
    } catch (e) {
        console.error("🚨 Failed to lookup latest thread:", e);
        return null;
    } finally {
        await client.close();
    }
}

async function main() {
    let threadId = process.argv[2];
    
    if (!threadId) {
        console.log(`[Auto] 🔍 Looking up latest conversation thread from ${dbName}...`);
        threadId = await getLatestThreadId() || "";
        if (!threadId) {
            console.error("❌ No threadId provided and no checkpoints found in database.");
            process.exit(1);
        }
        console.log(`✅ Using latest threadId: \x1b[36m${threadId}\x1b[0m\n`);
    }

    try {
        console.log(`🔍 Fetching state history for threadId: ${threadId}`);
        const history = skylarkGraph.getStateHistory({ configurable: { thread_id: threadId } });
        
        let stepCount = 0;
        for await (const state of history) {
            stepCount++;
            const node = state.next?.[0] || 'End';
            console.log(`\n--- ⏳ STEP ${stepCount} | Node: ${node} ---`);
            const vals = state.values;
            
            const lastMsgs = vals.messages?.slice(-10) || []; // 🟢 Show last 10 messages for deeper context
            console.log(`💬 MESSAGE HISTORY (${lastMsgs.length} messages):`);
            for (const m of lastMsgs) {
                const role = (m as any)._getType?.() || m.role || 'user';
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                console.log(`   [${role}]: ${content.substring(0, 200).replace(/\n/g, ' ')}...`);
            }

            if (vals.feedBackVerdict) {
                console.log(`💡 VERDICT: ${vals.feedBackVerdict}`);
                if (vals.reasoning) {
                    console.log(`🧠 REASONING: ${vals.reasoning.replace(/\n/g, ' ')}`);
                }
            }

            if (vals.toolCalls && vals.toolCalls.length > 0) {
                console.log(`📡 TOOL CALLS (${vals.toolCalls.length}):`);
                for (const call of vals.toolCalls) {
                    console.log(`  -> Call: ${call.name}`);
                    console.log(`     Args: ${JSON.stringify(call.args || {}, null, 1).replace(/\n/g, ' ')}`);
                }
            }

            if (vals.toolResults && Object.keys(vals.toolResults).length > 0) {
                console.log(`🛠️ TOOL RESULTS:`);
                for (const [k, v] of Object.entries(vals.toolResults)) {
                    const toolVal = v as any;
                    console.log(`  -> ${k} (${toolVal.content?.length || 0} items)`);
                }
            } else {
                console.log("No toolResults in this step.");
            }
        }

        if (stepCount === 0) {
            console.log("⚠️ No state history returned. The state is empty or invalid threadId.");
        }

    } catch (e) {
        console.error("🚨 Error fetching graph state:", e);
    } finally {
        process.exit(0);
    }
}

main();
