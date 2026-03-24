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
            
            if (vals.toolResults && Object.keys(vals.toolResults).length > 0) {
                console.log(`🛠️ TOOL RESULTS:`);
                for (const [k, v] of Object.entries(vals.toolResults)) {
                    const toolVal = v as any;
                    console.log(`  -> ${k} (${toolVal.content?.length || 0} items)`);
                    if (toolVal.content?.[0]?.text) {
                        try {
                            const parsed = JSON.parse(toolVal.content[0].text);
                            console.log(`     Summary: ${JSON.stringify(parsed.summary || {}, null, 2)}`);
                            console.log(`     Items Count: ${parsed.items?.length || 0}`);
                        } catch {
                            console.log(`     Text: ${toolVal.content[0].text.substring(0, 100)}...`);
                        }
                    }
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
