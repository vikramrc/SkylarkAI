import { MongoClient } from 'mongodb';

/**
 * Script to create a strictly Read-Only database user account in MongoDB
 * without requiring 'mongosh'.
 * 
 * Target: Phoenix Source Database (The DB being queried by AI fallback route).
 * DO NOT apply to SkylarkDB (Which needs RW for history/checkpoints).
 *
 * Usage:
 *   SKYLARK_MONGODB_URI="mongodb://root:password@localhost:27017" node scripts/create_readonly_user.mjs
 */

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017';
const dbName = process.env.PHOENIX_DB_NAME || 'PhoenixDB'; // 🟢 Updated to default to PhoenixDB source context
const username = process.env.PHOENIX_READ_ONLY_USER || 'phoenix_read_only';
const password = process.env.PHOENIX_READ_ONLY_PASSWORD || 'securePassword123';

async function run() {
    console.log(`[MongoSetup] 🔌 Connecting to Database...`);
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 2000 });

    try {
        await client.connect();
        const db = client.db(dbName);
        console.log(`[MongoSetup] 👤 Creating read-only user '${username}' for database '${dbName}'...`);
        
        // Execute the createUser command
        await db.command({
            createUser: username,
            pwd: password,
            roles: [{ role: "read", db: dbName }]
        });
        
        console.log(`\n\x1b[32m✅ SUCCESS:\x1b[0m Read-only user '${username}' created successfully.`);
        console.log(`\x1b[36m👉 Connection String:\x1b[0m mongodb://${username}:${password}@<host>:<port>/${dbName}?authSource=${dbName}`);
    } catch (error) {
        if (error.message && error.message.includes('already exists')) {
            console.log(`\n\x1b[33mℹ️ INFO:\x1b[0m User '${username}' already exists.`);
        } else {
            console.error(`\n\x1b[31m❌ ERROR:\x1b[0m Failed to create user:`, error.message);
        }
    } finally {
        await client.close();
    }
}

run();
