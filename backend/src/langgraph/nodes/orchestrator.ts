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
    currentScope: z.array(z.string()).describe("Identify the specific 24-character Entity IDs from your ledger that map to the user's requested scope. You MUST use the hex IDs (e.g., '67eed...'), NOT tool result keys. If they say 'all vessels/fleet-wide', list EVERY discovered vessel ID here. If they say 'just XXX1', list only XXX1's ID. If the query does not target specific entities, return an empty array.").nullable(),
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
    reformulatedQuery: z.string().describe("Synthesize the entire conversational history (the original request plus any subsequent clarifications or filters) into a single, comprehensive goal statement. This should reflect your complete understanding of the user's final intent and parameters without assuming any missing constraints."),
    reasoning: z.string().describe("Your internal technical thought process. If you pick FEED_BACK_TO_ME, explain exactly what gap you are trying to fill (e.g., 'Fetched Job IDs, now need to fetch their specific form contents' or 'Direct query failed, trying standard tool fallback')."),
    selectedResultKeys: z.array(z.string()).describe("A list of specific tool result keys (e.g., 'maintenance.query_status_iter2_0') from previous turns that you want to promote to the final answer and UI. If provided, the system will ONLY summarize and show these tools. Use this to skip re-running tools you already have data for."),
    unclassifiedLabels: z.array(z.object({
        label: z.string().describe("The ambiguous label or code extracted from the query (e.g., 'XXX1', 'Grease up')."),
        likelyEntityTypes: z.array(z.string()).describe("Top 3 most likely entity types from the supported mcp.resolve_entities list (e.g., 'Vessel', 'Machinery', 'Activity') based on Knowledge Graph and Context.")
    })).describe("Identify any strings in the user query for which you lack a verified 24-char ID or current memory mapping. Provide your best-guess types for them."),
    isBroadScopeRequest: z.boolean()
        .describe(
            "Set to TRUE if the user explicitly requested a BROADER entity scope than previously active — " +
            "e.g., 'org-wide', 'fleet-wide', 'for all vessels', 'show me everything', 'ignore the vessel filter', 'across the organization'. " +
            "When true: (1) set currentScope to [], (2) do NOT recycle any prior vessel-specific tool results as sufficient, " +
            "(3) you MUST fetch fresh data at the org/fleet level. " +
            "NOTE: This flag ONLY releases entity-scope constraints (vesselID, machineryID, etc.). " +
            "Attribute filters (statusCode, date range, limit, department) are NOT controlled by this flag — " +
            "they follow the user's explicit instructions. Keep attribute filters the user didn't mention removing. " +
            "Set to FALSE for any request that narrows or maintains the existing entity scope."
        )
        .default(false)
});

