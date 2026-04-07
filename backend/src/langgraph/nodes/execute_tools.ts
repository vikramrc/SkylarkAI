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

    // 🟢 Parallel Tool Execution
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
                        workingMemory: state.workingMemory // 🟢 Auto-fill identifier support flawless!
                    };

                    // 🟢 GAP-29 FIX: Implement 25s tool execution timeout.
                    // This prevents a single hung MCP tool from blocking the entire LangGraph turn.
                    // 🟢 GAP-32 FIX: Store the timer handle and cancel it via .finally() so that when
                    // a tool completes before the deadline, the timer is cleared immediately rather
                    // than running as a dangling handle holding the event loop open.
                    let _timeoutHandle: ReturnType<typeof setTimeout>;
                    const _timeoutPromise = new Promise((_, reject) => {
                        _timeoutHandle = setTimeout(() => reject(new Error("Tool execution timed out after 25s")), 25000);
                    });
                    const result = await Promise.race([
                        tool.execute(inputArgs, contextMock).finally(() => clearTimeout(_timeoutHandle!)),
                        _timeoutPromise,
                    ]);
                    console.log(`[LangGraph Execute] ${sanitizedName} Result Preview: ${JSON.stringify(result).slice(0, 251)}...`);
                    
                    if (result && typeof result === 'object' && toolCall.uiTabLabel) {
                        result.uiTabLabel = toolCall.uiTabLabel;
                    }
                    
                    // 🟢 Only hide pure identity/discovery tools from the UI tabs!
                    // Previously we hid EVERYTHING executed during a FEED_BACK_TO_ME turn, 
                    // which caused multi-step data retrievals (like schedules -> machineries)
                    // to drop the intermediate tables before reaching the UI.
                    if (result && typeof result === 'object' && name === 'mcp.resolve_entities') {
                        result.__from_feedback_loop = true;
                    }

                    // 🟢 Capture tool failures as "data" so the Orchestrator can react to them flawlessly!
                    if (result && result.__ambiguity_stop === true) {
                        return { name, result, index, ambiguity: true };
                    } else if (result && (result.error === true || result.status === 'error' || result.success === false)) {
                        console.warn(`[LangGraph Execute] ⚠️ Tool ${sanitizedName} reported failure: ${result.message || JSON.stringify(result)}`);
                        return { name, index, result: { isError: true, message: result.message || JSON.stringify(result) } };
                    } else {
                        return { name, index, result };
                    }
                } catch (e: any) {
                    console.error(`[LangGraph Execute] 🚨 Tool ${sanitizedName} threw exception:`, e);
                    return { name, index, result: { isError: true, message: e.message || String(e) } };
                }
            } else {
                return { name, index, result: { isError: true, message: `Tool ${name} not found in registry.` } };
            }
        })
    );

    // Filter ambiguity breakouts
    const standsAmbiguous = executedResults.some((item: any) => item && item.ambiguity === true);

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
