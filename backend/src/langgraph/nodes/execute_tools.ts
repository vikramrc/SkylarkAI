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

    // ─── Dependency Gate ─────────────────────────────────────────────────────
    // If mcp.resolve_entities is in the batch, any other tool whose args contain
    // a placeholder value (e.g. "<resolved_id>", "<id>", "<pending>") is a
    // dependent call that CANNOT run yet. Strip them and let the next iteration
    // handle them once the resolved ID is in memory.
    const PLACEHOLDER_PATTERN = /^<[^>]+>$/;

    const hasDiscovery = calls.some(
        (c: any) => (c.name || c) === "mcp.resolve_entities"
    );

    const activeCalls = hasDiscovery
        ? calls.filter((toolCall: any) => {
              const name = typeof toolCall === "string" ? toolCall : toolCall.name;
              if (name === "mcp.resolve_entities") return true; // always keep discovery

              // Check if any arg value looks like a placeholder
              const args: any[] = Array.isArray(toolCall.args)
                  ? toolCall.args
                  : Object.entries(toolCall.args || {}).map(([key, value]) => ({ key, value }));

              const hasPlaceholder = args.some(
                  (a: any) => typeof a.value === "string" && PLACEHOLDER_PATTERN.test(a.value.trim())
              );

              if (hasPlaceholder) {
                  console.warn(
                      `[LangGraph DependencyGate] ⚠️ Stripping "${name}" from current turn — placeholder arg detected. Will execute next turn after resolution.`
                  );
              }
              return !hasPlaceholder;
          })
        : calls;
    // ─────────────────────────────────────────────────────────────────────────

    const executedResults = await Promise.all(
        activeCalls.map(async (toolCall: any, index: number) => {

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
                    } else if (typeof toolCall.args === "object" && toolCall.args !== null) {
                        Object.entries(toolCall.args as Record<string, any>).forEach(([key, value]) => {
                            inputArgs[key] = value !== null && value !== undefined ? String(value) : undefined;
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
                    
                    // 🟢 Inject UI Label from Orchestrator flawlessly 
                    if (result && typeof result === 'object' && toolCall.uiTabLabel) {
                        result.uiTabLabel = toolCall.uiTabLabel;
                    }

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

    // Check if any tool triggered an ambiguity breakout sentinel to prioritize clarifying bubbles over hallucinatory crashes flawlessly
    const standsAmbiguous = executedResults.some((item: any) => item && item.ambiguity === true);

    if (nodeError && !standsAmbiguous) {
        return { error: nodeError };
    }

    // 🟢 Stamp keys with iteration number to prevent cross-turn collisions in the accumulated toolResults dict flawlessly!
    // e.g. "maintenance_query_status_iter2_0" is unique even if Iteration 1 also ran "maintenance_query_status_0"
    const iterStamp = `iter${state.iterationCount || 0}`;
    executedResults.forEach((item: any) => {
        if (!item || item.result === null) return;
        const { name, index, result } = item;
        let key = `${name}_${iterStamp}`;
        if (outputs[key] !== undefined) {
            key = `${name}_${iterStamp}_${index}`; // 🟢 Further disambiguate parallel calls to same tool
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

    // 16MB MongoDB Crash Prevention: Pre-validate State Size
    // 🟢 Generic Architectural Fix: Defensive check for toolResults shape (Legacy Object vs. New Array) flawlessly!
  //  console.log(`[LangGraph Execute] 💾 State toolResults (${typeof state.toolResults}):`, JSON.stringify(state.toolResults).slice(0, 100));
    const rawHistory = state.toolResults;
    const history = Array.isArray(rawHistory) ? rawHistory : (rawHistory ? [rawHistory] : []);
    
    // Calculate total size including CURRENT turn results to prevent 16MB BSON limit crashes!
    const allTurns = [...history, outputs];
    const sizeInBytes = Buffer.byteLength(JSON.stringify(allTurns), 'utf8');
    const MAX_BYTES = 15000000; // 15MB safe limit

    let errorObj: any = null;
    if (sizeInBytes > MAX_BYTES) {
        console.warn(`[LangGraph Execute] 🚨 Payload size ${sizeInBytes} bytes exceeds 15MB safe limit. Routing to errorNode.`);
        errorObj = { error: `MongoInvalidArgumentError: Document is larger than the maximum size 16777216 bytes. Current size: ${sizeInBytes} bytes. Please refine your query to return less data.` };
    }

    if (finalMessageContent) {
        const { AIMessage } = await import("@langchain/core/messages");
        if (errorObj) {
            return {
                ...errorObj,
                messages: [...state.messages, new AIMessage({ content: finalMessageContent })]
            } as any;
        }
        return { 
            toolResults: outputs,
            messages: [...state.messages, new AIMessage({ content: finalMessageContent })]
        } as any;
    }

    return (errorObj ? errorObj : { toolResults: outputs }) as any;
}
