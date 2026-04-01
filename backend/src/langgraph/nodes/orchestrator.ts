import { ChatOpenAI } from "@langchain/openai";
import { injectMaritimeKnowledge } from "../utils/knowledge_loader.js";
import { loadOrchestratorPrompt } from "../utils/prompt_loader.js";
import { z } from "zod";
import axios from "axios";
import https from "https";
import type { SkylarkState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import { getParameterDescription } from "../../mcp/capabilities/contract.js";

// 1. Define Structured Output Schema
export const orchestratorSchema = z.object({
    currentScope: z.array(z.string()).describe("Identify the specific Entity IDs from your ledger that map to the user's requested scope. If they say 'all vessels/fleet-wide', list EVERY discovered vessel ID here. If they say 'just XXX1', list only XXX1's ID. If the query does not target specific entities, return an empty array.").nullable(),
    tools: z.array(z.object({
        name: z.string().describe("The dot-separated tool name (e.g., maintenance.query_status)"),
        uiTabLabel: z.string().describe("A short, user-friendly title for this tool's UI tab, summarizing the context or specific filters applied (e.g., 'Overdue Tasks', 'Global Checklists', 'Deck Operations')."),
        confidence: z.number().min(0).max(1).describe("Your confidence in this tool call (0.0 to 1.0). Use < 0.6 if you are guessing; >= 0.9 if you are grounded in a verified ID."),
        args: z.array(z.object({
            key: z.string().describe("The argument key/parameter name (e.g., organizationID)"),
            value: z.union([z.string(), z.number(), z.boolean()]).describe("The value for this parameter")
        })).describe("Arguments for the tool call as key-value pairs.")
    })).describe("List of MCP tool names and their arguments to execute in parallel."),
    feedBackVerdict: z.enum(['SUMMARIZE', 'FEED_BACK_TO_ME']).describe("Decide whether the results should be fed back for sequential chain investigation or passed straight to the Summarizer."),
    clarifyingQuestion: z.string().describe("Use this to Ask the user a question if mandatory parameters (e.g., Organization ID/Name) are missing and no tools can be called.").nullable(),
    reformulatedQuery: z.string().describe("Synthesize the entire conversational history (the original request plus any subsequent clarifications or filters) into a single, comprehensive goal statement. This should reflect your complete understanding of the user's final intent and parameters without assuming any missing constraints.").nullable(),
    reasoning: z.string().describe("Your internal technical thought process. If you pick FEED_BACK_TO_ME, explain exactly what gap you are trying to fill (e.g., 'Fetched Job IDs, now need to fetch their specific form contents' or 'Direct query failed, trying standard tool fallback')."),
    selectedResultKeys: z.array(z.string()).describe("A list of specific tool result keys (e.g., 'maintenance.query_status_iter2_0') from previous turns that you want to promote to the final answer and UI. If provided, the system will ONLY summarize and show these tools. Use this to skip re-running tools you already have data for.")
});

// 🟢 Global Module-Level Cache for multitenant startup-once speedups
let capabilitiesCache: any[] = [];
let capabilitiesLoadPromise: Promise<any[]> | null = null;

async function getCapabilitiesCached(backendUrl: string, params: any): Promise<any[]> {
    if (capabilitiesCache.length > 0) return capabilitiesCache;
    if (capabilitiesLoadPromise) return capabilitiesLoadPromise;

    console.log(`\x1b[36m[Orchestrator] 📄 Loading capabilities cache for the first time...\x1b[0m`);
    capabilitiesLoadPromise = (async () => {
        try {
            const https = await import('https');
            const axios = (await import('axios')).default;
            const response = await axios.get(`${backendUrl}/api/mcp/capabilities`, {
                params,
                httpsAgent: new https.Agent({ rejectUnauthorized: false })
            });
            capabilitiesCache = (response.data.capabilities || [])
                .sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""));
            console.log(`\x1b[32m[Orchestrator] ✅ Loaded ${capabilitiesCache.length} capabilities into global cache\x1b[0m`);
        } catch (error: any) {
            console.error("[LangGraph Orchestrator] Failed to fetch raw capabilities:", error.message);
            capabilitiesLoadPromise = null; // 🟢 Clear promise lock so next requests can retry
        }
        return capabilitiesCache;
    })();

    return capabilitiesLoadPromise;
}

