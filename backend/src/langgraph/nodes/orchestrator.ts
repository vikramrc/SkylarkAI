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
    reformulatedQuery: z.string().describe("Synthesize the entire conversational history (the original request plus any subsequent clarifications or filters) into a single, comprehensive goal statement. This should reflect your complete understanding of the user's final intent and parameters without assuming any missing constraints.").nullable(),
    reasoning: z.string().describe("Your internal technical thought process. If you pick FEED_BACK_TO_ME, explain exactly what gap you are trying to fill (e.g., 'Fetched Job IDs, now need to fetch their specific form contents' or 'Direct query failed, trying standard tool fallback')."),
    selectedResultKeys: z.array(z.string()).describe("A list of specific tool result keys (e.g., 'maintenance.query_status_iter2_0') from previous turns that you want to promote to the final answer and UI. If provided, the system will ONLY summarize and show these tools. Use this to skip re-running tools you already have data for."),
    unclassifiedLabels: z.array(z.object({
        label: z.string().describe("The ambiguous label or code extracted from the query (e.g., 'XXX1', 'Grease up')."),
        likelyEntityTypes: z.array(z.string()).describe("Top 3 most likely entity types from the supported mcp.resolve_entities list (e.g., 'Vessel', 'Machinery', 'Activity') based on Knowledge Graph and Context.")
    })).describe("Identify any strings in the user query for which you lack a verified 24-char ID or current memory mapping. Provide your best-guess types for them.")
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
        
        // 1. Find the last time the AI emitted a Summary (The Conversation Boundary)
        const lastSummaryIdx = [...messages].reverse().findIndex((m: any) => {
            const type = m._getType?.() || m.role || 'ai';
            return type === 'ai' && typeof m.content === 'string' && m.content.includes("[INSIGHT]");
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
                console.log(`\x1b[35m  To:   "${newTopic.substring(0, 60)}..."\x1b[0m`);
            } else {
                console.log(`\x1b[35m[Orchestrator] ⚓ Anchoring Topic: "${newTopic.substring(0, 60)}..."\x1b[0m`);
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
    
    // LEDGER: Scoped to the last 5 turns for key visibility + token diet.
    const ledgerTurns = history.slice(-5);
    
    // REQUEST CYCLE: Only the turns from THIS specific HTTP request (for journal + loop breaker).
    // These are used separately so the journal stays current-request-scoped.
    const requestCycleTurns = history.slice(state.startTurnIndex || 0);

    let resultsContext = "";
    const toolLines: string[] = [];
    
    // 🟢 Loop over the FULL ledger to build the headers and EXACT keys
    ledgerTurns.forEach((turn: any, tIdx: number) => {
        const iterNum = tIdx + 1; // Absolute turn count in history flawless!
        const entries = Object.entries(turn || {});
        
        // 🟢 ID Sniffing: Only perform heavy ID harvesting/preview for the LATEST turn results
        // This keeps the context window lean for the Orchestrator diet.
        const isLatestTurn = tIdx === history.length - 1;

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
    // Identify any labels that have ALREADY been searched in the current Turn and came back empty!
    // NOTE: Uses requestCycleTurns declared above (not a new declaration) — GAP-2 fix ensures this
    // is scoped to the current request only, not all of history.
    const failedSessionLabels = new Set<string>();
    requestCycleTurns.forEach((turn: any) => {
        Object.entries(turn || {}).forEach(([key, res]: [string, any]) => {
            if (key.includes('mcp.resolve_entities')) {
                const rawText = res?.content?.[0]?.text;
                if (!rawText) return;

                let data: any = null;
                try {
                    data = JSON.parse(rawText);
                } catch (e) {
                    if (rawText.toLowerCase().includes('no matches found')) {
                        const match = rawText.match(/for "(.*?)"/);
                        if (match && match[1]) {
                            failedSessionLabels.add(match[1].trim().toLowerCase());
                        }
                    }
                }

                if (data) {
                    const items = Array.isArray(data.items) ? data.items : [];
                    if (items.length === 0 && data.appliedFilters?.searchTerm) {
                        failedSessionLabels.add(data.appliedFilters.searchTerm.trim().toLowerCase());
                    }
                }
            }
        });
    });

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
    const labelStr = labelLines.length > 0
        ? `\n### 🆔 RESOLVED ENTITIES (Current Conversation)\n${labelLines.join('\n')}`
        : "";

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

    const memoryContext = [
        `\n### 🗂️ SESSION CONTEXT (Persists This Conversation)`,
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
    let finalToolCalls = filteredTools;
    let finalVerdict = response.feedBackVerdict;
    let finalReasoning = response.reasoning;

    // 🛡️ STRATEGIC FIX: Deterministic Unclassified Label Intercept (Identity Turn Mandate)
    // If the LLM identified unclassified labels, we must OVERRIDE any retrieval tools
    // and force a resolution pass. This prevents "hijacking" retrieval parameters.
    // 🟢 Section II.B Rule 3: Resolution is PREFERRED over asking a clarifying question immediately.
    // We now allow this even if response.clarifyingQuestion exists, prioritizing the resolution turn.
    const resolvedLabelSet = new Set(Object.keys((state.workingMemory?.sessionContext?.scope as any).resolvedLabels || {}));
    
    // 🟢 Loop Breaker Logic (Filtering AI and Interceptor)
    // failedSessionLabels is now pre-calculated at the start of the node.

    // 🟢 Filter AI-suggested unclassified labels
    const actualUnclassified = (response.unclassifiedLabels || []).filter((l: any) => {
        const lbl = (l.label || '').trim().toLowerCase();
        return !resolvedLabelSet.has(l.label) && !failedSessionLabels.has(lbl);
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
