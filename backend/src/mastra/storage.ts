import { MongoDBStore } from '@mastra/mongodb';
import { getPersistenceMongoConfig } from '../phoenixai/persistence/mongodb.js';

export async function createMastraStorage() {
    const config = getPersistenceMongoConfig();
    
    let connectionUrl = config.uri;
    let targetDb: string = (config as any).dbName || 'SkylarkDB';

    try {
        const url = new URL(config.uri);
        if (url.pathname && url.pathname.length > 1) {
            const dbNameFromPath = url.pathname.substring(1).split('?')[0];
            if (dbNameFromPath) {
                targetDb = dbNameFromPath;
            }
            // Reconstruct connectionUrl without the DB name path
            // e.g. mongodb://localhost:27017/SkylarkDB -> mongodb://localhost:27017
            connectionUrl = `${url.protocol}//${url.host}${url.search}`;
        }
    } catch (e) {
        // Fallback for non-standard URIs if needed
    }

    console.log(`[Storage] Initializing MongoDBStore:`);
    console.log(` - URL: ${connectionUrl}`);
    console.log(` - DB: "${targetDb}"`);
    
    const storage = new MongoDBStore({
        id: 'skylark-mongodb-store',
        url: connectionUrl,
        dbName: targetDb,
    });
    
    await storage.init();
    console.log(`[Storage] MongoDBStore initialized successfully.`);
    
    return storage;
}
