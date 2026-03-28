import { MongoClient } from "mongodb";
async function run() {
    const uri = process.env.SKYLARK_MONGODB_URI || "mongodb://localhost:27017/SkylarkDB";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const thread_id = "69c7cb226b75770f199c5ebe";
        const writes = await db.collection("checkpoint_writes").find({ thread_id }).toArray();
        console.log("Found", writes.length, "writes");
        
        // Find the most recent message or the error write
        for (const w of writes) {
            console.log("-------------------");
            console.log("Channel: " + w.channel);
            const val = Buffer.from(w.value, "base64").toString("utf-8");
            try {
                const parsed = JSON.parse(val);
                console.log("Value (JSON):", JSON.stringify(parsed, null, 2).substring(0, 1000));
            } catch (e) {
                console.log("Value (String):", val.substring(0, 1000));
            }
        }
    } finally {
        await client.close();
    }
}
run();
