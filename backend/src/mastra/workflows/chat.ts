import { createWorkflow, createStep } from '@mastra/core/workflows';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';


const chatInputSchema = z.object({
    userQuery: z.string(),
    authToken: z.string().optional(),
});

// A simple pass-through step that just uses the Agent to generate a response.
// The Agent itself has tools and working memory, so we just let it handle the logic.
// The workflow acts as the container for Suspend/Resume if we choose to use it,
// though for this console app, we might just call the workflow.execute() per message.
const chatStep = createStep({
    id: 'chatStep',
    inputSchema: chatInputSchema,
    outputSchema: z.object({
        response: z.string(),
    }),
    execute: async (params) => {
        try {
            const { inputData, mastra, runId } = params as any;
            const { userQuery, authToken } = inputData;
            
            const agent = mastra?.getAgent('skylark');
            
            if (!agent) {
                throw new Error("Skylark agent not found in Mastra instance");
            }

            // Introspect agent state
            console.log(`[Workflow DEBUG] Agent ID: ${agent.id}`);
            console.log(`[Workflow DEBUG] Agent has memory: ${agent.hasOwnMemory()}`);
            const processors = await agent.listInputProcessors();
            console.log(`[Workflow DEBUG] Agent input processors:`, processors.map((p: any) => p.id) || 'None');
            console.log(`[Workflow DEBUG] Processing query for runId: ${runId}`);
            
            const memory = await agent.getMemory();
            if (memory) {
                console.log(`[Workflow DEBUG] Memory Instance ID: ${memory.id}`);
                // @ts-ignore - inspecting internal config
                console.log(`[Workflow DEBUG] Memory Config:`, JSON.stringify(memory.threadConfig || {}, null, 2));
                try {
                    // recall() retrieves messages from the thread
                    const { messages } = await memory.recall({ threadId: runId });
                    console.log(`[Workflow DEBUG] Recalled History (${messages.length} messages)`);
                    if (messages.length > 0) {
                        // Just log the last few contents to avoid spamming the console
                        const snippets = messages.slice(-3).map((m: any) => {
                            let contentStr = '';
                            if (typeof m.content === 'string') {
                                contentStr = m.content;
                            } else if (Array.isArray(m.content)) {
                                contentStr = m.content.map((c: any) => c.text || JSON.stringify(c)).join(' ');
                            }
                            return `[${m.role}]: ${contentStr.slice(0, 50)}...`;
                        });
                        console.log(`[Workflow DEBUG] Last 3 messages:`, snippets);
                    }

                    // getWorkingMemory() retrieves structured state
                    const workingMemory = await memory.getWorkingMemory({ threadId: runId, resourceId: 'console-user' });
                    console.log(`[Workflow DEBUG] Working Memory state:`, workingMemory || 'Empty');

                } catch (e) {
                    console.log(`[Workflow DEBUG] Memory diagnostic failed: ${e}`);
                }
            }

            console.log(`\n[Workflow] Step processing query: "${userQuery}" for run ${runId}`);

            const requestContext = new RequestContext();
            requestContext.set('token', authToken);

            const result = await agent.generate(userQuery, {
                memory: {
                    thread: runId,
                    resource: 'console-user',
                },
                requestContext
            });

            if (!result) {
                console.error(`[chatStep Error]: Agent returned null/undefined result for query: "${userQuery}"`);
                return { response: "I'm sorry, I encountered an error processing your request." };
            }

            console.log(`[Workflow] Agent generated response: "${result.text || '[No text content]'}"`);

            return {
                response: result.text || "I processed your request but didn't generate a text response.",
            };
        } catch (error: any) {
            console.error(`[chatStep Error]: ${error.message}`, error.stack);
            throw error;
        }
    }
});

export const chatWorkflow = createWorkflow({
    id: 'skylark-chat-workflow',
    name: 'Skylark Chat Workflow',
})
.then(chatStep)
.commit();
