import { Router } from 'express';
import { initMastra } from '../index.js';
import { randomUUID } from 'crypto';

export function createMastraWorkflowRouter() {
    const router = Router();

    // Initialize ONCE at the router level
    const mastraPromise = initMastra();

    router.post('/workflow/chat', async (req, res, next) => {
        try {
            const { userQuery, runId } = req.body;
            
            // Extract session token value securely from raw cookie string if header is missing
            const cookies = req.headers.cookie || '';
            const match = cookies.match(/\b(X-Session-ID|session|token)=([^;]+)/i);
            const authToken = req.headers.authorization 
                ? req.headers.authorization.split(' ')[1] 
                : (match ? match[2] : undefined);

            if (!userQuery) {
                return res.status(400).json({ message: 'userQuery is required' });
            }

            const currentRunId = runId || randomUUID();
            console.log(`[Mastra Route] Executing 'chatWorkflow' with runId: ${currentRunId}`);

            const mastra = await mastraPromise;
            const workflow = mastra.getWorkflow('chatWorkflow');

            if (!workflow) {
                return res.status(500).json({ message: 'chatWorkflow not found in Mastra instance' });
            }

            const run = await workflow.createRun({ runId: currentRunId });
            
            const result = await run.start({
                inputData: { 
                    userQuery,
                    authToken
                },
            });

            if (result.status === 'success') {
                const stepResult = result.steps['chatStep'];
                if (stepResult && stepResult.status === 'success' && stepResult.output) {
                    const output = stepResult.output as any;
                    return res.json({
                        runId: currentRunId,
                        response: output.response || "No response generated.",
                        status: 'success'
                    });
                } else {
                    return res.status(500).json({
                        message: 'Workflow step failed or returned empty output',
                        runId: currentRunId,
                        stepResult
                    });
                }
            } else {
                return res.status(500).json({
                    message: `Workflow execution failed with status: ${result.status}`,
                    runId: currentRunId,
                    result
                });
            }

        } catch (error: any) {
            console.error(`[Mastra Route Error]:`, error.message);
            return next(error);
        }
    });

    return router;
}

export default createMastraWorkflowRouter;
