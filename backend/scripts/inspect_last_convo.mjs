import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';

const envContent = readFileSync('/home/phantom/testcodes/SkylarkAI/backend/.env', 'utf-8');
const envVars = Object.fromEntries(
    envContent.split('\n')
        .filter(l => l.trim() && !l.startsWith('#') && l.includes('='))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const uri = envVars.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

// Get the latest thread
const latest = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
if (!latest) { console.log('No checkpoints.'); await client.close(); process.exit(0); }
const threadId = latest.thread_id;
console.log(`\n=== Latest Thread: ${threadId} ===\n`);

// Get latest conversation messages from SkylarkDB
const conv = await db.collection('conversations').findOne({ threadId });
if (conv?.messages?.length > 0) {
    const lastMsg = conv.messages[conv.messages.length - 1];
    console.log(`\n--- Latest Conversation Message ---`);
    console.log(`User: ${lastMsg.userMessage?.substring(0, 100)}`);
    console.log(`AI Response (first 400 chars): ${lastMsg.assistantMessage?.substring(0, 400)}`);
    const tr = lastMsg.toolResults;
    if (tr) {
        const turns = Array.isArray(tr) ? tr : [tr];
        console.log(`\ntoolResults turns saved: ${turns.length}`);
        turns.forEach((turn, i) => {
            const keys = Object.keys(turn || {});
            console.log(`  Turn ${i} (${keys.length} tools):`);
            keys.forEach(k => {
                const val = turn[k];
                // Try to unwrap MCP
                let data = val;
                if (data?.content?.[0]?.text) {
                    try { data = JSON.parse(data.content[0].text); } catch {}
                }
                const itemCount = Array.isArray(data?.items) ? data.items.length : '?';
                console.log(`    - ${k}: ${itemCount} items | uiTabLabel="${data?.uiTabLabel || 'NONE'}"`);
            });
        });
    }
}

// Also look at the raw checkpoints to see what feedBackVerdict the orchestrator set
const cpAll = await db.collection('checkpoints').find({ thread_id: threadId }).sort({ _id: 1 }).toArray();
console.log(`\n--- Checkpoint Verdicts (${cpAll.length} total) ---`);
for (const cp of cpAll) {
    const cv = cp.channel_values || {};
    const hasToolCalls = !!cv.toolCalls;
    const hasToolResults = !!cv.toolResults;
    const verdict = cv.feedBackVerdict;
    const iter = cv.iterationCount;
    const messages = cv.messages;
    if (verdict || hasToolCalls || iter !== undefined) {
        console.log(`  cp @ ${cp._id}: iter=${iter} verdict=${verdict} toolCalls=${hasToolCalls} toolResults=${hasToolResults} msgs=${messages?.length}`);
        if (cv.toolCalls?.length > 0) {
            const names = cv.toolCalls.map((c) => c.name || JSON.stringify(c)).join(', ');
            console.log(`    toolCalls: [${names.substring(0, 150)}]`);
        }
    }
}

await client.close();
