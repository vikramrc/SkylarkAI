import { Router } from 'express';
import { initMastra } from '../index.js';
import { randomUUID } from 'crypto';

export function createMastraWorkflowRouter() {
    const router = Router();

    // Initialize ONCE at the router level
    const mastraPromise = initMastra();

    router.get('/workflow/chat', async (req, res, next) => {
        try {
            const userQuery = req.query.userQuery as string;
            const runId = req.query.runId as string;
            
            // Extract session token value securely from raw cookie string if header is missing
            const cookies = req.headers.cookie || '';
            const match = cookies.match(/\b(X-Session-ID|session|token)=([^;]+)/i);
            const authToken = req.headers.authorization 
                ? req.headers.authorization.split(' ')[1] 
                : (match ? match[2] : undefined);

            if (!userQuery) {
                return res.status(400).json({ message: 'userQuery is required as a query parameter' });
            }

            const currentRunId = runId || randomUUID();
            console.log(`[Mastra Route] Executing 'chatWorkflow' with runId: ${currentRunId}`);

            const mastra = await mastraPromise;
            const workflow = mastra.getWorkflow('chatWorkflow');

            if (!workflow) {
                return res.status(500).json({ message: 'chatWorkflow not found in Mastra instance' });
            }

            const run = await workflow.createRun({ runId: currentRunId });
            
            // Set SSE Headers to support Word-by-Word Streaming back to Client
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable reverse proxy buffering
            res.flushHeaders(); // Ensure headers get dispatched right away

            const statusListener = (data: { message: string }) => {
                res.write(`event: status_update\ndata: ${JSON.stringify({ message: data.message })}\n\n`);
            };
            const { workflowEmitter } = await import('../workflow-events.js');
            workflowEmitter.on(`status:${currentRunId}`, statusListener);

            let heartbeat: NodeJS.Timeout | undefined;
            try {
                // Heartbeat to prevent reverse proxy timeouts (e.g. Vite 30s limit)
                heartbeat = setInterval(() => {
                    res.write(':\n\n');
                }, 10000);

                const result = await run.start({
                    inputData: { 
                        userQuery,
                        authToken,
                        onChunk: (chunk: string) => {
                            res.write(`event: text_delta\ndata: ${JSON.stringify({ delta: chunk })}\n\n`);
                        }
                    },
                });

                if (result.status === 'success') {
                    const stepResult = result.steps['chatStep'];
                    if (stepResult && stepResult.status === 'success' && stepResult.output) {
                        const output = stepResult.output as any;
                        res.write(`event: result\ndata: ${JSON.stringify({
                            runId: currentRunId,
                            response: output.response || "No response generated.",
                            status: 'success'
                        })}\n\n`);
                        res.end();
                        return;
                    } else {
                        res.write(`event: workflow_error\ndata: ${JSON.stringify({
                            message: 'Workflow step failed or returned empty output',
                            runId: currentRunId,
                            stepResult
                        })}\n\n`);
                        res.end();
                        return;
                    }
                } else {
                    res.write(`event: workflow_error\ndata: ${JSON.stringify({
                        type: 'error',
                        message: `Workflow execution failed with status: ${result.status}`,
                        runId: currentRunId,
                        result
                    })}\n\n`);
                    res.end();
                    return;
                }
            } finally {
                if (typeof heartbeat !== 'undefined') clearInterval(heartbeat);
                const { workflowEmitter } = await import('../workflow-events.js');
                workflowEmitter.off(`status:${currentRunId}`, statusListener);
            }

        } catch (error: any) {
            console.error(`[Mastra Route Error]:`, error.message);
            return next(error);
        }
    });

    return router;
}

export default createMastraWorkflowRouter;