// 🟢 Global Module-Level Cache for startup-once speedups
// ⚠️ GAP-17 NOTE: This cache is loaded once per process lifetime using the default organization ID from .env.
// In a true multi-tenant deployment where different orgs have different capability sets (feature flags),
// this cache should be keyed by organizationID. For a single-tenant deployment this is correct as-is.
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
    
    // 🟢 TOPIC ANCHORING: Find the "Mission Starting Question" flawlessly.
    // The Mission starts at the first Human message AFTER the last Summary ([INSIGHT]).
    let anchoredRawQuery = state.workingMemory?.queryContext?.rawQuery || "";
    
    if (!anchoredRawQuery || (state.iterationCount === 0 && !state.isHITLContinuation)) {
        const messages = state.messages || [];
        
        // 1. Find the last time the AI emitted a Summary (The Conversation Boundary).
        // NOTE: Summarizer output is stored as a plain object { role: 'assistant', content: '[INSIGHT]...' }
        // NOT as a LangChain AIMessage (_getType() = 'ai'). We must accept both role values.
        const lastSummaryIdx = [...messages].reverse().findIndex((m: any) => {
            const type = m._getType?.() || m.role || 'ai';
            return (type === 'ai' || type === 'assistant') && typeof m.content === 'string' && m.content.includes("[INSIGHT]");
        });

        // 2. The Current Topic is the FIRST human message after that boundary
        const scanStartIdx = lastSummaryIdx === -1 ? 0 : (messages.length - 1 - lastSummaryIdx);
        const currentMissionTopic = messages.slice(scanStartIdx).find((m: any) => {
            const type = m._getType?.() || m.role || 'human';
            return type === 'human';
        });

        if (currentMissionTopic) {
            const newTopic = (currentMissionTopic as any).content || "";
            if (anchoredRawQuery && anchoredRawQuery !== newTopic) {
                console.log(`\x1b[32m[Orchestrator] ⚓ TOPIC PIVOT DETECTED:\x1b[0m`);
                console.log(`\x1b[36m  From: "${anchoredRawQuery.substring(0, 60)}..."\x1b[0m`);
                console.log(`\x1b[33m  To:   "${newTopic.substring(0, 60)}..."\x1b[0m`);
            } else {
                console.log(`\x1b[33m[Orchestrator] ⚓ USER QUERY: "${newTopic.substring(0, 60)}..."\x1b[0m`);
            }

            anchoredRawQuery = newTopic;
        }
    }

    // Use OpenAI's native Structured Outputs API (jsonSchema method).
    // This is the correct binding for models that output JSON as text content rather than tool calls.
    // It guarantees schema-conformant output deterministically, unlike the default function-calling binding.
    const model = new ChatOpenAI({
        modelName: process.env.MASTRA_ORCHESTRATOR_QUERY_MODEL || "gpt-5-mini",
    }).withStructuredOutput(orchestratorSchema, { name: "orchestrator_plan", method: "jsonSchema", includeRaw: true } as any);




    // ─────────────────────────────────────────────────────────────────
    // LEDGER vs. DATA SPLIT (GAP-4 FIX)
    // ─────────────────────────────────────────────────────────────────
    // We provide a "Technical Ledger" (keys + one-line headers) for recent results so the AI can
    // identify and re-select data from a prior conversation without re-running the tool.
    //
    // GAP-4 FIX: We cap the ledger at the LAST 5 TURNS (not all history).
    // Rationale from Section 62 (Orchestrator Diet):
    //   - The Section 62 "Diet" exists to prevent token explosion in deep multi-turn sessions.
    //   - The full history can reach 30 turns (×5 tools = 150 header lines per call).
    //   - 5 turns is enough to cover any active investigation window while keeping tokens bounded.
    //   - For truly old data, the AI's `currentScope` (Notebook) and `secondaryScope` (7-conv ledger)
    //     carry the entity IDs that matter — the Orchestrator doesn't need the raw result headers.
    // ─────────────────────────────────────────────────────────────────
    const history = Array.isArray(state.toolResults) ? state.toolResults : (state.toolResults ? [state.toolResults] : []);
    
    // REQUEST CYCLE: Only the turns from THIS specific HTTP request (for journal + loop breaker).
    const requestCycleTurns = history.slice(state.startTurnIndex || 0);

    // ─────────────────────────────────────────────────────────────────
    // LEDGER ISOLATION FOR BROAD SCOPE REQUESTS
    // ─────────────────────────────────────────────────────────────────
    // NORMAL MODE: Scoped to the last 5 turns (diet to prevent token explosion on deep multi-turn sessions).
    //
    // BROAD SCOPE MODE: Scoped to the CURRENT REQUEST only (requestCycleTurns).
    //
    // WHY: In broad-scope mode, prior vessel-specific results (e.g., maintenance.query_execution_history
    // with vesselID from Conv 1) are stale and insufficient for the org-wide request. Showing them to
    // the LLM causes it to erroneously re-select them ("I already have cancelled jobs data") and call
    // no new tools, instead of fetching a fresh org-wide result. Restricting the ledger to the current
    // request turns eliminates this temptation deterministically — the LLM only sees what was fetched
    // FOR this broad-scope request, and is forced to plan the correct next retrieval step.
    // ─────────────────────────────────────────────────────────────────
    const isBroadScopeActive = (state.workingMemory as any)?.queryContext?.isBroadScope === true;
    const ledgerTurns = isBroadScopeActive ? requestCycleTurns : history.slice(-5);

    if (isBroadScopeActive && requestCycleTurns.length < history.slice(-5).length) {
        console.log(`\x1b[35m[Orchestrator] 🌐 BROAD SCOPE LEDGER ISOLATION: Restricting tool result context to current-request turns only (${requestCycleTurns.length} turns vs ${history.slice(-5).length} in last-5 window). Prior vessel-specific results hidden.\x1b[0m`);
    }

    let resultsContext = "";
    const toolLines: string[] = [];
    
    // 🟢 Loop over the FULL ledger to build the headers and EXACT keys
    ledgerTurns.forEach((turn: any, tIdx: number) => {
        const iterNum = tIdx + 1; // Absolute turn count in history flawless!
        const entries = Object.entries(turn || {});
        
        // 🟢 ID Sniffing: Only perform heavy ID harvesting/preview for the LATEST turn results
        // This keeps the context window lean for the Orchestrator diet.
        // FIX (Bug A): Use ledgerTurns.length-1, NOT history.length-1.
        // tIdx is an index into ledgerTurns (which may be a subset of history in broad scope mode).
        // Using history.length-1 caused isLatestTurn to always be false in broad scope,
        // meaning ID harvesting never fired on the latest discovery results.
        const isLatestTurn = tIdx === ledgerTurns.length - 1;

        entries.forEach(([key, res]: [string, any]) => {
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

            // 🟢 Generic ID Sniffer: Only harvest relational IDs from the LATEST turn results
            // to save tokens and prevent context window explosion.
            let extractedIds: string[] = [];
            if (isLatestTurn) {
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
            }
            // Limit to 15 to prevent context window explosion
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
        // 🟢 Ledger Registry: Provide exact keys to prevent LLM hallucination
        const allAvailableKeys = ledgerTurns.flatMap((turn: any) => Object.keys(turn || {}));
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

    // ─────────────────────────────────────────────────────────────────
    // DECISION JOURNAL — TOOL MATCHING (GAP-2 FIX)
    // ─────────────────────────────────────────────────────────────────
    // The journal's mandate is: "Do NOT repeat the SAME Tool+Parameter in the CURRENT REQUEST."
    // This prevents pointless re-fetches within a single agentic loop (e.g., fetching fleet
    // overview twice in the same chain because the AI forgot it already did it).
    //
    // GAP-2 FIX: This MUST use requestCycleTurns, NOT ledgerTurns.
    // Using ledgerTurns (full history) would show tools from PREVIOUS conversations in the journal.
    // The AI would then refuse to re-run a tool from yesterday's conversation even if the user
    // explicitly asks for fresh data today, because the journal says "already done".
    // ─────────────────────────────────────────────────────────────────
    requestCycleTurns.forEach((turn: any) => {
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

    // 🟢 Loop Breaker Logic (Request-Local):
    // Identify labels that have been searched in the current request cycle and TRULY came back empty
    // across ALL entity types. A label is only a "dead-end" if every parallel resolve call for it
    // returned zero items. If even ONE entity type returned a match, it is NOT a dead-end.
    //
    // 🐛 BUG FIX (GAP-77): The old logic added a searchTerm to failedSessionLabels for every
    // individual empty result. When parallel calls fired for Vessel/Machinery/Activity and only
    // Machinery and Activity came back empty (Vessel returned 1 match), "xxx1" was still being
    // flagged as failed — causing the DEAD-END LABELS block to fire incorrectly and mandate a
    // clarifying question even though the entity was clearly resolved.
    //
    // Fix: two-pass approach — first tally hit counts per searchTerm, then only mark as failed
    // if total hits across all entity types is zero.
    const resolveHits = new Map<string, number>();  // searchTerm (lower) -> total items found

    requestCycleTurns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, res]: [string, any]) => {
            if (!key.includes('mcp.resolve_entities')) return;

            const rawText = res?.content?.[0]?.text;
            if (!rawText) return;

            let data: any = null;
            try {
                data = JSON.parse(rawText);
            } catch (e) {
                // Non-JSON response — check for explicit "no matches" message
                if (rawText.toLowerCase().includes('no matches found')) {
                    const match = rawText.match(/for "(.*?)"/);
                    if (match && match[1]) {
                        const lbl = match[1].trim().toLowerCase();
                        if (!resolveHits.has(lbl)) resolveHits.set(lbl, 0);
                        // Zero contribution from this call — leave count as-is
                    }
                }
                return;
            }

            if (data && data.appliedFilters?.searchTerm) {
                const lbl = data.appliedFilters.searchTerm.trim().toLowerCase();
                const count = Array.isArray(data.items) ? data.items.length : 0;
                resolveHits.set(lbl, (resolveHits.get(lbl) ?? 0) + count);
            }
        });
    });

    // Only labels whose TOTAL hit count across all entity types is 0 are true dead-ends
    const failedSessionLabels = new Set<string>(
        Array.from(resolveHits.entries())
            .filter(([, total]) => total === 0)
            .map(([lbl]) => lbl)
    );


    // 🟢 GAP-8 FIX: Explicitly mandate a clarifying question when all resolution guesses fail
    const deadEndStr = failedSessionLabels.size > 0 
        ? `\n\n🛡️ DEAD-END LABELS (Verified NOT FOUND This Turn):\n${Array.from(failedSessionLabels).map(l => `- "${l}": Checked multiple entity types. No matches found. Do NOT retry resolution for this label.`).join('\n')}\n⚠️ MANDATORY ACTION: Since the entity could not be found, you MUST set \`clarifyingQuestion\` to ask the user in plain language (e.g., "I couldn't find 'XXX1' — could you double-check the name, or tell me what type of record it is?"). Set \`tools\` to []  and \`feedBackVerdict\` to SUMMARIZE.`
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

    // 🟢 Ambiguity Context (Collisions)
    const ambiguityStr = session?.scope?.ambiguousMatches?.length 
        ? `\n⚠️ AMBIGUITY DETECTED ⚠️
The following labels matched MULTIPLE distinct entities. You MUST ask the user for type clarification (e.g., "Is 'XXX1' a Vessel or Machinery?") before proceeding.
${session.scope.ambiguousMatches.map((m: any) => `  - "${m.label}" matches: ${m.candidates.map((c: any) => `${c.label} (${c.type})`).join(', ')}`).join('\n')}`
        : "";

    // ─── SECONDARY SCOPE ACCUMULATION: Reliably store any 'currentScope' ID output by the LLM
    const secondaryLines: string[] = (session?.secondaryScope || []).map(entry => 
        `  - [${entry.modelType}] ${entry.name} → ID = "${entry.id}" (Conv ${entry.conversationIndex})`
    );
    // 🟢 GAP-1 FIX: Explicitly tell the LLM that resolvedLabels takes precedence over secondaryScope
    // This prevents cross-session ID conflicts if a label was re-seeded between conversations.
    const secondaryStr = secondaryLines.length > 0
        ? `\n### 🗃️ SECONDARY SCOPE (Last 7 Conversations, current Conv ${convCount})\n${secondaryLines.join('\n')}\n⚠️ PRECEDENCE RULE: If the same entity appears in both SECONDARY SCOPE and RESOLVED ENTITIES below, the RESOLVED ENTITIES entry is newer and takes priority.`
        : "";

    // ─── RESOLVED LABELS (Current Conversation Mappings)
    const resolvedLabels = (session?.scope as any)?.resolvedLabels || {};
    const labelLines: string[] = Object.entries(resolvedLabels).map(([label, info]: [string, any]) => 
        `  - ✅ ${info.type} resolved: ${label} (ID: ${info.id})`
    );

    // ─────────────────────────────────────────────────────────────────
    // FIX — VESSEL GRAVITY SUPPRESSION
    // When broad scope is active, SUPPRESS the RESOLVED ENTITIES block from the LLM prompt entirely.
    // Rationale: resolvedLabels (e.g. "XXX1 → 683b...") acts as a magnet — even with the
    // 🌐 BROAD SCOPE warning present, the LLM gravitates toward the concrete vessel ID it sees
    // directly above it in the prompt. The data stays in state (so the user can re-scope back
    // to a vessel at any time), but is hidden from the LLM during org-wide investigations.
    // ─────────────────────────────────────────────────────────────────
    const isBroadScopeActiveForPrompt = (query as any)?.isBroadScope === true;
    const labelStr = (!isBroadScopeActiveForPrompt && labelLines.length > 0)
        ? `\n### 🆔 RESOLVED ENTITIES (Current Conversation)\n${labelLines.join('\n')}`
        : "";

    if (isBroadScopeActiveForPrompt && labelLines.length > 0) {
        console.log(`\x1b[35m[Orchestrator] 🚫 VESSEL GRAVITY SHIELD: Suppressed ${labelLines.length} resolvedLabel(s) from prompt (broad scope active). IDs stay in state.\x1b[0m`);
    }

    // ─── ORG CONTEXT GUARD (replaces passive scopeLine) ──────────────────────
    // When no org is in memory AND it's not a HITL continuation (user answering
    // a previous clarifying question), we inject a hard mandatory block so the
    // LLM cannot "decide" to proceed without org context.
    const hasOrgContext = !!(
        session?.scope?.organizationID ||
        session?.scope?.organizationShortName
    );

    // 🟢 BUG-1 FIX: org-from-messages fallback.
    // When the user provides the org name via a HITL reply, it lives in the message history
    // but has NOT yet been promoted to sessionContext.scope (that happens in update_memory2
    // AFTER execute_tools runs). On the FEED_BACK_TO_ME loop-back turn, isHITLContinuation
    // has already been reset to false by update_memory2, so the naive check
    // `!hasOrgContext && !isHITLContinuation` would re-fire the ORG MISSING warning even
    // though the org WAS provided. We detect this by scanning the message window for a
    // short human reply that immediately follows an AI clarifying question.
    let orgFoundInMessages = false;
    if (!hasOrgContext) {
        const msgs = state.messages || [];
        for (let i = msgs.length - 1; i >= 1; i--) {
            const cur = msgs[i] as any;
            const prev = msgs[i - 1] as any;
            const curType = cur._getType?.() || cur.role || 'human';
            const prevType = prev._getType?.() || prev.role || 'ai';
            if (curType === 'human' && (prevType === 'ai' || prevType === 'assistant')) {
                const prevContent: string = prev.content || '';
                // If the preceding AI message looks like a short clarifying question, treat
                // this human reply as a potential org answer and suppress the warning.
                if (prevContent.includes('?') && prevContent.length < 400) {
                    orgFoundInMessages = true;
                    console.log(`\x1b[33m[Orchestrator] 🛡️ OrgGuard: Org not yet in scope but detected HITL Q→A pair in messages. Suppressing ORG MISSING warning.\x1b[0m`);
                    break;
                }
            }
        }
    }

    // isHITLContinuation = true means the user just replied to our clarifying
    // question — suppress the warning so the LLM reads the answer from history.
    const shouldShowOrgWarning = !hasOrgContext && !state.isHITLContinuation && !orgFoundInMessages;

    const orgContextBlock = shouldShowOrgWarning
        ? `⚠️ ORG CONTEXT MISSING — MANDATORY CHECK ⚠️
No organization is currently set in session memory. 
You MUST check the user's current query:
- IF the user PROVIDED an organization short name in their query, you have permission to proceed with Resolution or Discovery using that name. HOWEVER, if the request implies a "per-vessel" or "fleet-wide" scope, you must comply with the Discovery-First Mandate: do NOT call data-retrieval tools directly at the organization level. You MUST use a tool like fleet.query_overview to resolve the vessels first, ensuring that subsequent turns have the canonical Vessel IDs needed for parallel investigation.
- IF the user DID NOT provide an organization short name, you are FORBIDDEN from calling tools. You MUST set \`clarifyingQuestion\` to ask for their organization short name only, set \`tools\` to [], and set \`feedBackVerdict\` to SUMMARIZE.`
        : hasOrgContext
            // Scope is populated — show the confirmed org for grounding
            ? `✅ Org confirmed: ${session?.scope?.organizationShortName || session?.scope?.organizationID}${session?.scope?.organizationID ? ` (ID: ${session.scope.organizationID})` : ""}`
            // isHITLContinuation=true or org found in message history — LLM must read org from conversation
            : `✅ HITL Continuation Active: The user has just answered your clarifying question. Extract the organization from their latest message and use it directly in your tool calls. ⚠️ CRITICAL MANDATE: The Discovery-First Mandate still applies! If the request implies a "per-vessel" or "fleet-wide" scope, you MUST use fleet.query_overview first to resolve the vessels. DO NOT call data-retrieval tools directly at the organization level without vessel IDs.`;

    // 🌐 BROAD SCOPE OVERRIDE BLOCK: Inject when user explicitly requested org/fleet-wide data.
    // This prevents the LLM from recycling prior vessel-specific results in subsequent iterations.
    const broadScopeStr = query?.isBroadScope
        ? `\n🌐 BROAD SCOPE MODE ACTIVE — User explicitly requested org/fleet-wide data in this conversation.\n` +
          `⚠️ MANDATORY: Prior vessel-specific tool results (e.g., single-vessel data from a prior conversation) are INSUFFICIENT. ` +
          `You MUST fetch fresh data at the organization or fleet level. ` +
          `Do NOT populate currentScope with historical vessel IDs from secondaryScope — leave it empty until fresh discovery runs.\n` +
          `🔎 ATTRIBUTE FILTERS: Apply your Active Filters (statusCode, date range, etc.) at the new broader scope ` +
          `UNLESS the user's latest message explicitly removed a specific filter (e.g., 'ignore the date range').`
        : "";

    // ─────────────────────────────────────────────────────────────────
    // SYSTEM INTERCEPT INJECTION
    // Passes previous turn's forced interruption reasoning into the prompt
    // so the LLM isn't flying blind on the re-run.
    //
    // FIX (Bug B): Gate strictly on (currentIter === 1 && prevTurnWasDiscovery).
    // state.reasoning persists forever in LangGraph state. Without this gate,
    // a stale [DISCOVERY STALL GUARD] reason from turn 1 of request A would
    // re-inject into turn 0 of request B (a completely unrelated future query)
    // because state.reasoning was never cleared. Now it only fires when we are
    // on the exact turn that follows the intercepted discovery turn.
    // ─────────────────────────────────────────────────────────────────
    const prevTurnWasDiscoveryForIntercept = Object.keys((Array.isArray(state.toolResults) ? state.toolResults : [])[( Array.isArray(state.toolResults) ? state.toolResults : []).length - 1] || {}).some(
        k => k.includes('fleet.query_overview') || k.includes('resolve_entities')
    );
    const systemInterceptStr = (
        (state.iterationCount || 0) > 0 &&
        prevTurnWasDiscoveryForIntercept &&
        state.reasoning &&
        (state.reasoning.includes('[DISCOVERY STALL GUARD]') || state.reasoning.includes('[DETERMINISTIC VESTIBULE]'))
    )
        ? `\n🛑 SYSTEM INTERCEPT (Previous Turn): ${state.reasoning}\n`
        : "";

    const memoryContext = [
        `\n### 🗂️ SESSION CONTEXT (Persists This Conversation)`,
        systemInterceptStr,
        broadScopeStr,
        orgContextBlock,
        longTermStr,
        summaryStr,
        secondaryStr,
        labelStr,
        query?.rawQuery || anchoredRawQuery
            ? `\n### 🔎 CURRENT QUERY CONTEXT\nQuery: "${query?.rawQuery || anchoredRawQuery}"\nPending: ${JSON.stringify(query?.pendingIntents || [])}\nActive Filters: ${JSON.stringify(query?.activeFilters || {})}\nLast Turn: "${query?.lastTurnInsight || ""}"\ncurrentScope (Organic Discoveries): [${(query?.currentScope || []).join(', ')}]` 
            : "",
        resultsContext,
        deadEndStr,
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
        // 🟢 GAP-13 FIX: Must pass c.optionalQuery (not c.requiredQuery) for correct descriptions
        const optStr = (c.optionalQuery || []).map((p: string) => `${p}: ${getParameterDescription(p, c.optionalQuery || [])}`).join("\n    ");

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
        // Option C: Passing the Full QnA Sequence cleanly via the unified summary buffer
        let qnaTranscript = "";
        const session = state.workingMemory?.sessionContext || {};
        const summaryBuffer = session.summaryBuffer || [];
        
        if (summaryBuffer.length > 0) {
            qnaTranscript = summaryBuffer.map((s: any) => `HUMAN: ${s.q}\n\nASSISTANT: ${s.a}`).join('\n\n');
            qnaTranscript += "\n\n";
        }
        
        const currentQuery = state.reformulatedQuery || state.workingMemory?.queryContext?.rawQuery || "";
        if (currentQuery) {
            qnaTranscript += `HUMAN: ${currentQuery}`;
        }
        
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
    // toolResults are summarized to 32-char previews to prevent log bloat from large MCP payloads.
    const toolResultsDigest = (state.toolResults || []).map((turn: any, i: number) => {
        const entries: Record<string, string> = {};
        Object.entries(turn || {}).forEach(([key, res]: [string, any]) => {
            const text: string = res?.content?.[0]?.text || res?.text || '';
            entries[key] = text.length > 0 ? `${text.substring(0, 32)}…` : '(empty)';
        });
        return { turn: i, keys: entries };
    });

    const debugDump = {
        sessionContext: state.workingMemory?.sessionContext,
        queryContext: state.workingMemory?.queryContext,
        toolResults: toolResultsDigest,
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
    let finalToolCalls = filteredTools;
    let finalVerdict = response.feedBackVerdict;
    let finalReasoning = response.reasoning;

    // ─────────────────────────────────────────────────────────────────
    // FIX — DISCOVERY STALL GUARD
    // ─────────────────────────────────────────────────────────────────
    // A "discovery turn" runs fleet.query_overview or mcp.resolve_entities to get entity IDs.
    // Its ONLY purpose is to feed those IDs into the NEXT retrieval tool call.
    // If the LLM decides to SUMMARIZE after a discovery turn without calling any retrieval tool,
    // the discovery was completely pointless — the user gets a fleet overview instead of the
    // actual data they asked for.
    //
    // Guard fires EXACTLY ONCE (iter === 1 only) to force the LLM back into the loop.
    // If LLM still returns no tools on the re-attempt (iter=2+), allow graceful degradation
    // to prevent infinite loops.
    // ─────────────────────────────────────────────────────────────────
    const currentIter = state.iterationCount || 0;
    const rawToolResults = Array.isArray(state.toolResults) ? state.toolResults : [];
    const prevTurnKeys = Object.keys(rawToolResults[rawToolResults.length - 1] || {});
    const prevTurnWasDiscovery = prevTurnKeys.some(k =>
        k.includes('fleet.query_overview') ||
        k.includes('resolve_entities')
    );

    // ─────────────────────────────────────────────────────────────────
    // FIX: Replace hasPendingIntents with hasRetrievalInCurrentRequest.
    //
    // PREVIOUS BUG: hasPendingIntents relied on UpdateMemory2's LLM output.
    // When fleet.query_overview ran and returned 7 vessels, UpdateMemory2 marked
    // pendingIntents as [] ("nothing left to do") — neutralizing the stall guard
    // even though no actual retrieval tool (maintenance history, statuses etc)
    // had been called yet. UpdateMemory2 is context memory, NOT an enforcement signal.
    //
    // NEW APPROACH: Purely code-level. Scan requestCycleTurns (tools run in THIS
    // HTTP request only) for any key that is NOT a discovery tool. If no retrieval
    // tool has run yet in this request cycle AND the previous turn was discovery,
    // the guard should fire.
    // ─────────────────────────────────────────────────────────────────
    const DISCOVERY_KEY_PATTERNS = [
        'fleet.query_overview', 
        'mcp.resolve_entities', 
        'fleet.query_structures', 
        'maintenance.query_schedules',
        'mcp.health', 
        'mcp.capabilities'
    ];
    const isDiscoveryKey = (k: string) => DISCOVERY_KEY_PATTERNS.some(p => k.includes(p));
    const requestCycleToolResults = rawToolResults.slice(state.startTurnIndex || 0);
    const hasRetrievalInCurrentRequest = requestCycleToolResults.some(turn =>
        Object.keys(turn || {}).some(k => !isDiscoveryKey(k))
    );

    if (
        currentIter === 1 &&              // Only fire on the first post-discovery turn
        prevTurnWasDiscovery &&           // Previous turn was a discovery tool
        !hasRetrievalInCurrentRequest &&  // No retrieval tool has run yet this request cycle (pure code check)
        finalToolCalls.length === 0 &&    // LLM wants to stop with no retrieval tool
        finalVerdict === 'SUMMARIZE'      // LLM wants to summarize discovery output directly
    ) {
        console.warn(
            `\x1b[41m\x1b[97m[Orchestrator] \ud83d\uded1 DISCOVERY STALL GUARD FIRED\x1b[0m\x1b[31m` +
            ` — Previous turn was discovery (${prevTurnKeys.join(', ')}) but current turn proposes` +
            ` no retrieval tools.` +
            ` hasRetrievalInCurrentRequest=${hasRetrievalInCurrentRequest} | iter=${currentIter}` +
            ` — Overriding verdict to FEED_BACK_TO_ME.\x1b[0m`
        );
        finalVerdict = 'FEED_BACK_TO_ME';
        finalReasoning = `[DISCOVERY STALL GUARD] Prior discovery turn (${prevTurnKeys.join(', ')}) completed ` +
            `successfully but was immediately followed by a SUMMARIZE with no retrieval tools. ` +
            `The vessel/entity IDs discovered MUST be used to call a specific retrieval tool ` +
            `(e.g., maintenance.query_execution_history). Looping back to execute the retrieval step.`;
    } else if (prevTurnWasDiscovery) {
        console.log(
            `\x1b[32m[Orchestrator] \u2705 DISCOVERY STALL CHECK: Guard not triggered.\x1b[0m` +
            ` iter=${currentIter} | prevWasDiscovery=${prevTurnWasDiscovery}` +
            ` | hasRetrieval=${hasRetrievalInCurrentRequest}` +
            ` | toolCalls=${finalToolCalls.length} | verdict=${finalVerdict}`
        );
    }

    // 🛡️ STRATEGIC FIX: Deterministic Unclassified Label Intercept (Identity Turn Mandate)
    // If the LLM identified unclassified labels, we must OVERRIDE any retrieval tools
    // and force a resolution pass. This prevents "hijacking" retrieval parameters.
    // 🟢 Section II.B Rule 3: Resolution is PREFERRED over asking a clarifying question immediately.
    // We now allow this even if response.clarifyingQuestion exists, prioritizing the resolution turn.
    const resolvedLabelSet = new Set(Object.keys((state.workingMemory?.sessionContext?.scope as any).resolvedLabels || {}));
    
    // 🟢 Loop Breaker Logic (Filtering AI and Interceptor)
    // failedSessionLabels is now pre-calculated at the start of the node.

    // 🟢 Filter AI-suggested unclassified labels
    // Two layers of protection:
    //   1. Prompt instruction (orchestrator_rules.ts) tells the LLM not to put descriptive phrases here.
    //   2. This code-level guard is the last line of defence — if the LLM still misfires (e.g. classifies
    //      "ALL cancelled jobs" as an entity label), we reject it before wasting a resolve turn.
    //
    // Rejection rules (any one match = rejected):
    //   a) Already resolved in this session
    //   b) Already failed in this session (loop-breaker)
    //   c) Starts with a scope/quantifier word (ALL, ANY, EVERY, DETAILS, SHOW, GET, FIND)
    //   d) Contains a maintenance status word (cancelled, completed, overdue, committed, missed, rescheduled)
    //   e) Empty or whitespace-only label
    //   f) Label longer than 40 chars (no real named entity is a sentence)
    const QUANTIFIER_PREFIXES = /^(all|any|every|details|show|get|find|list|retrieve)\b/i;
    const STATUS_WORDS = /\b(cancelled|completed|overdue|committed|missed|rescheduled|upcoming|pending)\b/i;

    const actualUnclassified = (response.unclassifiedLabels || []).filter((l: any) => {
        const lbl = (l.label || '').trim();
        const lblLower = lbl.toLowerCase();
        if (!lbl) return false;                           // (e) empty
        if (lbl.length > 40) return false;                // (f) sentence-length → not an entity name
        if (QUANTIFIER_PREFIXES.test(lbl)) return false;  // (c) starts with scope word
        if (STATUS_WORDS.test(lbl)) return false;          // (d) contains status word
        if (resolvedLabelSet.has(l.label)) return false;  // (a) already resolved
        if (failedSessionLabels.has(lblLower)) return false; // (b) already failed
        return true;
    });


    // 🟢 Filter AI-suggested Tool Calls (Prevent redundant resolution loops)
    // If the tool is mcp.resolve_entities and the searchTerm is in failedSessionLabels, skip it!
    finalToolCalls = finalToolCalls.filter((t: any) => {
        if (t.name === 'mcp.resolve_entities') {
            const searchTerm = (t.args || []).find((a: any) => a.key === 'searchTerm')?.value;
            if (searchTerm && typeof searchTerm === 'string') {
                const lbl = searchTerm.trim().toLowerCase();
                if (failedSessionLabels.has(lbl)) {
                    console.log(`\x1b[33m[LangGraph Orchestrator] 🛡️ Loop Breaker: Blocking redundant resolution call for "${searchTerm}" (already failed this turn)\x1b[0m`);
                    return false;
                }
            }
        }
        return true;
    });

    if (actualUnclassified.length > 0) {
        const resolutionTools: any[] = [];
        const scope = (state.workingMemory as any)?.sessionContext?.scope;
        
        // 🔎 DEEP CONTEXT THIEVERY: 
        // If memory hasn't saved the org yet, we look everywhere for it!
        let orgID = scope?.organizationID;
        let orgShortName = scope?.organizationShortName;

        const isValidOrgValue = (val: any): val is string => typeof val === 'string' && val.trim() !== '';

        if (!orgID && !orgShortName) {
            // 1. Scan AI's current (timid) tool args
            response.tools?.forEach((t: any) => {
                const args = t.args || [];
                const idArg = args.find((a: any) => a.key === 'organizationID')?.value;
                const nameArg = args.find((a: any) => a.key === 'organizationShortName')?.value;
                if (isValidOrgValue(idArg)) orgID = idArg;
                if (isValidOrgValue(nameArg)) orgShortName = nameArg;
            });

            // 2. Scan AI's reformulated query for the short name (e.g., "for Fleetships...")
            if (!orgShortName && response.reformulatedQuery) {
                // Heuristic: check last human message if reformulated query mentions a known pattern
                // but for now, we'll look at the messages directly for broader coverage.
            }

            // 3. Scan the LATEST human message as last resort — trust the AI's reformulated query first
            // 🟢 GAP-5 FIX: REMOVED hardcoded 'fleetships' test-org heuristic. Production orgs have
            // arbitrary names, so a hardcoded check would silently fail for all non-test environments.
            // The AI's own tool args (step 1) are the reliable extraction path. If org is still
            // missing after all checks, let the ORG CONTEXT MISSING guardrail handle it cleanly.
            // (No action needed here — the HITL clarifying question path will ask the user.)
        }

        const orgKey = orgID ? "organizationID" : (orgShortName ? "organizationShortName" : null);
        const orgValue = orgID || orgShortName;

        if (orgKey && orgValue && !shouldShowOrgWarning) {
            actualUnclassified.forEach((item: any) => {
                // Only resolve types explicitly guessed by the grounded AI (Capped at 3)
                if (Array.isArray(item.likelyEntityTypes) && item.likelyEntityTypes.length > 0) {
                    item.likelyEntityTypes.slice(0, 3).forEach((type: string) => {
                        resolutionTools.push({
                            name: "mcp.resolve_entities",
                            uiTabLabel: `Identity Turn: Resolving '${item.label}'`,
                            confidence: 1.0,
                            args: [
                                { key: "searchTerm", value: item.label },
                                { key: "entityType", value: type },
                                { key: orgKey, value: orgValue }
                            ]
                        });
                    });
                }
            });
        }

        if (resolutionTools.length > 0) {
            console.warn(`\x1b[33m[LangGraph Orchestrator] 🛡️ Strategic Intercept: Diverting Turn ${state.iterationCount || 0} to Resolution for ${response.unclassifiedLabels.length} labels.\x1b[0m`);
            finalToolCalls = resolutionTools; // 🔥 TURN DIVERGENCE: Retrieval plan is PAUSED.
            finalVerdict = 'FEED_BACK_TO_ME';  // 🔥 FORCE the loop to return after resolution.
            finalReasoning = `[DETERMINISTIC VESTIBULE] Intercepted turn to resolve unclassified labels: ${response.unclassifiedLabels.map((l: any) => l.label).join(', ')}. Retrieval plan will be re-evaluated after identity confirmation.`;
        }
    }

    const updates: Partial<SkylarkState> = {
        toolCalls: finalToolCalls,
        feedBackVerdict: finalVerdict,
        reasoning: finalReasoning,
        // 🟢 Persist the LLM's reformulated query so the Summarizer can use it
        // as the clean 'q:' field in the summaryBuffer instead of the raw, fragmented rawQuery.
        // Only update when the LLM provides a non-empty value; otherwise keep prior value.
        ...(response.reformulatedQuery ? { reformulatedQuery: response.reformulatedQuery } : {}),
        iterationCount: nextIterationCount,
        // 🟢 CRITICAL: Must be explicit `false`, NOT `undefined`.
        // The graph reducer is: (x, y) => y !== undefined ? y : x
        // Setting `undefined` is treated as "no write" — the reducer keeps the old `true`
        // from the prior HITL turn, causing the conditional edge to route to __end__ again
        // on the very next turn, silently killing the tool execution. `false` is explicit.
        hitl_required: false,
        // 🟢 BUG-2 FIX: Explicitly reset isHITLContinuation to false on the normal (non-HITL) tool path.
        // Without this, the reducer (y ?? x) sees y=undefined and preserves the checkpoint's `true`
        // from the previous HITL turn — causing update_memory2 to skip its Tier-2 reset, and
        // causing the orgContextBlock on the loop-back turn to incorrectly show "HITL Continuation"
        // even after the turn has been fully processed.
        isHITLContinuation: false,
        error: undefined,
        selectedResultKeys: response.selectedResultKeys || []
    };


    // 🟢 SMART PROMOTION BRIDGE: If we are summarizing WITH actual retrieval tools (no HITL interrupt),
    // automatically promote all current-turn tools to selectedResultKeys.
    // Guard: skip if clarifyingQuestion is set — that path zeroes out toolCalls and goes to HITL.
    // 🟢 BUG-3 FIX: Use updates.feedBackVerdict (the authoritative written value) not response.feedBackVerdict
    // (raw LLM output). The HITL guard below may override response.feedBackVerdict to 'SUMMARIZE',
    // causing the Smart Promotion check to fire incorrectly on a HITL turn.
    if (updates.feedBackVerdict === 'SUMMARIZE' && response.tools.length > 0 && !response.clarifyingQuestion) {
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
    
    // 🟢 BUG-3 FIX: Use updates.feedBackVerdict (authoritative) not response.feedBackVerdict (raw)
    if (updates.feedBackVerdict === 'SUMMARIZE' && !response.clarifyingQuestion) {
        updates.workingMemory.queryContext.currentScope = []; // Reset transient query scope
    }

    // 🌐 BROAD SCOPE OVERRIDE: Deterministic enforcement when LLM signals isBroadScopeRequest=true.
    // We do NOT trust the LLM to clear currentScope itself — we force it in code.
    if (response.isBroadScopeRequest === true) {
        console.warn(`\x1b[35m[LangGraph Orchestrator] 🌐 BROAD SCOPE OVERRIDE ACTIVE: User requested fleet/org-wide scope. Clearing prior entity-scope filters.\x1b[0m`);
        // 1. Force currentScope to drop previouslyAccumulated old IDs, keeping ONLY new organic discoveries (if any)
        updates.workingMemory.queryContext.currentScope = incomingIds;
        // 2. Emit the flag to state so UpdateMemory2 can persist isBroadScope and drop entity-scope activeFilters
        updates.isBroadScopeRequest = true;
    } else {
        updates.isBroadScopeRequest = false; // Explicit reset so reducer doesn't inherit stale true
    }

    // 🟢 HITL Guard: If there is a clarifying question, append it to messages so the Summarizer can look at it.
    // 🛡️ PRECEDENCE GUARD: If we already intercepted this turn for Resolution (finalReasoning contains DIVERGENCE),
    // we SUPPRESS the clarifying question until the resolution pass completes.
    if (response.clarifyingQuestion && !finalReasoning?.includes('DETERMINISTIC VESTIBULE')) {
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
