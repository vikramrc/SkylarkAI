import type { SkylarkState } from "../state.js";
import { skylarkTools } from "../../mastra/tools.js"; // Reuse existing Mastra tools structure!

/**
 * nodeExecuteTools maps tool list and parallel executes them deterministic.
 */
export async function nodeExecuteTools(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const outputs: Record<string, any> = {};
    const calls = state.toolCalls || [];

    console.log(`[LangGraph] 🛠 Executing Tools: ${JSON.stringify(calls.map((c: any) => c.name || c))}`);
    console.log(`[LangGraph Execute] ⚙️ Execution mode: ${state.parallelizeTools === false ? '🔗 SEQUENTIAL' : '⚡ PARALLEL'}`);

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

    // ─── Single-Tool Execution Helper ────────────────────────────────────────
    // Extracted so the same logic can be used in both parallel and sequential paths.
    async function executeSingleTool(toolCall: any, index: number): Promise<any> {
        const name = typeof toolCall === "string" ? toolCall : toolCall.name;
        const args = toolCall.args || {};

        const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        const tool = (skylarkTools as any)[sanitizedName];

        // 🟢 Generic Architectural Fix: Resolved at Skylark end flawlessly!
        // Injected diagnostic tool to allow the AI to report its current memory filters.
        if (name === 'mcp.query_active_filters') {
            return {
                name,
                index,
                result: {
                    capability: 'mcp.query_active_filters',
                    activeFilters: state.workingMemory?.queryContext?.activeFilters || {}
                }
            };
        }

        // 🟢 mcp.clear_filters: deterministic filter reset without touching Phoenix.
        // Accepts optional `filters` arg (comma-separated list of keys to drop).
        // If omitted, clears ALL attribute filters — keeps only organizationID, organization, vesselID.
        if (name === 'mcp.clear_filters') {
            const ENTITY_KEYS = new Set(['organizationID', 'organization', 'vesselID', 'vessel']);
            const currentFilters: Record<string, string> = { ...(state.workingMemory?.queryContext?.activeFilters || {}) };

            // Parse which keys the Orchestrator wants to clear
            const rawArg = Array.isArray(args)
                ? args.find((a: any) => a.key === 'filters')?.value
                : (args as any)?.filters;

            let clearedKeys: string[];
            if (rawArg && String(rawArg).trim()) {
                // Specific list: clear only those keys
                clearedKeys = String(rawArg).split(',').map((k: string) => k.trim()).filter(Boolean);
            } else {
                // No list provided: clear all non-entity keys
                clearedKeys = Object.keys(currentFilters).filter(k => !ENTITY_KEYS.has(k));
            }

            clearedKeys.forEach(k => delete currentFilters[k]);

            // Mutate workingMemory so the next tool (in sequential mode) or the next Orchestrator turn
            // (in parallel mode) sees the clean state.
            if (state.workingMemory?.queryContext) {
                state.workingMemory.queryContext.activeFilters = currentFilters;
            }

            console.log(`[LangGraph Execute] 🧹 mcp.clear_filters cleared: [${clearedKeys.join(', ')}] → remaining: ${JSON.stringify(currentFilters)}`);

            return {
                name,
                index,
                result: {
                    capability: 'mcp.clear_filters',
                    clearedFilters: clearedKeys,
                    activeFilters: currentFilters
                }
            };
        }

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

                // ─── ObjectId Parameter Guard ─────────────────────────────────────────
                // Catches any ID-typed parameter that contains a human-readable label
                // (e.g. activityID="cxcxcccc") before it reaches the tool, preventing
                // unscoped DB queries that silently return wrong results.
                // This guard is universal — it covers every current and future tool.
                // Parameters in OBJECTID_EXCEPTIONS are known to legitimately accept
                // non-hex string values (e.g. org short-name, vessel name).
                const OBJECTID_PATTERN = /^[0-9a-fA-F]{24}$/;
                const OBJECTID_EXCEPTIONS = new Set([
                    'organizationID',      // can be resolved from shortName at tool level
                    'organizationShortName',
                    'organizationName',
                    'vesselName',
                ]);
                for (const [paramName, paramValue] of Object.entries(inputArgs)) {
                    if (
                        paramName.endsWith('ID') &&
                        !OBJECTID_EXCEPTIONS.has(paramName) &&
                        paramValue !== undefined &&
                        paramValue !== null &&
                        paramValue !== ''
                    ) {
                        if (!OBJECTID_PATTERN.test(String(paramValue))) {
                            console.warn(
                                `[LangGraph Execute] 🔴 ObjectId Guard: "${paramName}" received non-hex value "${paramValue}" for tool "${name}". ` +
                                `Rejecting — label used where a resolved 24-char hex ID is required.`
                            );
                            return {
                                name,
                                index,
                                result: {
                                    isError: true,
                                    objectIdViolation: true,
                                    message:
                                        `PARAMETER ERROR: "${paramName}" must be a 24-character hex ObjectId, but received "${paramValue}". ` +
                                        `This is a human-readable label, not a resolved ID. ` +
                                        `Check your resolvedLabels / sessionContext.scope for the correct "${paramName}" value and retry with the 24-char hex ID.`,
                                }
                            };
                        }
                    }
                }
                // ─────────────────────────────────────────────────────────────────────

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

                // 🟢 GAP-29 FIX: Implement per-tool execution timeout.
                // direct_query_fallback is a multi-step pipeline and regularly takes 30-40s
                // for complex analytical/aggregation queries.
                // maintenance_query_execution_history runs a deeply nested aggregation (4 lookups incl.
                // nested parts hydration via MaintenancePartUsage → InventoryPart) against potentially
                // thousands of AWH docs and regularly takes 25-40s with limit=100.
                // All other tools keep the 25s safety limit.
                // 🟢 GAP-32 FIX: Store the timer handle and cancel it via .finally() so that when
                // a tool completes before the deadline, the timer is cleared immediately rather
                // than running as a dangling handle holding the event loop open.
                const HEAVY_TOOLS = new Set(['direct_query_fallback', 'maintenance_query_execution_history']);
                const TOOL_TIMEOUT_MS = HEAVY_TOOLS.has(name) ? (name === 'direct_query_fallback' ? 90000 : 45000) : 25000;
                let _timeoutHandle: ReturnType<typeof setTimeout>;
                const _timeoutPromise = new Promise((_, reject) => {
                    _timeoutHandle = setTimeout(() => reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS);
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
                return {
                    name,
                    index,
                    result: {
                        isError: true,
                        capability: name.replace(/_/g, '.'), // e.g. maintenance_query_execution_history → maintenance.query.execution.history
                        toolName: name,
                        message: e.message || String(e),
                    }
                };
            }
        } else {
            return { name, index, result: { isError: true, message: `Tool ${name} not found in registry.` } };
        }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // 🟢 Branching execution strategy:
    //   parallelizeTools === false → sequential (tools run in declared order; state mutations
    //     like mcp.clear_filters complete before the next tool reads activeFilters)
    //   parallelizeTools === true (default) → parallel via Promise.all() (existing behavior)
    const executedResults: any[] = [];

    if (state.parallelizeTools === false) {
        // Sequential execution — each tool awaits completion before the next one starts.
        // This guarantees that mcp.clear_filters (or any state-mutating tool) fully commits
        // its in-place mutation to state.workingMemory.queryContext.activeFilters before
        // subsequent tools in the same turn read from it.
        for (let i = 0; i < activeCalls.length; i++) {
            const result = await executeSingleTool(activeCalls[i], i);
            executedResults.push(result);
        }
    } else {
        // Parallel execution — existing Promise.all() behavior, unchanged.
        const results = await Promise.all(
            activeCalls.map((toolCall: any, index: number) => executeSingleTool(toolCall, index))
        );
        executedResults.push(...results);
    }

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
            messages: [...state.messages, new AIMessage({ content: finalMessageContent })],
            // 🟢 AMBIGUITY HITL BRIDGE: Tell the next HTTP request that the user is answering
            // a clarifying question, not starting a fresh query. Without this flag,
            // update_memory2 resets Tier 2 (isNewQuery=true) and loses pendingIntents,
            // causing the Orchestrator to misinterpret the clarification answer as a new topic.
            isHITLContinuation: true,
        } as any;
    }

    return (errorObj ? errorObj : { toolResults: outputs }) as any;
}
