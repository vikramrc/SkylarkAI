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

console.log(`Connecting to: ${dbName}`);
const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const latest = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
if (!latest) { console.log('No checkpoints.'); await client.close(); process.exit(0); }

const threadId = latest.thread_id;
console.log(`\n=== Latest Thread: ${threadId} ===\n`);

const checkpoints = await db.collection('checkpoints').find({ thread_id: threadId }).sort({ _id: 1 }).toArray();
console.log(`Checkpoints in thread: ${checkpoints.length}`);

let maxIter = 0;
let finalVerdict = '';
let toolTurns = 0;

for (const cp of checkpoints) {
    const cv = cp.channel_values || {};
    if (cv.iterationCount !== undefined && cv.iterationCount > maxIter) maxIter = cv.iterationCount;
    if (cv.feedBackVerdict) finalVerdict = cv.feedBackVerdict;
    if (cv.toolResults) {
        const turns = Array.isArray(cv.toolResults) ? cv.toolResults : [cv.toolResults];
        if (turns.length > toolTurns) toolTurns = turns.length;
    }
}

// Most recent checkpoint with full data
const richest = [...checkpoints].reverse().find(cp => cp.channel_values?.toolResults);
if (richest) {
    const cv = richest.channel_values;
    console.log(`\n--- Most Informative Checkpoint ---`);
    console.log(`  iterationCount: ${cv.iterationCount}`);
    console.log(`  feedBackVerdict: ${cv.feedBackVerdict}`);
    const tr = cv.toolResults;
    const turns = Array.isArray(tr) ? tr : [tr];
    console.log(`  toolResults turns: ${turns.length}`);
    turns.forEach((t, i) => {
        const keys = Object.keys(t || {});
        console.log(`    Turn ${i}: ${keys.length} tools → ${keys.slice(0,4).join(', ')}${keys.length > 4 ? ' ...' : ''}`);
    });
    const mem = cv.workingMemory?.summaryBuffer;
    if (mem) console.log(`\n  memory summary:\n  ${mem.substring(0, 200)}...`);
}

console.log(`\n--- Summary ---`);
console.log(`Max Iteration: ${maxIter}`);
console.log(`Final Verdict: ${finalVerdict}`);
console.log(`Max toolResults turns: ${toolTurns}`);

await client.close();
