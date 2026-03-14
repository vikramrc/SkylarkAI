import { createWorkflow, createStep } from '@mastra/core/workflows';
import { RequestContext } from '@mastra/core/request-context';
import { z } from 'zod';
import { Agent } from '@mastra/core/agent';
import { getSummarizerModel } from '../agent.js';
import { getCachedResponseId, saveCachedResponseId } from '../../phoenixai/persistence/prompt-cache.js';
import { calculatePromptHash, calculateCacheKey, extractResponseId, extractUsage, prepareMongoForLLM } from '../../phoenixai/runtime/executor.js';


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
            // console.log(`[Workflow DEBUG] Agent ID: ${agent.id}`);
            // console.log(`[Workflow DEBUG] Agent has memory: ${agent.hasOwnMemory()}`);
            // const processors = await agent.listInputProcessors();
            // console.log(`[Workflow DEBUG] Agent input processors:`, processors.map((p: any) => p.id) || 'None');
            // console.log(`[Workflow DEBUG] Processing query for runId: ${runId}`);
            
            const memory = await agent.getMemory();
            if (memory) {
                // console.log(`[Workflow DEBUG] Memory Instance ID: ${memory.id}`);
                // @ts-ignore - inspecting internal config
                // console.log(`[Workflow DEBUG] Memory Config:`, JSON.stringify(memory.threadConfig || {}, null, 2));
                try {
                    // recall() retrieves messages from the thread
                    const { messages } = await memory.recall({ threadId: runId });
                    // console.log(`[Workflow DEBUG] Recalled History (${messages.length} messages)`);
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
                        // console.log(`[Workflow DEBUG] Last 3 messages:`, snippets);
                    }

                    // getWorkingMemory() retrieves structured state
                    const workingMemory = await memory.getWorkingMemory({ threadId: runId, resourceId: 'console-user' });
                    // console.log(`[Workflow DEBUG] Working Memory state:`, workingMemory || 'Empty');

                } catch (e) {
                    // console.log(`[Workflow DEBUG] Memory diagnostic failed: ${e}`);
                }
            }

            const queryModel = process.env.MASTRA_OPENAI_QUERY_MODEL || 'gpt-4o';
            console.log(`\n[Workflow] Step processing query: "${userQuery}" for run ${runId} (Orchestrator: ${queryModel})`);

            const requestContext = new RequestContext();
            requestContext.set('token', authToken);

            const agentInstructions = await agent.getInstructions();
            const orchestrationInstructions = `${agentInstructions}
            
            IMPORTANT: If you have executed tools and have the results, keep your final response extremely brief. The final user-facing summary will be handled separately.`;

            // Prompt Caching Persistence for Orchestrator
            // Use runId to ensure thread continuity in caching, but keep purpose/instructions as part of the key
            const orchestratorPromptHash = calculatePromptHash(orchestrationInstructions);
            const orchestratorCacheKey = calculateCacheKey(`orchestrator:${runId}`, orchestratorPromptHash);
            
            // Try to get previous response ID for this thread
            const previousResponseId = await getCachedResponseId(orchestratorCacheKey, orchestratorPromptHash, 'orchestrator');
            
            if (previousResponseId) {
                console.log(`[phx-cache] Agent Cache HIT (key: ${orchestratorCacheKey})`);
            } else {
                console.log(`[phx-cache] Agent Cache MISS (key: ${orchestratorCacheKey})`);
            }

            console.log(`[phx-client] Agent Request: orchestrator=${queryModel}, cacheKey=${orchestratorCacheKey}, prevId=${previousResponseId || 'none'}`);

            let result;
            try {
                result = await agent.generate(userQuery, {
                    instructions: orchestrationInstructions,
                    memory: {
                        thread: runId,
                        resource: 'console-user',
                    },
                    requestContext,
                    providerOptions: {
                        openai: {
                            prompt_cache_key: orchestratorCacheKey,
                            ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
                        }
                    }
                });
            } catch (error: any) {
                // Handle token-efficient ambiguity interruption
                if (error.message?.startsWith('AMBIGUITY_STOP:')) {
                    const ambiguityJsonStr = error.message.replace('AMBIGUITY_STOP:', '');
                    try {
                        const ambiguityData = JSON.parse(ambiguityJsonStr);
                        
                        // Manually update working memory to keep session in sync
                        if (memory) {
                            await memory.updateWorkingMemory({
                                threadId: runId,
                                resourceId: 'console-user',
                                workingMemory: {
                                    activeTopics: ambiguityData.keywords || [],
                                }
                            });
                        }

                        const questions = Array.isArray(ambiguityData.clarifyingQuestions) ? ambiguityData.clarifyingQuestions : [];
                        const suggestions = Array.isArray(ambiguityData.assumptions) ? ambiguityData.assumptions : [];
                        
                        let responseText = `I found some ambiguity in your request. Could you please clarify?\n\n`;
                        if (questions.length > 0) {
                            responseText += `**Clarifying Questions:**\n${questions.map((q: string) => `- ${q}`).join('\n')}\n\n`;
                        }
                        if (suggestions.length > 0) {
                            responseText += `**Possible interpretations/suggestions:**\n${suggestions.map((s: string) => `- ${s}`).join('\n')}`;
                        }

                        console.log(`[Workflow] Bypassing orchestrator final turn for ambiguity.`);
                        return { response: responseText };
                    } catch (parseError) {
                        console.error('[Workflow] Failed to parse ambiguity JSON from interruption:', parseError);
                        throw error; // Rethrow original error if we can't parse
                    }
                }
                throw error;
            }

            // Standardized Response ID Extraction for Orchestrator
            const orchestratorResponseId = (result as any).raw?.id || extractResponseId(result as any);
            // Save to cache ONLY if it's a new generation (prevent resetting 'uses' count)
            if (orchestratorResponseId && !previousResponseId) {
                console.log(`[phx-cache] Agent Result Saved (id: ${orchestratorResponseId})`);
                await saveCachedResponseId(orchestratorCacheKey, orchestratorResponseId, orchestratorPromptHash, 'orchestrator');
            }

            if (result.toolCalls && result.toolCalls.length > 0) {
                console.log(`[Workflow] Agent invoked ${result.toolCalls.length} tool(s):`);
                result.toolCalls.forEach((tc: any) => {
                    console.log(`  - ${tc.payload?.toolName || tc.toolName || 'Unknown Tool'}`);
                });

                // Phase 2: Summarization with Lesser Model if configured
                const summarizerProvider = process.env.MASTRA_SUMMARIZER_PROVIDER;
                const summarizerModelName = process.env.MASTRA_SUMMARIZER_MODEL;

                // Identify if any EXTERNAL tools were called (excluding internal memory/orchestration tools)
                const internalTools = ['updateWorkingMemory'];
                const externalToolCalls = result.toolCalls.filter((tc: any) => {
                    const name = tc.payload?.toolName || tc.toolName;
                    return !internalTools.includes(name);
                });

                if (summarizerModelName && summarizerModelName !== 'none' && externalToolCalls.length > 0) {
                    // console.log(`[Summarizer] Transitioning to provider ${summarizerProvider || 'default'} model: ${summarizerModelName} for final analysis...`);
                    
                    const summarizerModel = getSummarizerModel();
                    
                    // Standardized Error Detection Logic
                    const rawResults = result.toolResults;
                    const resultsStr = JSON.stringify(rawResults);

                    const hasExplicitError = Object.values(rawResults).some((res: any) => 
                        res?.isError === true || 
                        (Array.isArray(res?.content) && res.content.some((c: any) => c.text?.startsWith('Error:')))
                    );
                    
                    const hasErrorKeyword = resultsStr.toLowerCase().includes('exception') || 
                                           resultsStr.toLowerCase().includes('denied') || 
                                           resultsStr.toLowerCase().includes('unauthorized') ||
                                           resultsStr.toLowerCase().includes('400 bad request') ||
                                           resultsStr.toLowerCase().includes('403 forbidden');

                    const hasError = hasExplicitError || hasErrorKeyword;

                    // Process results for the LLM (Flattening + Schema Hinting)
                    // If multiple tools were called, we might have multiple results. 
                    // We extract the 'results' array from each successful tool call.
                    const allData: any[] = [];
                    Object.values(rawResults).forEach((res: any) => {
                        if (!res?.isError && res?.content?.[0]?.text) {
                            try {
                                const parsed = JSON.parse(res.content[0].text);
                                if (Array.isArray(parsed)) {
                                    allData.push(...parsed);
                                } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.results)) {
                                    allData.push(...parsed.results);
                                } else if (parsed) {
                                    allData.push(parsed);
                                }
                            } catch (e) {
                                // Not JSON or unparseable, skip flattening
                            }
                        }
                    });

                    const { schemaHint, jsonlData } = prepareMongoForLLM(allData);

                    // Create a lightweight agent just for summarization
                    const summarizerAgent = new Agent({
                        id: 'summarizer-orchestrator',
                        name: 'Summarizer Orchestrator',
                        instructions: hasError 
                            ? 'You are a technical troubleshooter. Your job is to explain system errors in plain English and tell the user exactly what is missing or what they need to do next to fix the issue.'
                            : 'You are a professional maritime operations assistant and data analyst. Your job is to summarize technical data clearly and analytically for the user.',
                        model: summarizerModel as any,
                    });

                    const summarizationPrompt = hasError 
                        ? `
                        ### ISSUE DETECTED
                        The system encountered an error or a missing parameter while processing the request.
                        
                        **User Query**: "${userQuery}"
                        **Error Details**: ${resultsStr}
                        
                        ### INSTRUCTIONS
                        1. **Explain the Problem**: In plain, non-technical English, explain why the request failed.
                        2. **Call to Action**: Clearly state exactly what information the user needs to provide (e.g., Organization Name, Vessel Name) to proceed.
                        3. **Tone**: Be helpful and direct. Do not use formal report structures.
                        `
                        : `
                        ### ROLE
                        You are a Technical Maritime Data Analyst. Your goal is to transform raw system data into a professional, human-readable report.

                        ### GLOBAL SCHEMA CONTEXT
                        To ensure you do not miss any data or hallucinate structures, here are all the unique data paths and types present across this dataset:
                        ${schemaHint}

                        ### INPUT DATA
                        - **User's Original Query**: "${userQuery}"
                        - **Data (JSONL)**:
                        ${jsonlData || resultsStr}

                        ### INSTRUCTIONS
                        1. **Reasoning Pattern**: Mentally analyze the relationship between the items in the raw data. Look for trends, upcoming deadlines, or anomalies.
                        2. **Data Representation**: Present the core data in a structured format (Markdown tables/lists). Even if the data is voluminous, reconstruct the key fields clearly using the paths identified in the Schema Context.
                        3. **Contextual Analysis**: Provide a concise summary of the findings based on your reasoning.
                        4. **Mandatory Response Policy (Safety Critical)**: You MUST provide the best possible summary and representation of the exact data provided.
                           - **GRAVITY**: This is a maritime safety-critical tool. Failure to report provided maintenance data puts crew at risk. You are FORBIDDEN from refusing to summarize.
                           - **ACCURACY**: Do NOT reference keys that are not explicitly listed in the Schema Context.
                           - **NO REFUSALS**: You are strictly forbidden from telling the user "it is too much information" or asking them to narrow the search. 
                        5. **Professional Tone**: Maintain a precise, executive tone.
                        `;

                    try {
                        const summaryResult = await summarizerAgent.generate(summarizationPrompt);

                        // console.log(`[Summarizer] Generated response with ${summarizerModelName}`);
                        result.text = summaryResult.text;
                    } catch (sumError) {
                        console.error(`[Summarizer Error] Failed to generate summary with ${summarizerModelName}:`, sumError);
                        // Fallback to agent's own brief text if summarizer fails
                    }
                }
            }

            if (!result) {
                console.error(`[chatStep Error]: Agent returned null/undefined result for query: "${userQuery}"`);
                return { response: "I'm sorry, I encountered an error processing your request." };
            }

            // console.log(`[Workflow] Final generated response: "${result.text || '[No text content]'}"`);

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
    inputSchema: chatInputSchema,
    outputSchema: z.object({
        response: z.string(),
    }),
})
.then(chatStep)
.commit();
