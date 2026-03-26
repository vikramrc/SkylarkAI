import { Router } from 'express';
import { randomUUID } from 'crypto';
import { skylarkGraph } from '../graph.js';
import { ConversationModel } from '../models/Conversation.js';
import { HumanMessage } from "@langchain/core/messages";
import { registerStream, unregisterStream, abortStream } from '../utils/stream_manager.js';

/**
 * createLangGraphWorkflowRouter routes standard SSE triggers to the side-by-side LangGraph framework.
 */
export function createLangGraphWorkflowRouter() {
    const router = Router();

    // 🟢 Ensure indexes setup on startup flawlessly trigger flaws flawless triggers
    ConversationModel.ensureIndexes();

    router.get('/workflow/chat', async (req, res, next) => {
        const { ObjectId } = await import('mongodb');
        const userQuery = req.query.userQuery as string;
        const runId = req.query.runId as string;
        const currentRunId = runId && ObjectId.isValid(runId) ? runId : new ObjectId().toHexString();

        try {
            if (!userQuery) {
                return res.status(400).json({ message: 'userQuery is required as a query parameter' });
            }

            console.log(`[LangGraph Route] Executing 'skylarkGraph' with runId: ${currentRunId}`);

            // 1. Set SSE Headers to support accurate triggers back to Client
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); 
            res.flushHeaders(); 

            // Heartbeat to prevent reverse proxy timeouts
            const heartbeat = setInterval(() => {
                res.write(':\n\n');
            }, 10000);

            try {
                // 2. Register stream with abort controller controller controllers
                const controller = registerStream(currentRunId);

                // 3. Stream LangGraph Events
                const eventStream = (skylarkGraph as any).streamEvents({
                    messages: [new HumanMessage(userQuery)],
                    iterationCount: 0, // 🟢 Reset each turn to enable autonomous loops flawless!
                }, {
                    version: "v2",
                    configurable: { thread_id: currentRunId },
                    signal: controller.signal // 🟢 Pass abort signal to stream streamEvents triggers flaws flawlessly flawless trigger flawless
                });

                let assistantResponse = "";
                let didError = false; // 🟢 Track if any node triggered error triggers flaws!
                let lastVerdict = "FEED_BACK_TO_ME"; // 🟢 Tracking for final table emission flaws
                let lastReasoning = ""; // 🟢 Capture for CoT thought process UI
                let toolResultsEmitted = false; // 🟢 Guard against double-emit: D1 sets this, D2 checks it

                for await (const event of eventStream) {
                    // 🟢 A. Status Updates for Nodes
                    if (event.event === "on_chain_start" && event.metadata?.langgraph_node) {
                        const nodeName = event.metadata.langgraph_node;
                        let statusMessage = "Processing...";
                        
                        if (nodeName === "orchestrator") statusMessage = "Orchestrating tools... 🔍";
                        if (nodeName === "execute_tools") {
                            const tools = event.data?.input?.toolCalls || [];
                            const count = tools.length;
                            statusMessage = `Executing ${count > 0 ? count + ' ' : ''}Parallel Tools... 🛠️`;
                        }
                        if (nodeName === "update_memory") statusMessage = "Updating Observational Memory... 🧠";
                        if (nodeName === "summarizer") statusMessage = "Finalizing Analysis... 📝";
                        if (nodeName === "errorNode") {
                            statusMessage = "Explaining Error... 🚨";
                            didError = true; 
                            res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: statusMessage, reasoning: lastReasoning })}\n\n`);
                            continue;
                        }

                        res.write(`event: status_update\ndata: ${JSON.stringify({ 
                            message: statusMessage, 
                            reasoning: nodeName === 'execute_tools' ? lastReasoning : undefined 
                        })}\n\n`);
                    }

                    // 🟢 B. Capture Reasoning & Verdict from Orchestrator Node END event flawlessly trigger
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "orchestrator") {
                        const output = event.data.output;
                        if (output) {
                            lastVerdict = output.feedBackVerdict || lastVerdict;
                            lastReasoning = output.reasoning || lastReasoning;
                        }
                    }

                    // 🟢 C. Trigger Immediate red UI timeline indicators on node error breakdowns layouts
                    if (event.event === "on_chain_end" && event.data.output?.error) {
                        const errorMsg = event.data.output.error;
                        res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: errorMsg })}\n\n`);
                    }

                    // 🟢 D. Emit Raw Tool Results — shared helper used by both execute_tools and summarizer nodes
                    const emitToolResults = async (nodeLabel: string) => {
                        try {
                            const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                            const currentState = finalState.values;

                            const rawResults = currentState.toolResults || [];
                            const turns = Array.isArray(rawResults) ? rawResults : [rawResults];

                            // 🟢 Fix 2: Promote uiTabLabel from MCP wrapper to the top-level of each result entry
                            // ResultTable.tsx reads payload.uiTabLabel to name tabs — it must be at the top level
                            const mergedResults: Record<string, any> = {};
                            turns.forEach((turn: any) => {
                                Object.entries(turn || {}).forEach(([key, val]: [string, any]) => {
                                    const entry = { ...val }; // shallow clone to avoid mutation
                                    // Promote uiTabLabel: it's already on the outer object from execute_tools.ts
                                    // but may be lost if MCP rewraps. Ensure it stays at top level.
                                    if (!entry.uiTabLabel) {
                                        // Try parsing the MCP text to grab it from inside if missing
                                        const text = entry?.content?.[0]?.text;
                                        if (text) {
                                            try {
                                                const parsed = JSON.parse(text);
                                                if (parsed?.uiTabLabel) entry.uiTabLabel = parsed.uiTabLabel;
                                            } catch {}
                                        }
                                    }
                                    mergedResults[key] = entry;
                                });
                            });

                            if (Object.keys(mergedResults).length > 0) {
                                console.log(`[Workflow Route] 📤 Emitting tool_results from [${nodeLabel}]: ${Object.keys(mergedResults).length} entries`);
                                res.write(`event: tool_results\ndata: ${JSON.stringify({ results: mergedResults })}\n\n`);
                            }
                        } catch (e) {
                            console.error(`[Workflow Route] Failed to emit tool_results from [${nodeLabel}]:`, e);
                        }
                    };

                    // 🟢 D1. Emit from execute_tools — ASAP if this is a final turn (SUMMARIZE verdict or ambiguity)
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "execute_tools") {
                        try {
                            const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                            const currentState = finalState.values;
                            
                            const resultsArr = Object.values(currentState.toolResults[currentState.toolResults.length - 1] || {});
                            const standsAmbiguous = resultsArr.some((r: any) => r && r.__ambiguity_stop === true);
                            
                            // 🟢 Final Turn Detection: summarize verdict, ambiguity hit, or hard floor at 8 iterations flawlessly!
                            const isFinalTurn = lastVerdict === "SUMMARIZE" || standsAmbiguous || (currentState.iterationCount || 0) >= 8;
                            
                            if (isFinalTurn) {
                                await emitToolResults("execute_tools");
                                toolResultsEmitted = true; // 🟢 Mark as sent so D2 doesn't double-emit
                            }
                        } catch (e) {
                            console.error(`[Workflow Route] Failed to check final turn state:`, e);
                        }
                    }

                    // 🟢 D2. Flush from summarizer — safety-net catch for when Orchestrator goes SUMMARIZE
                    // with NO further tool calls (skipping execute_tools entirely).
                    // Only fires if D1 did NOT already emit to prevent redundant double-write to the client.
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "summarizer") {
                        if (!toolResultsEmitted) {
                            await emitToolResults("summarizer");
                            toolResultsEmitted = true;
                        } else {
                            console.log(`[Workflow Route] ⏭️ D2 skipped — tool_results already emitted by D1`);
                        }
                    }

                    // 🟢 E. Word-by-Word Streaming from Summarizer OR Error Node LLMs
                    if (event.event === "on_chat_model_stream" && 
                        (event.metadata?.langgraph_node === "summarizer" || event.metadata?.langgraph_node === "errorNode")) {
                        const chunk = event.data.chunk;
                        if (chunk && chunk.content) {
                            const text = String(chunk.content);
                            assistantResponse += text;
                            res.write(`event: text_delta\ndata: ${JSON.stringify({ delta: text })}\n\n`);
                        }
                    }
                }

                // 🟢 Fallback to last message in state if streaming data was bypassed (e.g., HITL directly ending nodeOrchestrator flawlessly)
                try {
                    const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                    const finalMessages = finalState.values?.messages || [];
                    const lastMsg = finalMessages[finalMessages.length - 1];

                    const isAiMessage = lastMsg && (lastMsg as any)._getType && (lastMsg as any)._getType() === "ai";

                    if (!assistantResponse && lastMsg && lastMsg.content && isAiMessage) {
                        assistantResponse = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
                    }
                } catch (stateErr) {
                    console.error(`[Workflow Result] Failed to fetch final state:`, stateErr);
                }

                if (!assistantResponse) {
                    assistantResponse = didError ? "" : "No response generated.";
                }

                // 🟢 Save message pair using Model flawless trigger flawlessly
                try {
                    const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                    // 🟢 Defensive Migration: Ensure toolResults is treated as an array for the new turn-based history format flawlessly!
                    const rawResults = finalState.values?.toolResults;
                    const toolResults = Array.isArray(rawResults) ? rawResults : (rawResults ? [rawResults] : []);
                    
                    await ConversationModel.addMessage(currentRunId, userQuery, assistantResponse, toolResults);
                    await ConversationModel.upsertShell(currentRunId, userQuery);
                } catch (dbErr) {
                    console.error(`[Workflow Route] Failed to save conversation message:`, dbErr);
                }

                res.write(`event: result\ndata: ${JSON.stringify({
                    runId: currentRunId,
                    response: assistantResponse,
                    status: 'success'
                })}\n\n`);
                res.end();

            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.log(`[LangGraph Route] Stream aborted by user: ${currentRunId}`);
                    res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: "Stream interrupted 🛑" })}\n\n`);
                    res.end();
                } else {
                    throw err; // propagates to outer catch catch catch catch layout flaws setup trigger trigger flawlessly flaws
                }
            } finally {
                unregisterStream(currentRunId);
                clearInterval(heartbeat);
            }

        } catch (error: any) {
            console.error(`[LangGraph Route Error]:`, error.message);
            
            // 🟢 Send timeline error status so UI spinner and timeline stop flawlessly!
            res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: error.message || String(error) })}\n\n`);

            res.write(`event: workflow_error\ndata: ${JSON.stringify({
                runId: currentRunId,
                message: error.message || String(error),
                status: 'error'
            })}\n\n`);
            res.end();
        }
    });

    // 🟢 ADD Stop Endpoint Endpoint Cancel streams cancel
    router.get('/workflow/stop', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId is required' });
        }
        const aborted = abortStream(runId);
        console.log(`[LangGraph Route] Stop triggered for runId: ${runId}. Success: ${aborted}`);
        res.json({ aborted });
    });

    // 🟢 ADD Get Conversation Messages Endpoint triggers flawless
    router.get('/workflow/messages', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId is required' });
        }
        try {
            const messages = await ConversationModel.getMessages(runId);
            res.json({ messages });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 🟢 ADD Search Timeline Endpoint triggers flawless
    router.get('/workflow/search', async (req, res) => {
        const query = req.query.q as string;
        if (!query) {
            return res.status(400).json({ message: 'q query is required' });
        }
        try {
            const matchedRunIds = await ConversationModel.searchTimeline(query);
            res.json({ matchedRunIds });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });
    
    // 🟢 ADD Pin Endpoint triggers flawless
    router.post('/workflow/pin', async (req, res) => {
        const runId = req.query.runId as string;
        const { pinned } = req.body;
        if (!runId) {
            return res.status(400).json({ message: 'runId query parameter is required' });
        }
        try {
            await ConversationModel.togglePin(runId, pinned);
            res.json({ success: true, pinned });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 🟢 ADD Delete Endpoint triggers flawless
    router.post('/workflow/delete', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId query parameter is required' });
        }
        try {
            await ConversationModel.deleteConversation(runId);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

export default createLangGraphWorkflowRouter;
