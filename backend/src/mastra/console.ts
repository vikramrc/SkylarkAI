import { initMastra } from './index.js';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => new Promise((resolve) => rl.question(query, resolve));

async function main() {
    console.log("Initializing Mastra (Skylark AI)...");
    const mastra = await initMastra();
    
    console.log("Mastra Initialized. You can now chat with SkylarkAgent.");
    console.log("Type 'exit' to quit. Type '/new' to start a new chat (Workflow Instance).");
    console.log("---------------------------------------------------------");

    const authToken = await question("Enter Authorization Token (for MCP tools): ");
    
    let currentRunId = randomUUID();
    console.log(`\n[Started new chat - Run ID: ${currentRunId}]`);

    const chatWorkflow = mastra.getWorkflow('chatWorkflow');

    while (true) {
        const input = await question(`\nUser: `);
        
        if (input.trim().toLowerCase() === 'exit') {
            break;
        }

        if (input.trim().toLowerCase() === '/new') {
            currentRunId = randomUUID();
            console.log(`\n===========================================`);
            console.log(`[Started new chat - Run ID: ${currentRunId}]`);
            console.log(`===========================================`);
            continue;
        }

        if (!input.trim()) continue;

        console.log(`[Console DEBUG] Using runId: ${currentRunId}`);

        try {
            // Correct way to execute a workflow: create a Run instance first, then start it.
            const workflow = mastra.getWorkflow('chatWorkflow');
            const run = await workflow.createRun({ runId: currentRunId });
            
            const result = await run.start({
                inputData: { 
                    userQuery: input,
                    authToken: authToken
                },
            });

            // The result structure from run.start() contains the output of each step
            if (result.status === 'success') {
                // The steps property contains the output of each step
                const stepResult = result.steps['chatStep'];
                if (stepResult && stepResult.status === 'success' && stepResult.output) {
                    const output = stepResult.output as any;
                    if (output.response) {
                        console.log(`\nSkylark: ${output.response}`);
                    } else {
                        console.log(`\nSkylark: [Step Succeeded but Output missing 'response']`, output);
                    }
                } else {
                    console.log(`\nSkylark: [Step Execution Failed or Output missing]`, stepResult);
                }
            } else {
                console.log(`\nSkylark: [Workflow Execution Failed with status: ${result.status}]`, result);
            }

        } catch (error: any) {
            console.error(`\nError:`, error.message);
            if (error.stack) {
                // console.error(error.stack);
            }
        }
    }

    rl.close();
    process.exit(0);
}

main().catch(console.error);
