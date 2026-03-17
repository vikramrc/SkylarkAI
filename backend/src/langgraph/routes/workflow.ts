import { Router } from 'express';
import { randomUUID } from 'crypto';
import { skylarkGraph } from '../graph.js';
import { HumanMessage } from "@langchain/core/messages";

/**
 * createLangGraphWorkflowRouter routes standard SSE triggers to the side-by-side LangGraph framework.
 */
export function createLangGraphWorkflowRouter() {
    const router = Router();

    router.get('/workflow/chat', async (req, res, next) => {
        const userQuery = req.query.userQuery as string;
        const runId = req.query.runId as string;
        const currentRunId = runId || randomUUID();

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
                // 2. Stream LangGraph Events
                const eventStream = (skylarkGraph as any).streamEvents({
                    messages: [new HumanMessage(userQuery)],
                    workingMemory: { 
                        activeTopics: [], 
                        extractedEntities: {}, 
                        summaryBuffer: "" 
                    },
                    toolCalls: [],
                    toolResults: {},
                    feedBackVerdict: 'SUMMARIZE',
                    iterationCount: 0
                }, {
                    version: "v2",
                    configurable: { thread_id: currentRunId }
                });

                let assistantResponse = "";

                for await (const event of eventStream) {
                    // 🟢 A. Status Updates for Nodes
                    if (event.event === "on_chain_start" && event.metadata?.langgraph_node) {
                        const nodeName = event.metadata.langgraph_node;
                        let statusMessage = "Processing...";
                        
                        if (nodeName === "nodeOrchestrator") statusMessage = "Orchestrating tools... 🔍";
                        if (nodeName === "nodeExecuteTools") statusMessage = "Executing Parallel Tools... 🛠️";
                        if (nodeName === "nodeUpdateMemory") statusMessage = "Updating Observational Memory... 🧠";
                        if (nodeName === "nodeSummarizer") statusMessage = "Finalizing Analysis... 📝";
                        if (nodeName === "errorNode") statusMessage = "Explaining Error... 🚨";

                        res.write(`event: status_update\ndata: ${JSON.stringify({ message: statusMessage })}\n\n`);
                    }

                    // 🟢 C. Trigger Immediate red UI timeline indicators on node error breakdowns layouts
                    if (event.event === "on_chain_end" && event.data.output?.error) {
                        const errorMsg = event.data.output.error;
                        res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: errorMsg })}\n\n`);
                    }

                    // 🟢 B. Word-by-Word Streaming from Summarizer OR Error Node LLMs
                    if (event.event === "on_chat_model_stream" && 
                        (event.metadata?.langgraph_node === "nodeSummarizer" || event.metadata?.langgraph_node === "errorNode")) {
                        const chunk = event.data.chunk;
                        if (chunk && chunk.content) {
                            const text = String(chunk.content);
                            assistantResponse += text;
                            res.write(`event: text_delta\ndata: ${JSON.stringify({ delta: text })}\n\n`);
                        }
                    }
                }

                if (!assistantResponse) {
                    assistantResponse = "No response generated.";
                }

                res.write(`event: result\ndata: ${JSON.stringify({
                    runId: currentRunId,
                    response: assistantResponse,
                    status: 'success'
                })}\n\n`);
                res.end();

            } finally {
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

    return router;
}

export default createLangGraphWorkflowRouter;
