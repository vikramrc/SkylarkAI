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

    const executedResults = await Promise.all(
        calls.map(async (toolCall: any, index: number) => {
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
                    if (result && result.__ambiguity_stop === true) {
                        return { name, result, index, ambiguity: true };
                    } else if (result && (result.error === true || result.status === 'error' || result.success === false)) {
                        nodeError = `[Execute Tool ${sanitizedName} Failure]: ${result.message || JSON.stringify(result)}`;
                        return { name, index, result: null };
                    } else {
                        return { name, index, result };
                    }
                } catch (e: any) {
                    nodeError = `[Execute Tool ${sanitizedName} Error]: ${e.message || String(e)}`;
                    return { name, index, result: null };
                }
            } else {
                nodeError = `Tool ${name} (sanitized: ${sanitizedName}) not found in skylarkTools`;
                return { name, index, result: null };
            }
        })
    );

    if (nodeError) {
        return { error: nodeError };
    }

    // 🟢 Sequentially populate dictionary to avoid race condition overwrite triggers!
    executedResults.forEach((item: any) => {
        if (!item || item.result === null) return;
        const { name, index, result } = item;
        let key = name;
        if (outputs[key] !== undefined) {
            key = `${name}_${index}`; // 🟢 Append suffix index safely sequential flaws trigger flawless
        }
        outputs[key] = result;
    });

    // 🟢 Format Ambiguity Response for UI Bubble Display
    let finalMessageContent = "";
    Object.values(outputs).forEach((r: any) => {
        if (r && r.__ambiguity_stop === true) {
            const cq = r.data?.clarifyingQuestions || [];
            const sugg = r.data?.assumptions || [];
            
            finalMessageContent = `### ❓ Clarifying Questions Needed\n\n`;
            cq.forEach((q: string) => finalMessageContent += `- ${q}\n`);
            
            if (sugg.length > 0) {
                finalMessageContent += `\n### 💡 Suggested Search Templates\n\n`;
                sugg.forEach((s: string) => finalMessageContent += `- *${s}*\n`);
            }
        }
    });

    if (finalMessageContent) {
        const { AIMessage } = await import("@langchain/core/messages");
        return { 
            toolResults: outputs,
            messages: [...state.messages, new AIMessage({ content: finalMessageContent })]
        } as any;
    }

    return { toolResults: outputs };
}
