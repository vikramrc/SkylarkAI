import { Mastra } from '@mastra/core/mastra';
import { chatWorkflow } from './workflows/chat.js';
import { getSkylarkAgent } from './agent.js';
import { createMastraStorage } from './storage.js';

export async function initMastra() {
    const storage = await createMastraStorage();
    
    return new Mastra({
        agents: {
            skylark: getSkylarkAgent(storage),
        },
        workflows: {
            chatWorkflow,
        },
        storage,
    });
}