export async function nodeOrchestrator(state: SkylarkState): Promise<Partial<SkylarkState>> {
    console.log(`[LangGraph] ▶ Orchestrator Node invoked (Iteration: ${state.iterationCount || 0})`);
    
    // 🟢 TOPIC ANCHORING: Ensure the investigation has a stable "Notebook" entry from the very first turn.
    // This prevents "HITL Context Collapse" where the AI forgets the original question after a clarifying loop.
    let anchoredRawQuery = state.workingMemory?.queryContext?.rawQuery || "";
    if (!anchoredRawQuery) {
        // Look for the initial human message of THIS investigation cycle
        const messages = state.messages || [];
        const startIdx = state.startTurnIndex || 0;
        const initialHumanMsg = messages.slice(startIdx).find((m: any) => {
           const type = m._getType?.() || m.role || 'human';
           return type === 'human';
        });
        if (initialHumanMsg) {
            anchoredRawQuery = (initialHumanMsg as any).content || "";
            console.log(`\x1b[35m[LangGraph Orchestrator] ⚓ Anchoring Topic: "${anchoredRawQuery.substring(0, 60)}..."\x1b[0m`);
        }
    }

    // Use OpenAI's native Structured Outputs API (jsonSchema method).
    // This is the correct binding for models that output JSON as text content rather than tool calls.
    // It guarantees schema-conformant output deterministically, unlike the default function-calling binding.
    const model = new ChatOpenAI({
        modelName: process.env.MASTRA_ORCHESTRATOR_QUERY_MODEL || "gpt-5-mini",
    }).withStructuredOutput(orchestratorSchema, { name: "orchestrator_plan", method: "jsonSchema", includeRaw: true } as any);




    // Compute currentTurns (used in both resultsContext and decisionJournal building)
    const history = Array.isArray(state.toolResults) ? state.toolResults : (state.toolResults ? [state.toolResults] : []);
    const currentTurns = history.slice(state.startTurnIndex || 0).slice(-1); // 🟢 Orchestrator Diet: Only see the latest turn's results

    let resultsContext = "";
    const toolLines: string[] = [];
    
    currentTurns.forEach((turn: any, tIdx: number) => {
        const iterNum = (state.startTurnIndex || 0) + tIdx + 1; // 1-indexed human turn count flawless!
        Object.entries(turn || {}).forEach(([key, res]) => {
            let data: any = res;
            let errorMsg = "";
            let isError = !!data?.isError;

            if (data?.content?.[0]?.text) {
                const text = data.content[0].text;
                if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                    try { 
                        data = JSON.parse(text); 
                        isError = isError || !!data?.isError;
                    } catch {}
                } else if (isError) {
                    errorMsg = text;
                }
            }
            if (isError && !errorMsg) {
                errorMsg = data?.error || data?.message || "Unknown tool execution error";
            }

            const label = data?.uiTabLabel || key;
            const items = Array.isArray(data?.items) ? data.items : [];
            const count = items.length;
            
            const filters = data?.appliedFilters || {};
            const filterParts = Object.entries(filters)
                .filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'organizationID')
                .map(([k, v]) => `${k}:${v}`);
            const fLabel = filterParts.length > 0 ? ` [filters: ${filterParts.join(', ')}]` : '';

            // Per-tool counts if available (Restored for high-fidelity reasoning)
            const overdue = items.filter((i: any) => i?.isOverdue === true || i?.statusCode === 'overdue').length;
            const upcoming = items.filter((i: any) => i?.isUpcoming === true || i?.statusCode === 'upcoming').length;
            const totalAvailable = data?.summary?.overdueCount !== undefined
                ? `total available: overdue=${data.summary.overdueCount} upcoming=${data.summary.upcomingCount}`
                : '';

            // 🟢 Generic ID Sniffer: Extract ANY database IDs for the Orchestrator to use in chained calls without guessing
            let extractedIds: string[] = [];
            items.forEach((item: any) => {
                Object.entries(item).forEach(([k, v]) => {
                    // Extract any string field ending in 'ID' or exactly '_id'
                    if (typeof v === 'string' && (k.endsWith('ID') || k === '_id' || k.endsWith('Id'))) {
                        // Skip organizationID to prevent noise, only harvest relational IDs
                        if (k !== 'organizationID' && k !== 'organizationId') {
                            const pair = `${k}:${v}`;
                            if (!extractedIds.includes(pair)) extractedIds.push(pair);
                        }
                    }
                });
            });
            // Limit to 15 to prevent context window explosion on massive arrays
            const idPreview = extractedIds.length > 0 ? ` | Extracted Keys: [${extractedIds.slice(0, 15).join(', ')}]` : '';

            let line = `- Key: "${key}" | Label: "${label}"${fLabel} | Count: ${count} items (Turn ${iterNum})${idPreview}`;
            if (isError) {
                line = `- Key: "${key}" | Label: "${label}"${fLabel} | Turn ${iterNum} | ❌ TOOL FAILED WITH ERROR: ${errorMsg}`;
            } else if (count === 0) {
                line += ` | ⚠️ EMPTY — no matching records exist for this vessel+filter`;
            } else {
                if (overdue > 0 || upcoming > 0) line += ` | returned: overdue=${overdue}, upcoming=${upcoming}`;
                if (totalAvailable) line += ` | ${totalAvailable}`;
                if (count < 2 && count > 0) line += ` | ⚠️ only ${count} match exists — database has no more records for this vessel+filter`;
            }
            toolLines.push(line);
        });
    });

    if (toolLines.length > 0) {
        // 🟢 Inject exact key list to prevent LLM from guessing key names with wrong suffixes (e.g., _0)
        const allAvailableKeys = currentTurns.flatMap((turn: any) => Object.keys(turn || {}));
        resultsContext = `\n\n### PREVIOUS TOOL RESULTS IN THIS REQUEST:\n${toolLines.join('\n')}\n\n⚠️ EXACT KEY REFERENCE (Copy verbatim into selectedResultKeys — do NOT add or remove suffixes):\n${allAvailableKeys.map(k => `  "${k}"`).join('\n')}\n\n(Consult the 'DEDUPLICATION & CONDUCTOR RULES' in your system instructions for how to handle these results.)`;
    }

    // 🟢 SESSION DECISION JOURNAL: Parse messages and tool results to create a causal log of THIS query cycle only.
    const journalEntries: string[] = [];
    const messages = state.messages || [];
    const questionTurns = messages.slice(state.startTurnIndex || 0);

    // Initialize the journal with the user's initial query in this session
    let currentEntry: { question?: string; answer?: string; tools: string[] } | null = null;
    if (questionTurns.length > 0) {
        const firstMsg = questionTurns[0] as any;
        const type = firstMsg._getType?.() || firstMsg.role || 'human';
        if (type === 'human') {
            currentEntry = { question: firstMsg.content, tools: [] };
        }
    }

    questionTurns.forEach((msg, idx) => {
        const type = (msg as any)._getType?.() || (msg as any).role || 'human';
        if (type === 'ai' && (msg as any).content) {
            const content = (msg as any).content;
            // A clarifying question usually contains a "?" or marks a new conversational turn
            if (content.includes("?") || idx > 0) {
                if (currentEntry) {
                    journalEntries.push(`? Q: ${currentEntry.question || 'Initial Query'}\n✓ A: ${currentEntry.answer || 'Awaiting User Reply'}\n🚀 Actions: ${currentEntry.tools.join(', ') || 'None'}`);
                }
                currentEntry = { question: content, tools: [] };
            }
        } else if (type === 'human' && idx > 0) {
            // This is an answer to a previous AI question
            if (currentEntry) currentEntry.answer = (msg as any).content;
        }
    });

    // Match tools into the journal entries
    currentTurns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, res]: [string, any]) => {
            const filters = (res as any)?.appliedFilters || {};
            const filterStr = Object.entries(filters).filter(([k,v]) => v).map(([k,v]) => `${k}:${v}`).join(',');
            const entryStr = `${key}(${filterStr})`;
            if (currentEntry) {
                currentEntry.tools.push(entryStr);
            }
        });
    });

    if (currentEntry) {
        journalEntries.push(`? Q: ${currentEntry.question || 'Query Content'}\n✓ A: ${currentEntry.answer || 'Awaiting Execution'}\n🚀 Actions: ${currentEntry.tools.length > 0 ? currentEntry.tools.join(', ') : 'None yet'}`);
    }

    const decisionJournal = journalEntries.length > 0 
        ? `\n\n### 📓 SESSION DECISION JOURNAL (Current Query Only):\n${journalEntries.join('\n---\n')}\n\n**MANDATE**: You MUST consult this Journal to avoid redundant work. Do NOT repeat the exact same Tool+Parameter combination unless requested. HOWEVER, if the user asks a follow-up question requiring new or related data (e.g., asking for Invoices linked to prior POs), you MUST proactively execute the relevant new tool calls to continue the investigation.`
        : "";

    // ─── TWO-TIER MEMORY CONTEXT ASSEMBLY (after all components are declared) ─────
    const session = state.workingMemory?.sessionContext;
    const query = state.workingMemory?.queryContext;

    const convCount = session?.humanConversationCount ?? 0;

    // 🟢 Long Term Buffer (Deep Compression History)
    const longTermStr = session?.longTermBuffer 
        ? `\n### 📚 LONG TERM HISTORY\n${session.longTermBuffer}`
        : "";

    // 🟢 Summary Buffer (Verbatim Recent Q&A History)
    const summaryLines: string[] = (session?.summaryBuffer || []).map(entry => 
        `Q: ${entry.q}\nA: ${entry.a}\n(Conv ${entry.conversationIndex})`
    );
    const summaryStr = summaryLines.length > 0
        ? `\n### 🛰️ RECENT OBSERVATIONAL MEMORY\n${summaryLines.join('\n---\n')}`
        : "";

    // 🟢 Secondary Scope (Concrete Entity IDs)
    const secondaryLines: string[] = (session?.secondaryScope || []).map(entry => 
        `  - [${entry.modelType}] ${entry.name} → ID = "${entry.id}" (Conv ${entry.conversationIndex})`
    );
    const secondaryStr = secondaryLines.length > 0
        ? `\n### 🗃️ SECONDARY SCOPE (Last 7 Conversations, current Conv ${convCount})\n${secondaryLines.join('\n')}`
        : "";

    // ─── ORG CONTEXT GUARD (replaces passive scopeLine) ──────────────────────
    // When no org is in memory AND it's not a HITL continuation (user answering
    // a previous clarifying question), we inject a hard mandatory block so the
    // LLM cannot "decide" to proceed without org context.
    const hasOrgContext = !!(
        session?.scope?.organizationID ||
        session?.scope?.organizationShortName
    );
    // isHITLContinuation = true means the user just replied to our clarifying
    // question — suppress the warning so the LLM reads the answer from history.
    const shouldShowOrgWarning = !hasOrgContext && !state.isHITLContinuation;

    const orgContextBlock = shouldShowOrgWarning
        ? `⚠️ ORG CONTEXT MISSING — MANDATORY CHECK ⚠️
No organization is currently set in session memory. 
You MUST check the user's current query:
- IF the user PROVIDED an organization short name in their query, you have permission to proceed with Resolution or Discovery using that name. HOWEVER, if the request implies a "per-vessel" or "fleet-wide" scope, you must comply with the Discovery-First Mandate: do NOT call data-retrieval tools directly at the organization level. You MUST use a tool like fleet.query_overview to resolve the vessels first, ensuring that subsequent turns have the canonical Vessel IDs needed for parallel investigation.
- IF the user DID NOT provide an organization short name, you are FORBIDDEN from calling tools. You MUST set \`clarifyingQuestion\` to ask for their organization short name only, set \`tools\` to [], and set \`feedBackVerdict\` to SUMMARIZE.`
        : hasOrgContext
            // Scope is populated — show the confirmed org for grounding
            ? `✅ Org confirmed: ${session?.scope?.organizationShortName || session?.scope?.organizationID}${session?.scope?.organizationID ? ` (ID: ${session.scope.organizationID})` : ""}`
            // isHITLContinuation=true but scope not yet persisted — LLM must read org from conversation
            : `✅ HITL Continuation Active: The user has just answered your clarifying question. Extract the organization from their latest message. ⚠️ CRITICAL MANDATE: The Discovery-First Mandate still applies! If the request implies a "per-vessel" or "fleet-wide" scope, you MUST use fleet.query_overview first to resolve the vessels. DO NOT call data-retrieval tools directly at the organization level without vessel IDs.`;

    const memoryContext = [
        `\n### 🗂️ SESSION CONTEXT (Persists This Conversation)`,
        orgContextBlock,
        longTermStr,
        summaryStr,
        secondaryStr,
        query?.rawQuery || anchoredRawQuery
            ? `\n### 🔎 CURRENT QUERY CONTEXT\nQuery: "${query?.rawQuery || anchoredRawQuery}"\nPending: ${JSON.stringify(query?.pendingIntents || [])}\nActive Filters: ${JSON.stringify(query?.activeFilters || {})}\nLast Turn: "${query?.lastTurnInsight || ""}"\ncurrentScope (Organic Discoveries): [${(query?.currentScope || []).join(', ')}]` 
            : "",
        resultsContext,
        decisionJournal,
    ].filter(Boolean).join('\n');

    console.log(`\n\x1b[36m[Orchestrator] 🧠 Memory Context Injected:\x1b[0m\n${memoryContext}\n`);


    const systemInstruction = loadOrchestratorPrompt();

    const iterationCount = state.iterationCount || 0;
    const isSequentialTurn = iterationCount > 0;
    const sequentialInstruction = isSequentialTurn 
        ? `\n\n### 🔄 SYSTEM FLAG: ITERATIVE TURN\nYou are currently on follow-up turn #${iterationCount}. Consult the 'TERMINATION & DEDUPLICATION' guidelines in your constitution to determine if further retrieval is necessary.`
        : "";
        
    const backendUrl = process.env.PHOENIX_CLOUD_URL || 'https://localhost:3000';
    const params = { organizationID: process.env.PHOENIX_CLOUD_ORGANIZATION_ID || "" };
    
    // 🟢 Use Global Cache flawlessly triggers
    const baseCapabilitiesContract = await getCapabilitiesCached(backendUrl, params);


    const toolDetails = baseCapabilitiesContract.map((c: any) => {
        // Fetch canonical required/optional queries before normalization just to render detail
        const reqStr = (c.requiredQuery || []).map((p: string) => `${p}: ${getParameterDescription(p, c.requiredQuery || [])}`).join("\n    ");
        const optStr = (c.optionalQuery || []).map((p: string) => `${p}: ${getParameterDescription(p, c.requiredQuery || [])}`).join("\n    ");

        return `- **${c.name}**
  * Purpose: ${c.purpose}
  * Required Params:
    ${reqStr || "None"}
  * Optional Params:
    ${optStr || "None"}
  * Typical Questions: ${c.typicalQuestions?.map((q: string) => `"${q}"`).join(", ") || "None"}
  * When to Use: ${c.whenToUse || "None"}
  * When NOT to Use: ${c.whenNotToUse || "None"}
  * Interpretation Guidance: ${c.interpretationGuidance || "None"}`;
    }).join("\n\n");

    // 🟢 Append local direct_query_fallback tool flawlessly flaws
    const finalToolDetails = `${toolDetails}\n\n- **direct_query_fallback**
  * Purpose: Direct database search and MongoQL query. Use this only when no other specific MCP tool endpoint matches the required filters or data scope.
  * Required Params:
    userQuery: The precise natural language dataset query to search against the Phoenix database.
  * Optional Params:
    None
  * Response Shape: [success, source, data]`;

    const formattedInstruction = systemInstruction.replace("%%TOOL_CONTEXT%%", finalToolDetails);

    // 🟢 FIX: Inline memory context into the single system message.
    // Previously this was a second system message block, which caused OpenAI's jsonSchema
    // structured output mode to double-emit the response (the model re-applies its schema
    // binding on each system-role boundary). Inlining into one system message restores
    // the pre-MD-migration prompt structure and eliminates the double-emit trigger.
    const memoryBlock = (memoryContext || sequentialInstruction)
        ? `\n\n### OBSERVATIONAL MEMORY CONTEXT\n${memoryContext}${sequentialInstruction}`
        : "";

    const promptMessages = [
        { role: "system", content: `${formattedInstruction}${memoryBlock}` } as any,
    ];

    if (iterationCount > 0) {
        // Option C: Passing the Full QnA Sequence
        const qnaTranscript = state.messages
            .filter((m: any) => m.content && typeof m.content === 'string')
            .map((m: any) => {
                const type = m._getType?.() || m.role || 'human';
                return `${type.toUpperCase()}: ${m.content}`;
            })
            .join('\n\n');
        
        const syntheticBody = `🎯 CURRENT INVESTIGATION CONTEXT
Review the conversation history below to understand the final unified goal.

--- CONVERSATION HISTORY ---
${qnaTranscript}
--- END HISTORY ---

Instruction: Proceed with your investigation based on the complete context provided above.`;

        promptMessages.push({ role: "user", content: syntheticBody } as any);
        console.log(`\x1b[35m[LangGraph Orchestrator] 🧠 Masking fragmented chat objects with Unified QnA Transcript prompt.\x1b[0m`);
    } else {
        // Turn 0: Must read raw message objects so the Orchestrator can ingest the user's latest text naturally
        promptMessages.push(...state.messages);
    }

    console.log(`\x1b[36m[LangGraph Orchestrator] --- PROMPT SENT TO LLM ---\x1b[0m`);
    
    // 🟢 Console Visibility Optimization: Dump only the critical debugging objects
    const debugDump = {
        sessionContext: state.workingMemory?.sessionContext,
        queryContext: state.workingMemory?.queryContext,
        toolResults: state.toolResults,
        activeMessages: promptMessages.filter(m => m.role !== 'system')
    };
    
    console.log(`\x1b[35m[DEBUG] State & Scope Context:\x1b[0m`);
    console.dir(debugDump, { depth: null, colors: true });

    let response: any;
    let result: any;
    try {
        result = await model.invoke(promptMessages);
        response = result.parsed;

        // 🟢 Log Token Caching Savings
        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("Orchestrator", result);
    } catch (error: any) {
        const { logLLMError } = await import("../utils/logger.js");
        logLLMError("Orchestrator", error);
        return { error: `Orchestrator Node crashed: ${error.message}` };
    }

    console.log(`[LangGraph Orchestrator Output]`, JSON.stringify(response, null, 2));

    if (!response) {
        console.error(`[LangGraph Orchestrator] 🚨 LLM returned null — attempting defensive JSON recovery...`);

        // 🟢 DEFENSIVE RECOVERY: The LLM can occasionally double-emit its JSON output
        // (e.g. "JSON\nJSON") under certain multi-system-message prompt conditions,
        // causing structured output parsing to fail. Before crashing, attempt to
        // extract and validate the FIRST valid JSON chunk from the raw content string.
        let recovered = false;
        if (result?.raw) {
            const rawContent: string | undefined = (result.raw as any)?.kwargs?.content ?? (result.raw as any)?.content;
            if (rawContent) {
                try {
                    // Safe formatting: wrap in array and replace boundaries to safely parse double-JSON arrays
                    const arrayWrapped = `[${rawContent.replace(/}\s*{/g, '},{')}]`;
                    const parsedArray = JSON.parse(arrayWrapped);
                    if (Array.isArray(parsedArray) && parsedArray.length > 0) {
                        const validation = orchestratorSchema.safeParse(parsedArray[0]);
                        if (validation.success) {
                            console.warn(`[LangGraph Orchestrator] ⚠️ Recovered valid structured output from raw double-emit (array wrap).`);
                            response = validation.data;
                            recovered = true;
                        }
                    }
                } catch {
                    // Fallback: try parsing assuming trailing garbage
                    try {
                        // Extract first JSON object using simple brace counting if regex/array fails
                        let braceCount = 0;
                        let endIndex = -1;
                        const start = rawContent.indexOf('{');
                        if (start !== -1) {
                            for (let i = start; i < rawContent.length; i++) {
                                if (rawContent[i] === '{') braceCount++;
                                else if (rawContent[i] === '}') braceCount--;
                                if (braceCount === 0) {
                                    endIndex = i;
                                    break;
                                }
                            }
                            if (endIndex !== -1) {
                                const parsed = JSON.parse(rawContent.substring(start, endIndex + 1));
                                const validation = orchestratorSchema.safeParse(parsed);
                                if (validation.success) {
                                     console.warn(`[LangGraph Orchestrator] ⚠️ Recovered valid structured output via brace counting.`);
                                     response = validation.data;
                                     recovered = true;
                                }
                            }
                        }
                    } catch {}
                }
            }

            if (!recovered) {
                console.error(`[LangGraph Orchestrator] 📄 Raw LLM Response:`, JSON.stringify(result.raw, null, 2));
                const refusal = result.raw.response_metadata?.refusal || (result.raw as any).refusal;
                if (refusal) console.error(`[LangGraph Orchestrator] 🛑 LLM Refusal: ${refusal}`);
            }
        }

        if (!recovered) {
            return { error: `Orchestrator failed to generate a valid plan. The model did not return a conformant response. Please try again.` };
        }
    }


    // 🟢 ANTI-PLACEHOLDER GUARD: Strictly enforce the Sequential Turn Mandate.
    // If the LLM ignored Rule II.5 and emitted a tool call with a placeholder like "<from_...>",
    // we MUST strip it out before execution to prevent validation errors.
    // NOTE: t.args is [{key, value}] — NOT a plain object. Object.values() would return the
    // pair objects themselves (never strings). We must check arg.value directly.
    const filteredTools = (response.tools || []).filter((t: any) => {
        const hasPlaceholder = (t.args || []).some((arg: any) =>
            typeof arg.value === 'string' && (arg.value.includes('<') || arg.value.includes('>'))
        );
        if (hasPlaceholder) {
            const offenders = (t.args || []).filter((a: any) => typeof a.value === 'string' && (a.value.includes('<') || a.value.includes('>')));
            console.warn(`\x1b[33m[LangGraph Orchestrator] 🛡️ Anti-Placeholder Guard: Stripped tool "${t.name}" — placeholder args: ${offenders.map((a: any) => `${a.key}="${a.value}"`).join(', ')}\x1b[0m`);
            return false;
        }
        return true;
    });

    const nextIterationCount = (state.iterationCount || 0) + 1;
    const updates: Partial<SkylarkState> = {
        toolCalls: filteredTools,
        feedBackVerdict: response.feedBackVerdict,
        reasoning: response.reasoning,
        iterationCount: nextIterationCount,
        hitl_required: undefined,
        error: undefined,
        selectedResultKeys: response.selectedResultKeys || []
    };


    // 🟢 SMART PROMOTION BRIDGE: If we are summarizing WITH actual retrieval tools (no HITL interrupt),
    // automatically promote all current-turn tools to selectedResultKeys.
    // Guard: skip if clarifyingQuestion is set — that path zeroes out toolCalls and goes to HITL.
    if (response.feedBackVerdict === 'SUMMARIZE' && response.tools.length > 0 && !response.clarifyingQuestion) {
        console.log(`[LangGraph Orchestrator] 🚀 Smart Promotion Active: Verifying UI visibility for ${response.tools.length} current tools...`);
        response.tools.forEach((t: any, idx: number) => {
            // Skip discovery/infrastructure tools in the UI unless explicitly named
            if (t.name === 'mcp.resolve_entities') return;
            
            // Generate the prospective keys that execute_tools will use
            const baseKey = `${t.name}_iter${nextIterationCount}`;
            const indexedKey = `${baseKey}_${idx}`;
            
            if (!updates.selectedResultKeys!.includes(baseKey)) updates.selectedResultKeys!.push(baseKey);
            if (!updates.selectedResultKeys!.includes(indexedKey)) updates.selectedResultKeys!.push(indexedKey);
        });
        console.log(`[LangGraph Orchestrator] 🎯 Promoted Keys:`, JSON.stringify(updates.selectedResultKeys));
    }

    // 🟢 SECONDARY SCOPE ACCUMULATION: Reliably store any 'currentScope' ID output by the LLM
    // across all iterations, so it's not lost if the final SUMMARIZE turn outputs []
    const incomingIds: string[] = (response.currentScope || []).filter((id: any) => typeof id === 'string' && id.length > 0);
    const previouslyAccumulated = state.workingMemory?.queryContext?.currentScope || [];
    const finalIdsToPromote = [...new Set([...previouslyAccumulated, ...incomingIds])];

    if (!updates.workingMemory) updates.workingMemory = { 
        sessionContext: state.workingMemory?.sessionContext || { scope: {} },
        queryContext: state.workingMemory?.queryContext || { rawQuery: anchoredRawQuery, pendingIntents: [], activeFilters: {}, lastTurnInsight: '' }
    };
    updates.workingMemory.queryContext = {
        ...updates.workingMemory.queryContext,
        rawQuery: updates.workingMemory.queryContext.rawQuery || anchoredRawQuery, // Preserve anchor
        currentScope: finalIdsToPromote
    } as any;

    // NOTE: secondaryScope lock-in and 7-conversation pruning is now handled natively
    // in the summarizer node by parsing the [ENTITIES] block, eliminating Orchestrator guesswork.
    
    if (response.feedBackVerdict === 'SUMMARIZE' && !response.clarifyingQuestion) {
        updates.workingMemory.queryContext.currentScope = []; // Reset transient query scope
    }


    // If there is a clarifying question, append it to messages so the Summarizer can look at it
    if (response.clarifyingQuestion) {
        updates.messages = [new AIMessage(response.clarifyingQuestion)];
        updates.feedBackVerdict = 'SUMMARIZE';
        updates.hitl_required = true;
        updates.isHITLContinuation = true;
        updates.toolCalls = [];
    }

    if (response.currentScope && response.currentScope.length > 0) {
        console.log(`\x1b[35m[LangGraph Orchestrator] 🔍 Derived currentScope: [${response.currentScope.length} entities]\x1b[0m`);
    }

    if (response.reformulatedQuery) {
        console.log(`\x1b[33m[LangGraph Orchestrator] 🔄 Reformulated Ask: "${response.reformulatedQuery}"\x1b[0m`);
    }

    console.log(`[LangGraph Orchestrator] Verdict: ${updates.feedBackVerdict} | Tools Requested: ${JSON.stringify(response.tools.map((t: any) => `${t.name} (conf: ${t.confidence})`))} | Selection: ${JSON.stringify(updates.selectedResultKeys)}`);

    return updates;
}
