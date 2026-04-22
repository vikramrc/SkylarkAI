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
        const threadId = process.argv[2];
        if (!threadId) {
            console.error('Usage: npx tsx dump_messages.ts <thread_id>');
            process.exit(1);
        }

        const checkpoint = await db.collection('checkpoints')
            .findOne({ thread_id: threadId }, { sort: { _id: -1 } });

        if (!checkpoint) {
            console.error('No checkpoint found for threadId:', threadId);
            process.exit(1);
        }

        const { BSON } = await import('mongodb');
        const raw = checkpoint.checkpoint;
        let buf: Buffer | null = null;
        if (Buffer.isBuffer(raw)) {
            buf = raw;
        } else if (raw?._bsontype === 'Binary' || raw?.buffer) {
            buf = Buffer.from(raw.buffer || raw.value(), 'binary');
        } else if (raw?.type === 'Buffer' && Array.isArray(raw?.data)) {
            buf = Buffer.from(raw.data);
        }

        if (!buf) {
            console.error('Could not extract buffer from checkpoint');
            process.exit(1);
        }

        let decoded: any = null;
        try {
            decoded = BSON.deserialize(buf);
        } catch (e) {
            try {
                decoded = JSON.parse(buf.toString('utf-8'));
            } catch (e2) {
                console.error('Failed to decode checkpoint:', e);
                process.exit(1);
            }
        }
        const messages = decoded.channel_values?.messages || [];

        console.log(`Messages for thread ${threadId} (Total: ${messages.length}):`);
        messages.forEach((m: any, i: number) => {
            let role = 'unknown';
            if (m.role) role = m.role;
            else if (m.id?.[m.id.length - 1]?.includes('HumanMessage')) role = 'human';
            else if (m.id?.[m.id.length - 1]?.includes('AIMessage')) role = 'ai';
            else if (m.id?.[m.id.length - 1]?.includes('SystemMessage')) role = 'system';
            
            let content = m.content;
            if (Array.isArray(content)) {
                content = content.map((c: any) => c.text || JSON.stringify(c)).join('\n');
            } else if (typeof content !== 'string') {
                content = JSON.stringify(content);
            }

            console.log(`[${i}] ${role.toUpperCase()}: ${content}`);
            console.log('---');
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

main();
