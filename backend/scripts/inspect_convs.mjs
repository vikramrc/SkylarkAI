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

// List all collections
const collections = await db.listCollections().toArray();
console.log('Collections:', collections.map(c => c.name).join(', '));

// Get recent conversations
const convs = await db.collection('conversations').find({}).sort({ updatedAt: -1 }).limit(5).toArray();
console.log(`\nFound ${convs.length} conversations`);
for (const conv of convs) {
    console.log(`\n--- Conv ${conv._id || conv.threadId} ---`);
    console.log(`  threadId: ${conv.threadId}`);
    console.log(`  msgs: ${conv.messages?.length || 0}`);
    if (conv.messages?.length > 0) {
        const last = conv.messages[conv.messages.length - 1];
        console.log(`  last userMsg: ${String(last.userMessage || '').substring(0, 100)}`);
        console.log(`  last aiMsg (200chars): ${String(last.assistantMessage || '').substring(0, 200)}`);
        const tr = last.toolResults;
        if (tr) {
            const turns = Array.isArray(tr) ? tr : [tr];
            console.log(`  toolResults turns: ${turns.length}`);
            turns.forEach((turn, i) => {
                const keys = Object.keys(turn || {});
                console.log(`    Turn ${i}: ${keys.length} tools`);
                keys.slice(0, 4).forEach(k => {
                    let data = turn[k];
                    if (data?.content?.[0]?.text) {
                        try { data = JSON.parse(data.content[0].text); } catch {}
                    }
                    const itemCount = Array.isArray(data?.items) ? data.items.length : 'N/A';
                    console.log(`      - ${k}: ${itemCount} items | label="${data?.uiTabLabel || '-'}"`);
                });
            });
        } else {
            console.log('  no toolResults');
        }
    }
}

await client.close();
