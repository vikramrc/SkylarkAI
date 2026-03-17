import type { SkylarkState } from "../state.js";
import { skylarkTools } from "../../mastra/tools.js"; // Reuse existing Mastra tools structure!

/**
 * nodeExecuteTools maps tool list and parallel executes them deterministic.
 */
export async function nodeExecuteTools(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const outputs: Record<string, any> = {};
    const calls = state.toolCalls || [];

    console.log(`[LangGraph] 🛠 Executing Tools: ${JSON.stringify(calls.map((c: any) => c.name || c))}`);

    let nodeError: string | undefined = undefined;

    await Promise.all(
        calls.map(async (toolCall: any) => {
            const name = typeof toolCall === "string" ? toolCall : toolCall.name;
            const args = toolCall.args || {};

            const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
            const tool = (skylarkTools as any)[sanitizedName];

            if (tool) {
                try {
                    const inputArgs: any = {};
                    if (Array.isArray(toolCall.args)) {
                        toolCall.args.forEach((arg: any) => {
                            // Bulletproof Cast: Convert numbers or booleans into strings for strict Mastra tool schema mappings flawless!
                            inputArgs[arg.key] = arg.value !== null && arg.value !== undefined ? String(arg.value) : undefined;
                        });
                    }

                    console.log(`[LangGraph Execute] Running ${sanitizedName} with args:`, JSON.stringify(inputArgs));

                    const contextMock = {
                        requestContext: {
                            get: (key: string) => {
                                if (key === 'runId') return `langgraph-${Date.now()}`;
                                if (key === 'token') return ''; 
                                return null;
                            }
                        },
                        workingMemory: state.workingMemory // 🟢 Auto-fill identifier support for mastra/tools.ts flawlessly!
                    };

                    const result = await tool.execute(inputArgs, contextMock); 
                    console.log(`[LangGraph Execute] ${sanitizedName} Result Preview: ${JSON.stringify(result).slice(0, 251)}...`);
                    // Breakout if payload carries error: true (Validation failures proxy layer responses flawless)
                    if (result && (result.error === true || result.status === 'error' || result.success === false)) {
                        nodeError = `[Execute Tool ${sanitizedName} Failure]: ${result.message || JSON.stringify(result)}`;
                    } else {
                        outputs[name] = result;
                    }
                } catch (e: any) {
                    nodeError = `[Execute Tool ${sanitizedName} Error]: ${e.message || String(e)}`;
                }
            } else {
                nodeError = `Tool ${name} (sanitized: ${sanitizedName}) not found in skylarkTools`;
            }
        })
    );

    if (nodeError) {
        return { error: nodeError };
    }

    return { toolResults: outputs };
}
