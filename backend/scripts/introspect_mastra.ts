import { initMastra } from './src/mastra/index.js';

async function introspect() {
    try {
        console.log("Initializing Mastra...");
        const mastra = await initMastra();
        const agent = (mastra as any).getAgent('skylark');
        
        console.log("\n--- Agent Instance ---");
        console.log("Properties:", Object.keys(agent));
        console.log("Prototype Methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(agent)));
        
        if (agent.memory) {
            console.log("\n--- Memory Instance ---");
            console.log("Properties:", Object.keys(agent.memory));
            const proto = Object.getPrototypeOf(agent.memory);
            console.log("Prototype Methods:", Object.getOwnPropertyNames(proto));
            
            // Try to find methods that look like they get history or threads
            const historyMethods = Object.getOwnPropertyNames(proto).filter(m => 
                m.toLowerCase().includes('message') || 
                m.toLowerCase().includes('thread') || 
                m.toLowerCase().includes('context') ||
                m.toLowerCase().includes('get')
            );
            console.log("Potential History Methods:", historyMethods);

            if (agent.memory.storage) {
                console.log("\n--- Storage Instance ---");
                console.log("Properties:", Object.keys(agent.memory.storage));
                console.log("Prototype Methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(agent.memory.storage)));
            }
        }
        
    } catch (error) {
        console.error("Introspection failed:", error);
    }
}

introspect().then(() => process.exit(0));
