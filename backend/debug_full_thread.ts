import { MongoClient } from "mongodb";
async function run() {
    const uri = process.env.SKYLARK_MONGODB_URI || "mongodb://localhost:27017/SkylarkDB";
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const thread_id = "69c7cb226b75770f199c5ebe";
        const checkpoints = await db.collection("checkpoints").find({ thread_id }).sort({ t: -1 }).toArray();
        console.log("Checkpoints found:", checkpoints.length);
        for (const cp of checkpoints) {
            console.log("Timestamp:", cp.t, "Metadata:", JSON.stringify(cp.metadata));
            if (cp.channel_values) {
                console.log("Channels:", Object.keys(cp.channel_values));
                if (cp.channel_values.error) console.log("Error Channel:", cp.channel_values.error);
                if (cp.channel_values.messages) {
                    const msgs = cp.channel_values.messages;
                    const last = msgs[msgs.length - 1];
                    console.log("Last Msg Content Sample:", JSON.stringify(last?.content || last, null, 2).substring(0, 1000));
                }
            }
        }
    } finally {
        await client.close();
    }
}
run();
