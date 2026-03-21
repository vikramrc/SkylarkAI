import { skylarkGraph } from '../src/langgraph/graph.js';

async function main() {
    const threadId = process.argv[2];
    
    if (!threadId) {
        console.error("❌ Please provide a threadId / runId as an argument.");
        console.error("Example: npx tsx scripts/dump_memory.ts 69be23...");
        process.exit(1);
    }

    try {
        console.log(`🔍 Fetching node state for threadId: ${threadId}`);
        const state = await skylarkGraph.getState({ configurable: { thread_id: threadId } });
        
        if (state && state.values) {
            console.log("\n--- 🧠 OBSERVATIONAL WORKING MEMORY ---");
            const vals = state.values;
            
            console.log(JSON.stringify(vals.workingMemory || {}, null, 2));
            
            if (vals.messages) {
                console.log(`\n--- 💬 MESSAGES COUNT: ${vals.messages.length} ---`);
                const simplifiedMessages = vals.messages.map((m: any) => {
                    let text = m.content;
                    if (Array.isArray(text)) text = JSON.stringify(text);
                    if (typeof text === 'object') text = JSON.stringify(text);
                    
                    const role = m._getType && m._getType() === "human" ? "user" : "assistant";
                    return { role, content: text };
                });
                console.log(JSON.stringify(simplifiedMessages, null, 2));
            }
        } else {
            console.log("⚠️ No state values returned. The state is empty or invalid threadId.");
        }

    } catch (e) {
        console.error("🚨 Error fetching graph state:", e);
    } finally {
        process.exit(0);
    }
}

main();
