import { initMastra } from './index.js';

async function test() {
    const mastra = await initMastra();
    const agent = mastra.getAgent('skylark');
    console.log("Agent found:", !!agent);
    
    if (agent) {
        // Inspect methods
        const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(agent));
        console.log("Agent Methods:", methods.filter(m => m.includes('generate') || m.includes('stream')));
    }
}

test().catch(console.error);
