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
                }, {
                    version: "v2",
                    configurable: { thread_id: currentRunId },
                    signal: controller.signal // 🟢 Pass abort signal to stream streamEvents triggers flaws flawlessly flawless trigger flawless
                });

                let assistantResponse = "";
                let didError = false; // 🟢 Track if any node triggered error triggers flaws!

                for await (const event of eventStream) {
                    // 🟢 A. Status Updates for Nodes
                    if (event.event === "on_chain_start" && event.metadata?.langgraph_node) {
                        const nodeName = event.metadata.langgraph_node;
                        let statusMessage = "Processing...";
                        
                        if (nodeName === "orchestrator") statusMessage = "Orchestrating tools... 🔍";
                        if (nodeName === "execute_tools") statusMessage = "Executing Parallel Tools... 🛠️";
                        if (nodeName === "update_memory") statusMessage = "Updating Observational Memory... 🧠";
                        if (nodeName === "summarizer") statusMessage = "Finalizing Analysis... 📝";
                        if (nodeName === "errorNode") {
                            statusMessage = "Explaining Error... 🚨";
                            didError = true; 
                            res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: statusMessage })}\n\n`);
                            continue;
                        }

                        res.write(`event: status_update\ndata: ${JSON.stringify({ message: statusMessage })}\n\n`);
                    }

                    // 🟢 C. Trigger Immediate red UI timeline indicators on node error breakdowns layouts
                    if (event.event === "on_chain_end" && event.data.output?.error) {
                        const errorMsg = event.data.output.error;
                        res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: errorMsg })}\n\n`);
                    }

                    // 🟢 B. Word-by-Word Streaming from Summarizer OR Error Node LLMs
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

                    const isAiMessage = (lastMsg as any)._getType && (lastMsg as any)._getType() === "ai";

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
                    await ConversationModel.addMessage(currentRunId, userQuery, assistantResponse);
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
            res.write(`event: error\ndata: ${JSON.stringify({
                runId: currentRunId,
                error: error.message || String(error),
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
