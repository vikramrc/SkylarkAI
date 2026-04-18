/**
 * find_latest_thread.ts
 * Prints the thread_id of the most recent LangGraph checkpoint in the DB.
 * Usage: npx tsx scripts/find_latest_thread.ts
 */
import { MongoClient, BSON } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';

async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(uri.split('/').pop()?.split('?')[0] || 'SkylarkDB');
        const latest = await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } });
        if (latest?.thread_id) {
            process.stdout.write(latest.thread_id + '\n');
        } else {
            process.stderr.write('No checkpoints found.\n');
        }
    } finally {
        await client.close();
    }
}
main();
