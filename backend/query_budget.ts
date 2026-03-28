import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });
import { MongoClient } from "mongodb";

async function run() {
    const uri = process.env.PHOENIX_MONGO_URI || "mongodb://localhost:27017/ProductsDB";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const cols = await db.listCollections().toArray();
        for (const c of cols) {
            const data = await db.collection(c.name).find({ "costCenter.code": "TESTCOSTCENTER1" }).limit(2).toArray();
            if (data.length > 0) {
                console.log("Collection:", c.name);
                console.log(JSON.stringify(data, null, 2));
                return;
            }
        }
        console.log("Not found anywhere");
    } finally {
        await client.close();
    }
}
run();
