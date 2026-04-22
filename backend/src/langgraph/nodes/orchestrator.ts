import { ChatOpenAI } from "@langchain/openai";
import { injectMaritimeKnowledge } from "../utils/knowledge_loader.js";
import { loadOrchestratorPrompt } from "../utils/prompt_loader.js";
import { z } from "zod";
import axios from "axios";
import https from "https";
import type { SkylarkState } from "../state.js";
import { AIMessage } from "@langchain/core/messages";
import { getParameterDescription } from "../../mcp/capabilities/contract.js";
import { resolveEntities } from "../../mcp/capabilities/lookup_logic.js";

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
    reformulatedQuery: z.string().describe(
        "Read ONLY the '### 📋 CONVERSATION JOURNAL' block in your context to build this field. " +
        "Synthesize the user's evolving goal from T1 forward into a single clean, end-state-oriented sentence. " +
        "Rules: " +
        "(1) Express only the END GOAL — what data or answer the user ultimately wants. " +
        "(2) Update it as each journal entry adds new context (e.g. a [User Reply] confirming vessel or type narrows the goal — incorporate that). " +
        "(3) STRICTLY FORBIDDEN: do NOT include orchestrator internal reasoning, disambiguation steps, 'need to determine' clauses, or open questions. Those belong in 'reasoning', not here. " +
        "(4) If you are in the middle of a HITL disambiguation, write the goal as it will look once resolved, using the context you have. " +
        "CORRECT: 'Show execution history for activity CCCCCCC on vessel XXX1.' " +
        "WRONG: 'User asks about CCCCCCC but I need to determine if it refers to a previously resolved activity or a new one.'"
    ),
    reasoning: z.string().describe("Your internal technical thought process. If you pick FEED_BACK_TO_ME, explain exactly what gap you are trying to fill (e.g., 'Fetched Job IDs, now need to fetch their specific form contents' or 'Direct query failed, trying standard tool fallback')."),
    unclassifiedLabels: z.array(z.object({
        label: z.string().describe("The ambiguous label or code extracted from the query (e.g., 'XXX1', 'Grease up')."),
        likelyEntityTypes: z.array(
            z.object({
                type: z.string().describe("Entity type to try resolving against (e.g. 'Vessel', 'Activity', 'Machinery')"),
                confidence: z.number().min(0).max(1).describe("Your confidence this is the right type (0–1). The system resolves ALL types in parallel regardless of confidence, but will tell you which confidence level matched so you can weight the result.")
            })
        ).describe("Top entity type guesses (max 3) with confidence scores. e.g. [{type:'Activity', confidence:0.92}, {type:'Vessel', confidence:0.25}]. The system will resolve all types in parallel and report back which found results and which did not, including the original confidence score you assigned.")
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
        .default(false),
    useFallbackSearch: z.boolean()
        .describe(
            "Set to TRUE ONLY when no specialized MCP tool in the capability list matches what the user is asking for, " +
            "AND your tools[] array is empty as a result. " +
            "Example: user asks for a report type, regulatory document, or data category that has no dedicated MCP tool. " +
            "The graph will automatically route to the semantic fallback engine using your reformulatedQuery. " +
            "Do NOT set this if you have an applicable MCP tool but chose not to call it. " +
            "Do NOT set this because a prior MCP tool returned empty — the graph handles that case automatically. " +
            "Default false."
        )
        .default(false),
    parallelizeTools: z.boolean()
        .describe(
            "Execution mode declaration. Set to FALSE when your tools[] list contains mcp.clear_filters or any " +
            "other state-mutating tool, OR when tools have a strict natural-language ordering dependency " +
            "(e.g., 'first do X, then reset, then do Y'). When false, the execution engine runs your tools " +
            "sequentially in the EXACT ORDER they appear in tools[]. The order therefore matters: put the " +
            "pre-clear data query first, mcp.clear_filters in the middle, and the post-clear data query last. " +
            "Set to TRUE (default) when all tools are independent read operations with no shared state dependency."
        )
        .default(true),
    isDomainPivot: z.boolean()
        .describe(
            "⚠️ TOPIC CHANGE DETECTOR. Look at the RECENT OBSERVATIONAL MEMORY (QnA history) and compare the previous Q&A pair " +
            "to the current user question. Ask yourself: 'Is the new question a natural continuation or follow-up of what we were just discussing? " +
            "Or is the user now asking about something completely unrelated to the previous exchange?' " +
            "SET TRUE if the new question is NOT a continuation of the previous topic — i.e., the user has moved on to a different subject entirely. " +
            "SET FALSE if the new question is a continuation, follow-up, or scope change within the same subject (e.g., same topic but different vessel, date range, or wider scope). " +
            "HUMAN ANALOGY: Imagine reading a chat transcript. If a friend asks about restaurant recommendations and then suddenly asks 'by the way, how do I fix my bike?', " +
            "that is a topic change (TRUE). If they follow up with 'what about Italian restaurants?' that is not a topic change (FALSE). " +
            "CONCRETE TRUE EXAMPLE (the most common case): " +
            "Previous Q: 'show me completed maintenance activities for XXX1 and MV Phoenix Demo' / Previous A: showed maintenance records. " +
            "New Q: 'show me competency training completions for Tanker Management on XXX1'. " +
            "→ isDomainPivot = TRUE. These are unrelated topics (maintenance history vs crew competency training). " +
            "CONCRETE FALSE EXAMPLE: " +
            "Previous Q/A: competency training completions for Tanker Management on XXX1 (0 results). " +
            "New Q: 'okay show me org wide' or 'show me for all vessels'. " +
            "→ isDomainPivot = FALSE. Same topic, just wider scope. " +
            "EFFECT: When TRUE, stale attribute filters (statusCode, startDate, endDate etc.) from the previous topic are cleared " +
            "so they do not contaminate the new topic's investigation."
        )
        .default(false),
    ambiguitiesResolved: z.array(z.string())
        .describe(
            "🎯 TICKET ACTIVATION SIGNAL — List the labels (exactly as they appear in the OPEN AMBIGUITY TICKETS block) " +
            "for which you used a specific candidate's ID in a retrieval tool call THIS TURN.\n\n" +
            "SET a label here ONLY when ALL THREE conditions are true:\n" +
            "  1. That label appears in the OPEN AMBIGUITY TICKETS block.\n" +
            "  2. You had enough context to pick ONE specific candidate (ordinal from user, name match, context clue).\n" +
            "  3. You are calling a retrieval tool THIS TURN using that specific candidate's ID.\n\n" +
            "IMPORTANT CHANGE: Setting a label here does NOT delete the ticket. " +
            "The ticket stays as a reusable lookup table. Setting this signal only promotes the chosen " +
            "candidate's ID to resolvedLabels so the Vestibule can skip re-resolution.\n\n" +
            "Default: [] (empty — most turns do not activate a ticket)."
        )
        .default([]),
    // 🟢 Ticket activation companion fields — used by Summarizer to render attribution in insights
    activatedTicketLabel: z.string().nullable()
        .describe(
            "The label of the ambiguity ticket activated this turn (e.g. 'CCCCCCC'). " +
            "Set this whenever you pick a specific candidate from a ticket and call a retrieval tool with that candidate's ID. " +
            "Set to null if no ticket was activated this turn."
        )
        .default(null),
    activatedTicketConfidence: z.number().min(0).max(1)
        .describe(
            "Your confidence (0–1) that the user's current message matches the activated ticket's originQuery. " +
            "If you considered 2 tickets and their scores are within 0.25 of each other, " +
            "do NOT activate either — ask a meta-clarification showing both originQueries instead. " +
            "Set to 0 if no ticket was activated."
        )
        .default(0),
    activatedCandidateIndex: z.number().int().nullable()
        .describe(
            "Zero-based index into the activated ticket's candidates[] array for the candidate chosen this turn. " +
            "E.g. 'the second one' → 1, 'the first' → 0. " +
            "Used by Summarizer to display ordinal attribution (e.g. 'the 2nd match'). " +
            "Null if no ticket was activated or if the candidate index cannot be determined."
        )
        .default(null)
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

    // 🟢 TOPIC ANCHORING: Find the \"Mission Starting Question\" flawlessly.
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




    const history = Array.isArray(state.toolResults) ? state.toolResults : (state.toolResults ? [state.toolResults] : []);
    
    // REQUEST CYCLE: Only the turns from THIS specific HTTP request (for journal + loop breaker).
    const requestCycleTurns = history.slice(state.startTurnIndex || 0);
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

    // 🟢 ISSUE 2 FIX: Journal now shows ONLY tool actions — Q/A display stripped.
    // Rationale: The Q/A display was misleading. Prior-request questions showed "Awaiting Execution"
    // because their answers live in summaryBuffer (cross-request), not in the per-request message slice.
    // The actual conversation history is already in RECENT OBSERVATIONAL MEMORY (summaryBuffer) and
    // CONVERSATION HISTORY (activeMessages). The journal's sole job is intra-request tool dedup:
    // "don't call the same tool+params twice within this agentic loop."
    //
    // New format: just list the tools run in this request cycle. No Q/A noise.
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

    if (currentEntry && currentEntry.tools.length > 0) {
        journalEntries.push(`🚀 Tools run this request: ${currentEntry.tools.join(' | ')}`);
    }

    const decisionJournal = journalEntries.length > 0
        ? `\n\n### 📓 SESSION DECISION JOURNAL (Current Request Only):\n${journalEntries.join('\n')}\n\n**MANDATE**: Do NOT repeat the exact same Tool+Parameter combination already listed above in this same request cycle. For new or follow-up data needs, proactively call the relevant tool.`
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

    // 🟢 AMBIGUOUS SESSION LABELS: Labels that returned MULTIPLE matches across entity types.
    // These are genuinely ambiguous — re-running resolution won't produce a single canonical ID.
    // The AMBIGUITY DETECTED prompt block handles the user-facing clarification request.
    // This set provides the code-level guardrail to prevent the Strategic Intercept from
    // re-firing on a label that already proved ambiguous this request cycle.
    const ambiguousSessionLabels = new Set<string>(
        Array.from(resolveHits.entries())
            .filter(([, total]) => total > 1)
            .map(([lbl]) => lbl)
    );


    // 🟢 GAP-8 FIX: Explicitly mandate a clarifying question when all resolution guesses fail
    const deadEndStr = failedSessionLabels.size > 0 
        ? `\n\n🛡️ DEAD-END LABELS (Verified NOT FOUND This Turn):\n${Array.from(failedSessionLabels).map(l => `- "${l}": Checked multiple entity types. No matches found. Do NOT retry resolution for this label.`).join('\n')}\n⚠️ MANDATORY ACTION — SURFACE AND STOP:\n1. Tell the user plainly what you found (if anything) and what could not be found.\n2. Set \`clarifyingQuestion\` to ask the user to clarify the missing item (e.g., "I couldn't find 'XXX1' — could you check the spelling, or tell me what type of record it is?").\n3. Set \`tools\` to [] and \`feedBackVerdict\` to SUMMARIZE.\n⛔ STRICTLY FORBIDDEN: Do NOT call additional tools to try to solve around the missing entity (e.g. enumerating all schedules to guess which one the user meant, calling a broader org-wide query as a substitute). The user must make the next decision — do not make it for them.`
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
    // Lists every label that matched more than one distinct entity, along with all candidate
    // matches across all entity types. The LLM already knows from the user's query what entity
    // type was intended — this block gives it the full picture so it can formulate a specific
    // clarifying question instead of looping indefinitely.
    //
    // 🛡️ FIX-D (CORRECTED): Suppress the ambiguity block ONLY if:
    //   (a) isHITLContinuation=true — the user is RIGHT NOW answering our clarifying question.
    //       The block would be noise here; the LLM must read the user's reply.
    //
    // ❌ REMOVED: The old condition that suppressed when a label appeared in ambiguousSessionLabels
    //   (i.e., after any resolve_entities attempt). That was WRONG — it suppressed on the very
    //   first loop-back BEFORE the user was ever asked. The Vestibule guard (line ~1110) already
    //   prevents re-resolution; this block must still fire to tell the LLM to ask the user.
    // 🟢 NOTE (Gap 4 — by design): ambiguousMatchesData is populated from scope.ambiguousMatches,
    // which is written by update_memory2 AFTER mcp.resolve_entities runs and returns >1 hits.
    // On iter=0 (the very turn the Vestibule intercepts), update_memory2 hasn't run yet —
    // so ambiguousMatches doesn't exist in scope and this array is always [] on that turn.
    // This is correct: the STALL GUARD ensures the loop-back happens, and the ambiguity
    // block appears correctly from iter=1 onward once update_memory2 has written the matches.
    // The [RIGHT NOW] Ambiguity block (line ~758) reads the same source and has the same iter=0
    // blind spot by design — the LLM is correctly in the dark until after update_memory2 fires.
    // 🟢 TICKET MODEL: ambiguousMatches is now a persistent lookup table, not a one-shot gate.
    // Each entry carries originQuery (which question caused this) and conversationIndex (lifecycle).
    // The LLM matches the user's current message to the nearest ticket semantically and activates
    // only the relevant one — rather than unconditionally mandating clarification every turn.
    const ambiguousMatchesData = (session?.scope?.ambiguousMatches || []) as any[];
    const shouldSuppressAmbiguity = !!(state as any).isHITLContinuation;

    console.log(`\x1b[35m[Orchestrator] 🔬 AMBIGUITY GATE: matches=${ambiguousMatchesData.length} | isHITL=${!!(state as any).isHITLContinuation} | suppress=${shouldSuppressAmbiguity} | deadEnds=${failedSessionLabels.size} | ambiguousLabels=[${ambiguousMatchesData.map((m:any)=>m.label).join(',')}]\x1b[0m`);

    // 🟢 TICKET RENDERER: Build the OPEN AMBIGUITY TICKETS block.
    // Shows each ticket with originQuery context so the LLM can self-match.
    // Replaces the old monolithic "INSTANCE SELECTION REQUIRED / AMBIGUITY DETECTED" block
    // which unconditionally mandated re-asking every turn regardless of the user's topic.
    // 🟢 TICKET PERSISTENCE: Resolved tickets now stay alive so user can say "the third one".
    // Each ticket is badged as [✅ RESOLVED] or [⏳ PENDING] to guide LLM response mode.
    const resolvedLabelsForTickets = (session?.scope as any)?.resolvedLabels || {};
    // 🟢 HOISTED — used both in prompt building and AMBIGUITY INTERCEPTION GATE (post-LLM)
    const pendingAmbiguousMatches = ambiguousMatchesData.filter(
        (m: any) => !resolvedLabelsForTickets[m.label]
    );
    const ambiguityStr = shouldSuppressAmbiguity
        ? ""
        : ambiguousMatchesData.length > 0
            ? `\n### 📌 OPEN AMBIGUITY TICKETS (Persistent lookup — tickets survive until long-term compression)\n` +
              ambiguousMatchesData.map((m: any, ticketIdx: number) => {
                const distinctTypes = new Set((m.candidates || []).map((c: any) => c.type as string));
                const isInstanceAmbiguity = distinctTypes.size === 1;
                const confirmedType = isInstanceAmbiguity ? [...distinctTypes][0] : null;
                const isResolved = !!resolvedLabelsForTickets[m.label];
                const resolvedEntry = resolvedLabelsForTickets[m.label];
                const badge = isResolved
                    ? `[✅ RESOLVED — currently using ID: ${resolvedEntry?.id?.substring(0,8)}…, pick freely for follow-up ordinals]`
                    : `[⏳ PENDING — user selection required]`;
                const candidateList = (m.candidates || []).map((c: any, idx: number) => {
                    const ordinal = ['1st','2nd','3rd','4th','5th'][idx] || `${idx+1}th`;
                    const isCurrentlyActive = resolvedEntry?.id === c.id ? ' ← currently active' : '';
                    return `    ${idx+1}. ${c.label || c.type} — ID: ${c.id} (the ${ordinal} match)${isCurrentlyActive}`;
                }).join('\n');
                const originSnippet = (m.originQuery || 'unknown').substring(0, 100);
                return `TICKET [${ticketIdx+1}] ${badge} — From: "${originSnippet}${m.originQuery?.length > 100 ? '...' : ''}"\n  → Label "${m.label}" matched ${m.candidates.length} ${confirmedType || 'mixed-type'} record(s):\n${candidateList}`;
              }).join('\n\n') +
              `\n\n🎯 TICKET ACTIVATION RULES — Read the user's CURRENT message first, then apply:\n` +
              `  RULE 1 (ACTIVATE — direct pick): Current message contains the label text, a candidate name, or an ordinal ("the second one", "1st") that maps to a specific ticket → Activate that ticket, call the retrieval tool with that candidate's ID. Set ambiguitiesResolved, activatedTicketLabel, activatedTicketConfidence (high, ~0.9), activatedCandidateIndex.\n` +
              `  RULE 2 (ACTIVATE — topic match): Current message is topically close to a ticket's originating question (same domain — maintenance, crew, schedules, machinery) → Match the nearest ticket. Set activatedTicketConfidence to your confidence (0–1). If two tickets score within 0.25 of each other, do NOT activate either — ask a meta-clarification instead (see RULE 4).\n` +
              `  RULE 3 (SOFT NOTE — unrelated topic): Current message is about a completely different topic (org context, filters, dates, crew when the ticket is maintenance, etc.) → Answer the user's question. Append a brief soft note: "Note: I still have [N] open selection(s) pending when you're ready." Do NOT set any ticket activation fields.\n` +
              `  RULE 4 (META-CLARIFICATION — too close to call): You see 2+ PENDING tickets with similar relevance scores (gap < 0.25) → Show both originQueries and ask which one the user meant. E.g.: "Your message could relate to either: 1) [originQuery A] or 2) [originQuery B]. Which one?".\n` +
              `  RULE 5 (REUSE — ordinal follow-up on RESOLVED ticket): The ticket is [✅ RESOLVED] and the user refers to a different ordinal ("now the third one", "what about the first?") → Pick the new candidate index directly from the ticket's list WITHOUT re-asking. Set activatedCandidateIndex to the new index. Do NOT ask the user to clarify again — the ticket is your lookup table.`
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

    // 🟢 FATAL DISCOVERY ERROR INTERCEPT
    // Insert catastrophic errors directly into the Orchestrator prompt instead of aborting the node,
    // so the LLM itself generates the clarifyingQuestion and sets the SUMMARIZE terminator natively.
    let fatalErrorInstruction = "";
    // Fix C: Track when a bad org was just wiped so the ORG CONTEXT GATE can enforce a hard
    // re-ask regardless of what the LLM decides to put in its clarifyingQuestion.
    let orgJustInvalidated = false;
    if ((state.iterationCount || 0) > 0 && requestCycleTurns.length > 0) {
        const lastTurnResults = requestCycleTurns[requestCycleTurns.length - 1];
        if (lastTurnResults) {
            for (const [key, res] of Object.entries(lastTurnResults)) {
                let data: any = res;
                if (data?.content?.[0]?.text) {
                    try { data = JSON.parse(data.content[0].text); } catch { /* ignore */ }
                    if (data?.content) data = res; // Fallback if parsing didn't produce the object
                }
                const rawText = data?.content?.[0]?.text || data?.error || data?.message || "";
                if (data?.isError && (rawText.includes("Organization not found") || rawText.includes("Vessel not found"))) {
                    console.log(`\x1b[31m[LangGraph Orchestrator] 🚨 FATAL DISCOVERY DETECTED. Injecting intercept into LLM prompt.\x1b[0m`);
                    fatalErrorInstruction = `\n🛑 SYSTEM EXCEPTION (Previous Turn): The previous tool call failed with the following fatal error: "${rawText}".\n` +
                        `⚠️ MANDATORY ACTION: You MUST set \`clarifyingQuestion\` to ask the user for the correct organization or vessel name, set \`tools\` to [], and set \`feedBackVerdict\` to SUMMARIZE.\n`;
                    
                    // We must clear the bad org/vessel from the session state so it isn't treated as confirmed
                    if (session?.scope) {
                        delete session.scope.organizationID;
                        delete session.scope.organizationShortName;
                    }
                    if (state.workingMemory?.queryContext?.activeFilters) {
                        delete state.workingMemory.queryContext.activeFilters.organization;
                    }
                    // Fix C: Signal the gate to enforce re-ask — hasOrgContext was already computed
                    // from the now-deleted values so shouldShowOrgWarning won't re-fire on its own.
                    orgJustInvalidated = true;
                    break;
                }
            }
        }
    }

    // ─── ORG CONTEXT GUARD ────────────────────────────────────────────────────
    // Checks ALL memory tiers for org context, not just the narrow scope pointer.
    //
    // Tier 1: scope.organizationID / organizationShortName
    //   Set by update_memory2 after the first org-resolution tool run. Always
    //   checked first — most authoritative for the current query.
    //
    // Tier 2: secondaryScope[] entries with modelType === 'Organization'
    //   Written by the summarizer after each conversation. Survives across queries.
    //   If the user has EVER chatted with an org confirmed, it lives here.
    //   The org ID is already rendered in the 🗃️ SECONDARY SCOPE block in the prompt,
    //   so the LLM can read it — no need to re-ask.
    //
    // This two-tier check prevents a false ORG MISSING warning when the org is in
    // secondaryScope but hasn't yet been re-promoted to scope on the current query.
    const orgInSecondaryScope = (session?.secondaryScope || []).some(
        (e: any) => e.modelType === 'Organization' && !!e.id
    );
    if (orgInSecondaryScope) {
        console.log(`\x1b[33m[Orchestrator] 🏢 OrgGuard: Org found in secondaryScope — suppressing ORG MISSING warning.\x1b[0m`);
    }
    const hasOrgContext = !!(
        session?.scope?.organizationID ||
        session?.scope?.organizationShortName ||
        orgInSecondaryScope
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
                // If the preceding AI message looks like a short clarifying question or explicitly requests verification,
                // treat this human reply as a potential org answer and suppress the missing warning.
                if ((prevContent.includes('?') || prevContent.toLowerCase().includes('what is') || prevContent.toLowerCase().includes('verify it')) && prevContent.length < 400) {
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
    // This ensures the LLM performs a fresh fleet-wide discovery rather than staying scoped
    // to a previously targeted vessel.
    const broadScopeStr = query?.isBroadScope
        ? `\n🌐 BROAD SCOPE MODE ACTIVE — User explicitly requested org/fleet-wide data in this conversation.\n` +
          `⚠️ MANDATORY: Prior vessel-specific focus (e.g., single-vessel context from a prior conversation) is INSUFFICIENT for this request. ` +
          `You MUST fetch fresh data at the organization or fleet level to provide a complete report. ` +
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

    // 🟢 TOPIC PIVOT SCOPE GUARD: On iter=0, if the active anchored query has pivoted away
    // from the stored rawQuery, the currentScope in state belongs to the PREVIOUS investigation.
    // Showing it in the prompt pollutes the new query — the LLM will see a verified vessel ID
    // (e.g., XXX1) and per Rule VIII.2, will be MANDATED to use it directly, skipping fleet
    // discovery for the new broad/org-wide pivot (e.g., "vessel wise" for 2026 completed jobs).
    // Fix: Display an EMPTY scope in the Current Query Context block when a topic pivot is detected,
    // even if the underlying state still holds the old IDs (they're preserved in secondaryScope).
    const currentIterForPivot = state.iterationCount || 0;
    const isTopicPivotAtIter0 = currentIterForPivot === 0 && !!query?.rawQuery && anchoredRawQuery !== query?.rawQuery;
    const displayCurrentScope = isTopicPivotAtIter0 ? [] : (query?.currentScope || []);
    if (isTopicPivotAtIter0 && (query?.currentScope || []).length > 0) {
        console.log(`\x1b[35m[Orchestrator] 🧹 TOPIC PIVOT SCOPE GUARD: Suppressed stale currentScope [${(query?.currentScope || []).join(', ')}] from prompt. Starting fresh for new query.\x1b[0m`);
    }

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // e.g. "2026-04-19"
    const currentYear = today.getFullYear();           // e.g. 2026
    const priorYear = currentYear - 1;                 // e.g. 2025

    const memoryContext = [
        `\n### 🗂️ SESSION CONTEXT (Persists This Conversation)\n📅 TODAY: ${todayStr} | Current Year: ${currentYear} | Prior Year: ${priorYear}\nWhen the user says "this year" use ${currentYear}. When they say "past year" or "prior year" use ${priorYear}.`,
        fatalErrorInstruction,
        systemInterceptStr,
        broadScopeStr,
        orgContextBlock,
        longTermStr,
        summaryStr,
        secondaryStr,
        labelStr,
        ambiguityStr,   // 🟢 AMBIGUITY DETECTED block — must follow labelStr so LLM sees resolved vs ambiguous in sequence
        query?.rawQuery || anchoredRawQuery
            ? `\n### 🔎 CURRENT QUERY CONTEXT\nQuery: "${query?.rawQuery || anchoredRawQuery}"\nPending: ${JSON.stringify(query?.pendingIntents || [])}\nActive Filters: ${JSON.stringify(query?.activeFilters || {})}\nLast Turn: "${query?.lastTurnInsight || ""}"\ncurrentScope (Organic Discoveries): [${displayCurrentScope.join(', ')}]` 
            : "",
        // 🟢 CONVERSATION JOURNAL: Inject the code-maintained turn-by-turn log as a dedicated block.
        // The LLM reads ONLY this to produce reformulatedQuery — isolated from summaryBuffer, rawQuery,
        // and all other context. This is the single source of truth for what happened in THIS conversation.
        (query as any)?.conversationJournal?.length > 0
            ? `\n### 📋 CONVERSATION JOURNAL (This Conversation Only — read this to build reformulatedQuery)\n${((query as any).conversationJournal as string[]).join('\n')}`
            : "",
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

    const sessionCtx = state.workingMemory?.sessionContext || {};
    const summaryBuffer: any[] = sessionCtx.summaryBuffer || [];
    // 🟢 MASKING FIX: Trigger clean QnA transcript for ALL turns with existing history,
    // not just iter>0 turns. On a new HITL turn (iter=0), the old logic would dump ALL raw
    // messages into the prompt, flooding the LLM with prior cancelled/2025 context even when
    // the user had pivoted to a completely new query (e.g., "completed 2026").
    // Now: masking fires whenever there is prior conversation history (summaryBuffer.length > 0)
    // OR we are in an intermediate iteration. This guarantees the LLM always receives a clean,
    // intent-first view of the conversation regardless of which iteration phase it is in.
    const hasHistory = summaryBuffer.length > 0 || iterationCount > 0;

    if (hasHistory) {
        // Build the clean QnA transcript from the summarized history + the current active query.
        let qnaTranscript = "";
        
        if (summaryBuffer.length > 0) {
            qnaTranscript = summaryBuffer.map((s: any) => `HUMAN: ${s.q}\n\nASSISTANT: ${s.a}`).join('\n\n');
            qnaTranscript += "\n\n";
        }
        
        // 🟢 For iter=0 of a new HITL turn: the latest user message is NOT yet in the summaryBuffer
        // (it will be distilled after this turn). We must inject it directly from the raw messages
        // so the LLM knows what the user JUST asked.
        const latestHumanMsg = [...(state.messages || [])].reverse().find((m: any) => 
            (m._getType?.() || m.role) === 'human'
        ) as any;
        const latestHumanContent = latestHumanMsg?.content || "";

        // For iter>0, the reformulatedQuery is the clean representation. For iter=0, we may not
        // have it yet, so fall back to the raw latest human message.
        const currentQuery = (iterationCount > 0)
            ? (state.reformulatedQuery || state.workingMemory?.queryContext?.rawQuery || latestHumanContent)
            : latestHumanContent;

        // 🟢 HITL CONTEXT BRIDGE: If this is the start of a HITL continuation turn, the summaryBuffer
        // does not yet contain the 'reformulatedQuery' of the current session. We inject it here
        // so the LLM can map the user's terse reply to the correct tools and IDs.
        // This block is intentionally NOT in summaryBuffer yet — it will be squashed there on SUMMARIZE.
        const isHITLIter0 = !!(state as any).isHITLContinuation && iterationCount === 0;
        const priorReformulated = state.reformulatedQuery || state.workingMemory?.queryContext?.rawQuery || "";
        // 🛡️ FIX-A: [ACTIVE CLARIFICATION CONTEXT] — COMMENTED OUT.
        // ⛔ This block injected the (often corrupted) reformulatedQuery as framing for HITL turns,
        //    causing the LLM to re-ask disambiguation questions even after the user had answered.
        // ✅ REPLACED BY: The conversationJournal block (see ### 📋 CONVERSATION JOURNAL in memoryContext).
        //    The journal contains the AI's clarifying question (T_n [AI Clarification]) and the user's
        //    reply (T_n [User Reply]) as factual code-written entries — no LLM reasoning contamination.
        // if (isHITLIter0 && priorReformulated && currentQuery !== priorReformulated) {
        //     qnaTranscript += `[ACTIVE CLARIFICATION CONTEXT — you asked the user a clarifying question; their answer follows]\n${priorReformulated}\n\n[USER'S ANSWER]\n`;
        // }

        // 🛡️ FIX-C: Inject a compact [RIGHT NOW] status block immediately before the user's current
        // message. The user message is the highest-salience position in context (closest to generation).
        // Moving the active state summary here prevents the system-message MANDATORY ACTION from
        // being overridden by the conversational flow in the user message.
        const pendingStr = (query?.pendingIntents || []).join(' | ') || 'none';
        const filterStr = Object.entries(query?.activeFilters || {})
            .map(([k, v]) => `${k}=${v}`).join(', ') || 'none';
        // 🛡️ FIX-C: [RIGHT NOW] Ambiguity MUST read directly from live ambiguousMatchesData,
        // NOT from shouldSuppressAmbiguity. The suppression gate is for the system-message block.
        // [RIGHT NOW] is the highest-salience signal in the prompt and must always be ground truth.
        // Only exception: isHITLContinuation=true (user is answering, showing ambiguity is noise).
        //
        // 🟢 TICKET PERSISTENCE FIX: Only show PENDING (unresolved) tickets in [RIGHT NOW].
        // Resolved tickets still stay in ambiguousMatches (for "the third one" follow-up picks)
        // but must NOT appear here. Rule 41 Step 1 mandates the LLM stops ALL retrieval and
        // re-asks a clarifying question whenever Ambiguity is non-None. Showing a resolved
        // ticket here causes an infinite re-ask loop. Resolved = label exists in resolvedLabels.
        // pendingAmbiguousMatches is hoisted to function scope — reuse it here.
        // (resolvedLabelsForTickets === resolvedLabelsForRightNow — same source object)
        const ambiguityStatusStr = (pendingAmbiguousMatches.length > 0 && !(state as any).isHITLContinuation)
            ? pendingAmbiguousMatches.map((m: any) => {
                const distinctTypes = new Set((m.candidates || []).map((c: any) => c.type as string));
                const isInstance = distinctTypes.size === 1;
                return isInstance
                    ? `"${m.label}" — INSTANCE SELECTION REQUIRED: ${m.candidates.length} ${[...distinctTypes][0]} records (${m.candidates.map((c:any)=>c.label).join(', ')})`
                    : `"${m.label}" — TYPE DISAMBIGUATION REQUIRED: matched ${[...distinctTypes].join(', ')}`;
              }).join('; ')
            : 'None';
        console.log(`\x1b[35m[Orchestrator] 🎯 [RIGHT NOW] Ambiguity=${ambiguityStatusStr} | pendingTickets=${pendingAmbiguousMatches.length} | totalTickets=${ambiguousMatchesData.length} | isHITL=${!!(state as any).isHITLContinuation}\x1b[0m`);
        const rightNowBlock = `[RIGHT NOW]
Goal: ${(state.reformulatedQuery || query?.rawQuery || '').substring(0, 150)}
Pending: ${pendingStr}
Filters: ${filterStr}
Ambiguity: ${ambiguityStatusStr}
`;

        if (currentQuery) {
            qnaTranscript += `${rightNowBlock}\nHUMAN: ${currentQuery}`;
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
        // True Turn 0: No prior history exists. The Orchestrator must read raw messages
        // directly to understand the user's first-ever request in this session.
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
        queryContext: {
            ...state.workingMemory?.queryContext,
            // 🟢 JOURNAL DEBUG: Show full conversationJournal entries inline
            conversationJournal: (state.workingMemory?.queryContext as any)?.conversationJournal || [],
        },
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
    // 🟢 Default: respect the LLM's declared execution mode.
    // The Strategic Intercept below may override this to true if it replaces the tool plan
    // with pure-parallel mcp.resolve_entities calls (which have no state-mutation ordering needs).
    let finalParallelizeTools = response.parallelizeTools !== false;

    // 🟢 LOOP BREAKER: If the Anti-Placeholder Guard stripped ALL requested tools,
    // we MUST override FEED_BACK_TO_ME to SUMMARIZE. Otherwise, the graph executes 0 tools,
    // loops back to UpdateMemory2 with no new data, and repeats infinitely!
    if (finalToolCalls.length === 0 && (response.tools || []).length > 0 && finalVerdict === 'FEED_BACK_TO_ME') {
        console.warn(`[LangGraph Orchestrator] 🛑 Loop Breaker: Anti-Placeholder Guard stripped all tools. Forcing SUMMARIZE to escape infinite loop.`);
        finalVerdict = 'SUMMARIZE';
        finalReasoning = `[ANTI-PLACEHOLDER GUARD] All requested tools were stripped because they contained invalid placeholder parameters. Forcing SUMMARIZE. Original Reasoning: ` + finalReasoning;
    }

    // 🟢 FALLBACK SEARCH INTERCEPT: Deterministic routing to direct_query_fallback.
    // When the AI signals useFallbackSearch=true (no MCP tool coverage), the graph injects
    // direct_query_fallback automatically — similar to how isBroadScopeRequest works.
    // This is ONLY triggered when: (1) AI set the flag, (2) tools[] is still empty after
    // all guards, (3) a reformulatedQuery exists to forward. No clarifying question active.
    if (
        response.useFallbackSearch === true &&
        finalToolCalls.length === 0 &&
        response.reformulatedQuery &&
        !response.clarifyingQuestion
    ) {
        const fallbackQuery = `${response.reformulatedQuery} Limit 25`;
        console.warn(`\x1b[33m[LangGraph Orchestrator] 🔄 FALLBACK SEARCH INTERCEPT: AI flagged no tool coverage. Injecting direct_query_fallback with query: "${fallbackQuery.substring(0, 80)}"\x1b[0m`);
        finalToolCalls = [{
            name: 'direct_query_fallback',
            uiTabLabel: 'Semantic Search',
            confidence: 0.75,
            args: [{ key: 'userQuery', value: fallbackQuery }]
        }];
        finalVerdict = 'SUMMARIZE'; // Fallback result goes directly to Summarizer — no extra LLM turn
        finalReasoning = `[FALLBACK SEARCH INTERCEPT] No specialized MCP tool matched this query. Routing to direct_query_fallback. Original: ${finalReasoning}`;
    }

    // ─────────────────────────────────────────────────────────────────
    // FIX — DISCOVERY STALL GUARD
    // ─────────────────────────────────────────────────────────────────
    // A "discovery turn" runs fleet.query_overview or mcp.resolve_entities to get entity IDs.
    // Its ONLY purpose is to feed those IDs into the NEXT retrieval tool call.
    // If the LLM decides to SUMMARIZE after a discovery turn without calling any retrieval tool,
    // the discovery was completely pointless — the user gets entity IDs instead of the
    // actual data they asked for.
    //
    // Guard fires whenever UpdateMemory2 still reports unfulfilled pendingIntents AND no
    // retrieval tool has run yet in this request cycle. It stands down naturally when:
    //   - pendingIntents is emptied (UpdateMemory2 confirms work is done)
    //   - hasRetrievalInCurrentRequest becomes true (retrieval actually ran)
    //   - The graph's hard maxIter ceiling is hit (catastrophic failure path)
    // The iter number is NOT a termination condition — that was an over-conservative safety
    // net that broke under stale observational memory from prior sessions.
    // ─────────────────────────────────────────────────────────────────
    const currentIter = state.iterationCount || 0;
    const rawToolResults = Array.isArray(state.toolResults) ? state.toolResults : [];
    const prevTurnKeys = Object.keys(rawToolResults[rawToolResults.length - 1] || {});
    const prevTurnWasDiscovery = prevTurnKeys.some(k =>
        k.includes('fleet.query_overview') ||
        k.includes('resolve_entities')
    );

    // 🟢 AMBIGUITY BAIL-OUT: If the latest resolve_entities turn produced ambiguous matches
    // (multiple entity types matched the same label), there is no single canonical ID to
    // run retrieval with. Forcing the stall guard in this state creates an infinite loop.
    // Let the AMBIGUITY DETECTED block in the prompt + the HITL path handle it instead.
    const hasUnresolvedAmbiguity = (session?.scope?.ambiguousMatches?.length ?? 0) > 0;

    // 🟢 DEAD-END BAIL-OUT: If ANY label came back with 0 hits across all entity types this
    // request cycle, the LLM has correctly entered the dead-end clarification path. The STALL
    // GUARD must NOT override this — the LLM's SUMMARIZE+clarifyingQuestion is the right answer.
    // Without this, the guard fires infinitely (iter=4→8) overriding the correct response each time.
    const hasDeadEndLabels = failedSessionLabels.size > 0;

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
        'mcp.capabilities',
        'resolve_labels::',          // Synthetic results injected by the resolve_labels graph node
    ];
    const isDiscoveryKey = (k: string) => DISCOVERY_KEY_PATTERNS.some(p => k.includes(p));
    const requestCycleToolResults = rawToolResults.slice(state.startTurnIndex || 0);
    const hasRetrievalInCurrentRequest = requestCycleToolResults.some(turn =>
        Object.keys(turn || {}).some(k => !isDiscoveryKey(k))
    );

    const pendingIntentsAtThisTurn = (state.workingMemory as any)?.queryContext?.pendingIntents || [];
    console.log(`\x1b[35m[Orchestrator] \ud83c\udfc1 STALL GUARD pre-check: prevWasDiscovery=${prevTurnWasDiscovery} | hasRetrieval=${hasRetrievalInCurrentRequest} | hasAmbiguity=${hasUnresolvedAmbiguity} | hasDeadEnds=${hasDeadEndLabels} | pending=${pendingIntentsAtThisTurn.length}\x1b[0m`);

    if (
        prevTurnWasDiscovery &&           // Previous turn was a discovery tool
        !hasRetrievalInCurrentRequest &&  // No retrieval tool has run yet this request cycle
        finalToolCalls.length === 0 &&    // LLM wants to stop with no retrieval tool
        finalVerdict === 'SUMMARIZE' &&   // LLM wants to summarize discovery output directly
        pendingIntentsAtThisTurn.length > 0 && // UpdateMemory2 confirms work is genuinely unfinished
        !hasUnresolvedAmbiguity &&         // 🟢 Bail-out: ambiguous labels → no ID to retrieve with → yield to HITL
        !hasDeadEndLabels                  // 🟢 Bail-out: dead-end labels → clarifying question is correct → do not override
        // ↑ All conditions must be true. maxIter=8 is the graph's hard ceiling.
    ) {
        console.warn(
            `\x1b[41m\x1b[97m[Orchestrator] \ud83d\uded1 DISCOVERY STALL GUARD FIRED\x1b[0m\x1b[31m` +
            ` — Previous turn was discovery (${prevTurnKeys.join(', ')}) but current turn proposes` +
            ` no retrieval tools.` +
            ` hasRetrievalInCurrentRequest=${hasRetrievalInCurrentRequest} | iter=${currentIter}` +
            ` | pendingIntents=${pendingIntentsAtThisTurn.length}` +
            ` — Overriding verdict to FEED_BACK_TO_ME.\x1b[0m`
        );
        finalVerdict = 'FEED_BACK_TO_ME';
        finalReasoning = `[DISCOVERY STALL GUARD] Prior discovery turn (${prevTurnKeys.join(', ')}) completed ` +
            `successfully but was immediately followed by a SUMMARIZE with no retrieval tools. ` +
            `The vessel/entity IDs discovered MUST be used to call a specific retrieval tool ` +
            `(e.g., maintenance.query_status or maintenance.query_execution_history). ` +
            `${pendingIntentsAtThisTurn.length} pending intent(s) still unresolved. Looping back to execute the retrieval step.`;
    } else if (prevTurnWasDiscovery) {
        console.log(
            `\x1b[32m[Orchestrator] \u2705 DISCOVERY STALL CHECK: Guard not triggered.\x1b[0m` +
            ` iter=${currentIter} | prevWasDiscovery=${prevTurnWasDiscovery}` +
            ` | hasRetrieval=${hasRetrievalInCurrentRequest}` +
            ` | toolCalls=${finalToolCalls.length} | verdict=${finalVerdict}` +
            ` | pendingIntents=${pendingIntentsAtThisTurn.length}`
        );
    }

    // Both guards below share this single computation:
    const hasFallbackAlreadyRan = requestCycleToolResults.some(turn =>
        Object.keys(turn || {}).some(k => k.includes('direct_query_fallback'))
    );

    // 🚫 FALLBACK DEDUP GUARD: direct_query_fallback is a one-shot-per-cycle tool.
    //
    // The AI may decide to call direct_query_fallback again in a subsequent iteration after
    // it already ran and returned empty (e.g., user says "retry", AI calls it at iter=0,
    // then at iter=1 sees pending intents + empty result and calls it AGAIN).
    // This guard strips the redundant call before it executes.
    //
    // Fires when: hasFallbackAlreadyRan=true AND AI has included direct_query_fallback in this turn.
    if (hasFallbackAlreadyRan && finalToolCalls.some((t: any) => t.name === 'direct_query_fallback')) {
        console.warn(`\x1b[33m[LangGraph Orchestrator] \ud83d\udeab FALLBACK DEDUP GUARD: direct_query_fallback already ran this request cycle. Stripping redundant call.\x1b[0m`);
        finalToolCalls = finalToolCalls.filter((t: any) => t.name !== 'direct_query_fallback');
        if (finalToolCalls.length === 0) {
            finalVerdict = 'SUMMARIZE';
            finalReasoning = `[FALLBACK DEDUP GUARD] direct_query_fallback already completed this cycle. Forcing SUMMARIZE. Original: ${finalReasoning}`;
        }
    }

    // 🛡️ EMPTY RESULT FALLBACK GUARD: Deterministic code-level safety net.
    //
    // Pattern: The LLM has exhausted specialized MCP tools (all returned 0 items)
    // and is now proposing to SUMMARIZE an empty result set — without ever calling
    // direct_query_fallback. This guard detects that pattern and injects the fallback.
    //
    // Fires when ALL of these are true:
    //   1. LLM wants to SUMMARIZE with no tool calls (dead-end decision)
    //   2. At least one NON-DISCOVERY retrieval tool returned 0 items in this request cycle
    //   3. direct_query_fallback has NOT already run in this request cycle
    //   4. Not a clarifying question turn
    // 🛡️ GUARD REFINEMENT: Only check the LAST retrieval turn, not ANY turn in the cycle.
    // A multi-step query (e.g. clear_filters → query_A → query_B) may have early turns that
    // return 0 items while a LATER turn returns real data. If the LLM then correctly chooses
    // SUMMARIZE, we must NOT inject direct_query_fallback — the LLM is summarizing real results.
    // Only fire the guard when the most recent actual-retrieval turn is also empty.
    const isNonDiscoveryRetrievalKey = (k: string) =>
        !isDiscoveryKey(k) && !k.includes('direct_query_fallback') && !k.startsWith('mcp.');

    const lastRetrievalTurn = [...requestCycleToolResults].reverse().find(turn =>
        Object.keys(turn || {}).some(k => isNonDiscoveryRetrievalKey(k))
    );

    const hasEmptyRetrievalResult = lastRetrievalTurn
        ? Object.entries(lastRetrievalTurn).some(([k, res]) => {
            if (!isNonDiscoveryRetrievalKey(k)) return false;
            let data: any = res;
            if (data?.content?.[0]?.text) {
                try { data = JSON.parse(data.content[0].text); } catch {}
            }
            return Array.isArray(data?.items) ? data.items.length === 0 : false;
        })
        : false;

    if (
        finalToolCalls.length === 0 &&
        finalVerdict === 'SUMMARIZE' &&
        hasEmptyRetrievalResult &&
        !hasFallbackAlreadyRan &&
        !response.clarifyingQuestion
    ) {
        const fallbackQuery = `${response.reformulatedQuery || anchoredRawQuery} Limit 25`;
        console.warn(`\x1b[43m\x1b[30m[LangGraph Orchestrator] \ud83d\udee1\ufe0f EMPTY RESULT FALLBACK GUARD: All retrieval tools returned empty. Auto-injecting direct_query_fallback.\x1b[0m`);
        finalToolCalls = [{
            name: 'direct_query_fallback',
            uiTabLabel: 'Semantic Search',
            confidence: 0.75,
            args: [{ key: 'userQuery', value: fallbackQuery }]
        }];
        finalVerdict = 'SUMMARIZE';
        finalReasoning = `[EMPTY RESULT FALLBACK GUARD] Specialized MCP tool(s) returned 0 items in this request cycle and direct_query_fallback has not been attempted. Auto-routing to semantic fallback. Original: ${finalReasoning}`;
    }

    /* DISABLED: actualUnclassified full filter moved to resolve_labels (Option A).
     * The failedSessionLabels / ambiguousSessionLabels dead-end guard is kept for
     * the LLM prompt guidance section below but no longer gates resolve_labels.
    const actualUnclassified = (response.unclassifiedLabels || []).filter((l: any) => {
        const lbl = (l.label || '').trim();
        const lblLower = lbl.toLowerCase();
        if (!lbl) return false;
        if (lbl.length > 40) return false;
        if (QUANTIFIER_PREFIXES.test(lbl)) return false;
        if (STATUS_WORDS.test(lbl)) return false;
        if (resolvedLabelSet.has(lblLower)) return false;
        if (failedSessionLabels.has(lblLower)) return false;
        if (ambiguousSessionLabels.has(lblLower)) return false;
        return true;
    });
    */
    // Minimal live filter — resolve_labels applies its own deeper filter.
    // We still compute actualUnclassified so the dead-end prompt section below can reference it.
    // 🛡️ RESOLVED LABEL GUARD: Build a set of already-resolved labels (from resolvedLabels in scope)
    // so we don't pass them to resolve_labels and trigger a redundant re-resolution.
    // resolvedLabels is already computed above at line ~462.
    const resolvedLabelSet = new Set<string>(
        Object.keys(resolvedLabels).map((k: string) => k.toLowerCase())
    );

    const actualUnclassified = (response.unclassifiedLabels || []).filter((l: any) => {
        const lbl = (l.label || '').trim();
        const lblLower = lbl.toLowerCase();
        // Skip empty or sentence-length strings
        if (!lbl || lbl.length > 50) return false;
        // Skip labels already resolved in this conversation (avoid redundant re-resolution)
        if (resolvedLabelSet.has(lblLower)) {
            console.log(`\x1b[35m[Orchestrator] ♻️ Label "${lbl}" already in resolvedLabels — skipping resolve_labels.\x1b[0m`);
            return false;
        }
        return true;
    });

    // 🛡️ SAFETY STRIP: Block any hallucinated mcp.resolve_entities calls.
    // The tool was removed from the LLM's capability list (contract.ts). If the LLM
    // somehow emits it from training data memory, drop it here before execute_tools runs.
    finalToolCalls = finalToolCalls.filter((t: any) => {
        if (t.name === 'mcp.resolve_entities') {
            console.warn(`\x1b[33m[LangGraph Orchestrator] 🛡️ Safety Strip: LLM hallucinated mcp.resolve_entities — dropped. Resolution is handled by resolve_labels node.\x1b[0m`);
            return false;
        }
        return true;
    });

    /* DISABLED: Strategic Intercept replaced by resolve_labels LangGraph node.
     * Previously: this block replaced finalToolCalls with mcp.resolve_entities calls
     * and forced FEED_BACK_TO_ME to pause the retrieval plan.
     * Now: the orchestrator writes unclassifiedLabels to state as a proper channel.
     * The graph's conditional edge routes to resolve_labels when unclassifiedLabels.length > 0.
     * Resolution is deterministic, parallel, and always clears unclassifiedLabels.
     * The retrieval plan (finalToolCalls) is NOT paused — execute_tools runs AFTER
     * resolve_labels completes, with IDs already injected into scope.
     *
    let vestibuleNoOrgFired = false;
    const ATOMIC_DIAGNOSTIC_TOOLS = new Set(['mcp.clear_filters', 'mcp.query_active_filters']);
    const isAtomicDiagnosticPlanned = finalToolCalls.length > 0 && finalToolCalls.every((t: any) => ATOMIC_DIAGNOSTIC_TOOLS.has(t.name));
    const isInterceptBypassed = isAtomicDiagnosticPlanned;
    if (actualUnclassified.length > 0 && !isInterceptBypassed) {
        const resolutionTools: any[] = [];
        const scope = (state.workingMemory as any)?.sessionContext?.scope;
        let orgID = scope?.organizationID;
        let orgShortName = scope?.organizationShortName;
        const isValidOrgValue = (val: any): val is string => typeof val === 'string' && val.trim() !== '';
        if (!orgID && !orgShortName) {
            const secondaryScopeOrg = (session?.secondaryScope || []).find(
                (e: any) => e.modelType === 'Organization' && isValidOrgValue(e.id)
            );
            if (secondaryScopeOrg) {
                orgID = secondaryScopeOrg.id;
                console.log(`\x1b[33m[Orchestrator] 🏢 Deep Context Thievery: Found org in secondaryScope — ID: ${orgID}\x1b[0m`);
            }
        }
        if (!orgID && !orgShortName) {
            response.tools?.forEach((t: any) => {
                const args = t.args || [];
                const idArg = args.find((a: any) => a.key === 'organizationID')?.value;
                const nameArg = args.find((a: any) => a.key === 'organizationShortName')?.value;
                if (isValidOrgValue(idArg)) orgID = idArg;
                if (isValidOrgValue(nameArg)) orgShortName = nameArg;
            });
        }
        const orgKey = orgID ? "organizationID" : (orgShortName ? "organizationShortName" : null);
        const orgValue = orgID || orgShortName;
        if (orgKey && orgValue) {
            actualUnclassified.forEach((item: any) => {
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
            finalToolCalls = resolutionTools;
            finalVerdict = 'FEED_BACK_TO_ME';
            finalReasoning = `[DETERMINISTIC VESTIBULE] Intercepted turn to resolve unclassified labels: ${response.unclassifiedLabels.map((l: any) => l.label).join(', ')}.`;
            finalParallelizeTools = true;
        } else if (!orgKey && !orgValue) {
            //   Case A — Cold start, org never provided: shouldShowOrgWarning is already true,
            //     so the ORG CONTEXT GATE fires naturally on this same turn.
            //   Case B — HITL continuation with an unresolvable org (e.g. user typed a wrong/fake
            //     org name like "jjjj"): isHITLContinuation=true normally suppresses the gate,
            //     but the Vestibule has just confirmed the org is STILL unknown. We must bypass
            //     the suppression and re-ask. vestibuleNoOrgFired=true carries this signal down.
            vestibuleNoOrgFired = true;
            finalToolCalls = [];
            finalVerdict = 'SUMMARIZE';
            finalReasoning = `[VESTIBULE NO-ORG] Unclassified labels [${actualUnclassified.map((l: any) => l.label).join(', ')}] found but org unknown across all memory tiers. Forcing SUMMARIZE so ORG CONTEXT GATE asks for org name this turn.`;
            console.warn(
                `\x1b[43m\x1b[30m[Orchestrator] 🛑 VESTIBULE NO-ORG\x1b[0m\x1b[33m` +
                ` — Cannot build resolution tools: org ID unknown. Labels: [${actualUnclassified.map((l: any) => l.label).join(', ')}].` +
                (state.isHITLContinuation ? ' [HITL-INVALID-ORG: bypassing HITL suppression]' : '') +
                ` Deferring to ORG CONTEXT GATE.\x1b[0m`
            );
        }
    }
    */

    // 🔎 RESOLVE_LABELS HANDOFF: unclassifiedLabels written to state updates below.
    // vestibuleNoOrgFired stays false — Strategic Intercept no longer fires.
    const vestibuleNoOrgFired = false;
    if (actualUnclassified.length > 0) {
        console.log(`\x1b[36m[LangGraph Orchestrator] 🔎 ${actualUnclassified.length} unclassified label(s) → resolve_labels node will fire: [${actualUnclassified.map((l: any) => l.label).join(', ')}]\x1b[0m`);
    }

    const updates: Partial<SkylarkState> = {
        workingMemory: state.workingMemory,
        toolCalls: finalToolCalls,
        feedBackVerdict: finalVerdict,
        reasoning: finalReasoning,
        // 🔎 RESOLVE_LABELS HANDOFF: Write unclassifiedLabels to state as a first-class channel.
        // The graph conditional edge reads this to route to resolve_labels when labels are present.
        // resolve_labels always clears this to [] after running, regardless of resolution outcome.
        unclassifiedLabels: actualUnclassified as any,
        // 🟢 Persist the LLM's reformulated query so the Summarizer can use it
        // as the clean 'q:' field in the summaryBuffer instead of the raw, fragmented rawQuery.
        // Only update when the LLM provides a non-empty value; otherwise keep prior value.
        ...(response.reformulatedQuery ? { reformulatedQuery: response.reformulatedQuery } : {}),
        iterationCount: nextIterationCount,
        // 🟢 PARALLEL EXECUTION MODE: Wire the resolved execution mode into state.
        // finalParallelizeTools defaults to the LLM's declared value.
        parallelizeTools: finalParallelizeTools,
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
    };


    // 🟢 SECONDARY SCOPE ACCUMULATION: Reliably store any 'currentScope' ID output by the LLM
    // across all iterations, so it's not lost if the final SUMMARIZE turn outputs []
    const incomingIds: string[] = (response.currentScope || []).filter((id: any) => typeof id === 'string' && id.length > 0);
    // 🟢 TOPIC PIVOT ACCUMULATION GUARD: On iter=0 when a topic pivot has occurred, do NOT
    // merge the prior query's accumulated IDs into the new query's scope. The old IDs belong
    // to a different investigation and should not contaminate the new query's currentScope state.
    // Without this fix, even if the LLM outputs `currentScope: []`, the merge would re-introduce
    // the old vessel ID (e.g., XXX1) into the state, causing EVERY subsequent prompt in this
    // new query to also show it as an "Organic Discovery."
    const previouslyAccumulated = isTopicPivotAtIter0 ? [] : (state.workingMemory?.queryContext?.currentScope || []);
    if (isTopicPivotAtIter0 && (state.workingMemory?.queryContext?.currentScope || []).length > 0) {
        console.log(`\x1b[35m[Orchestrator] 🧹 TOPIC PIVOT ACCUM GUARD: Discarding prior scope [${(state.workingMemory?.queryContext?.currentScope || []).join(', ')}] from accumulation on new query.\x1b[0m`);
    }
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

    // 🔑 RE-SURFACE ENTITY FILTER CLEANUP (Option A — Singular vesselID, overwrite on pivot)
    //
    // PROBLEM: On no-tool SUMMARIZE turns (re-surface mode), the graph routes:
    //   orchestrator → summarizer   (update_memory is SKIPPED entirely)
    // This means update_memory2's isNewQuery reset of activeFilters never fires.
    // Stale entity-identity filters (vesselID, label) survive the checkpoint and poison
    // the NEXT turn's "Active Filters" grounding block in the Orchestrator prompt, causing
    // the LLM to re-scope to the OLD entity even after the user pivoted to a new one.
    //
    // Example: user goes XXX1 → "show MV Phoenix Demo" (re-surface) → "none in 2025?"
    // Without this fix: Turn 3 sees Active Filters: { vesselID: XXX1 } → answers about XXX1.
    // With this fix: vesselID/label are cleared here → update_memory2 re-derives them from
    // fresh tool results on the next real tool turn → correct entity is active.
    //
    // SCOPE: Only entity-identity filters are cleared. Attribute filters (statusCode,
    // startDate, limit, organization) are intentionally preserved across entity pivots.
    // 🔑 RE-SURFACE ENTITY PIVOT CLEANUP
    // Fires ONLY at iter===0 (first turn of a brand-new user query) when the Orchestrator
    // proposes SUMMARIZE without calling any new tools.
    //
    // WHY iter===0 only: At iter > 0, tools have already run in this request cycle.
    // A no-tool SUMMARIZE at iter > 0 means "I have empty/complete results, I'm done."
    // That is CORRECT behaviour — do NOT interrupt it.
    //
    // WHY no FEED_BACK_TO_ME: Forcing a loop-back routes through update_memory2 which
    // re-narrows activeFilters to a single vesselID, destroying org-wide fleet context.
    // Clearing vesselID/label from activeFilters is sufficient — the next real user turn
    // will see clean identity filters and re-derive scope from the full conversation context.
    if (finalToolCalls.length === 0 && updates.feedBackVerdict === 'SUMMARIZE' && iterationCount === 0) {
        const existingFilters = (state.workingMemory?.queryContext?.activeFilters || {}) as Record<string, string>;
        if (existingFilters.vesselID || existingFilters.label) {
            const cleanedFilters: Record<string, string> = {};
            for (const [k, v] of Object.entries(existingFilters)) {
                if (k !== 'vesselID' && k !== 'label') cleanedFilters[k] = v;
            }
            (updates.workingMemory!.queryContext as any).activeFilters = cleanedFilters;
            console.log(
                `\x1b[35m[Orchestrator] 🔄 ENTITY FILTER CLEANUP (iter=0): Cleared stale` +
                ` vesselID="${existingFilters.vesselID ?? 'none'}", label="${existingFilters.label ?? 'none'}"` +
                ` from activeFilters. Attribute filters preserved: ${JSON.stringify(cleanedFilters)}.\x1b[0m`
            );
        }
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

    // 🟢 DOMAIN PIVOT: Commit LLM's semantic domain-change judgment to state.
    // UpdateMemory2 reads this to decide whether to clear domain-specific activeFilters.
    // Explicit false reset ensures the LastValue reducer doesn't carry a stale true forward.
    updates.isDomainPivot = response.isDomainPivot === true;
    if (updates.isDomainPivot) {
        console.warn(`\x1b[35m[Orchestrator] 🔀 DOMAIN PIVOT DETECTED — UpdateMemory2 will clear domain-specific activeFilters.\x1b[0m`);
    }

    // 🎯 TICKET ACTIVATION SIGNAL: Wire LLM's ticket activation to state.
    // UpdateMemory2 reads ambiguitiesResolved to promote the chosen candidate to resolvedLabels.
    // The ticket entry is NOT deleted — it stays for reuse (deleted only by 20-to-7 compression).
    const resolvedSignal: string[] = response.ambiguitiesResolved ?? [];
    updates.ambiguitiesResolved = resolvedSignal;
    if (resolvedSignal.length > 0) {
        console.log(`\x1b[32m[Orchestrator] 🎯 LLM signalled ticket activated this turn: [${resolvedSignal.join(', ')}]\x1b[0m`);
    }

    // Wire ticket attribution fields for Summarizer
    // 🟢 Now properly typed — channels are registered in graph.ts section 13
    updates.activatedTicketLabel = response.activatedTicketLabel ?? null;
    updates.activatedTicketConfidence = response.activatedTicketConfidence ?? 0;
    updates.activatedCandidateIndex = response.activatedCandidateIndex ?? null;
    if (response.activatedTicketLabel) {
        console.log(`\x1b[32m[Orchestrator] 📌 Ticket activated: "${response.activatedTicketLabel}" (confidence=${response.activatedTicketConfidence?.toFixed(2)}, candidateIdx=${response.activatedCandidateIndex})\x1b[0m`);
    }


    // 🔗 LOG EXECUTION MODE
    if (updates.parallelizeTools === false) {
        console.log(`\x1b[33m[Orchestrator] 🔗 Sequential execution mode declared by LLM — tools will run in order: [${finalToolCalls.map((t: any) => t.name).join(' → ')}]\x1b[0m`);
    }

    // 🟢 HITL Guard: If there is a clarifying question, append it to messages so the Summarizer can look at it.
    // 🛡️ PRECEDENCE GUARD: Suppress the clarifying question if any code-level guard has already
    // overridden the verdict for this turn. Both guards stamp finalReasoning with a marker string:
    //   - DETERMINISTIC VESTIBULE → Strategic Intercept fired (unclassified labels need resolution first)
    //   - DISCOVERY STALL GUARD  → Discovery ran but no retrieval followed — loop must continue
    // Without both checks a LLM-emitted clarifyingQuestion silently stomps either guard by
    // setting feedBackVerdict=SUMMARIZE + hitl_required=true, creating an irrecoverable dead-end.

    // ─────────────────────────────────────────────────────────────────
    // ORG CONTEXT GATE
    // ─────────────────────────────────────────────────────────────────
    // Fires in three distinct conditions:
    //
    // Condition A — shouldShowOrgWarning (org genuinely unknown across all tiers):
    //   The prompt mandate alone is insufficient. LLM instruction drift causes the
    //   LLM to sometimes ask about entity types instead of the org (e.g. 'Is XXX1
    //   a vessel or machinery?'). This code-level gate overrides any such deviation.
    //   Two sub-cases:
    //     A1. LLM asked a question that doesn't mention org/fleet/company → override it.
    //     A2. LLM emitted no clarifying question at all → inject the org question.
    //
    // Condition B — orgJustInvalidated (wrong org was just detected and wiped):
    //   The FATAL DISCOVERY ERROR INTERCEPT clears the bad org from session.scope,
    //   but hasOrgContext / shouldShowOrgWarning were already computed from the old
    //   (now-deleted) values, so they won't re-fire on their own. This flag forces
    //   a deterministic re-ask regardless of what the LLM puts in its response.
    //
    // Condition C — vestibuleNoOrgFired (HITL reply with unresolvable org):
    //   The user just answered our clarifying question (isHITLContinuation=true) but
    //   typed a wrong/fake org name (e.g. "jjjj"). The Vestibule confirmed the org is
    //   still unknown. The normal !isHITLContinuation guard would silently suppress the
    //   gate here, producing a useless "empty dataset" Summarizer response.
    //   vestibuleNoOrgFired=true bypasses the HITL suppression so we re-ask correctly.
    // ─────────────────────────────────────────────────────────────────
    const orgGateShouldFire = (shouldShowOrgWarning || orgJustInvalidated || vestibuleNoOrgFired) &&
        (!state.isHITLContinuation || orgJustInvalidated || vestibuleNoOrgFired) &&
        finalToolCalls.length === 0 &&
        finalVerdict === 'SUMMARIZE';

    let effectiveClarifyingQuestion = response.clarifyingQuestion;

    if (orgGateShouldFire) {
        const cqLower = (effectiveClarifyingQuestion || '').toLowerCase();
        const asksAboutOrg =
            cqLower.includes('organization') ||
            cqLower.includes('org') ||
            cqLower.includes('company') ||
            cqLower.includes('fleet') ||
            cqLower.includes('account');

        if (!effectiveClarifyingQuestion || !asksAboutOrg) {
            // A1/A2/B: LLM deviated or emitted nothing — override with the canonical org question.
            const originalQ = effectiveClarifyingQuestion?.substring(0, 100);
            effectiveClarifyingQuestion =
                'Which organization or fleet are you working in? Please share the short name ' +
                'so I can look up the right records for you.';
            console.warn(
                `\x1b[43m\x1b[30m[Orchestrator] 🛑 ORG CONTEXT GATE FIRED\x1b[0m\x1b[33m` +
                (orgJustInvalidated ? ' [INVALIDATED ORG]' : ' [MISSING ORG]') +
                (originalQ ? ` — LLM asked: "${originalQ}" — Overriding.` : ' — LLM emitted no question. Injecting.') +
                `\x1b[0m`
            );
            finalReasoning = orgJustInvalidated
                ? `[ORG CONTEXT GATE] Bad org just invalidated. Forcing re-ask regardless of LLM question.`
                : `[ORG CONTEXT GATE] Org unknown across all tiers. LLM deviated or emitted no question.`;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 🛡️ AMBIGUITY INTERCEPTION GATE
    // ─────────────────────────────────────────────────────────────────
    // Fires when the LLM recognised the current question is related to a PENDING ambiguity
    // ticket (it set activatedTicketLabel) but tried to proceed with retrieval tools
    // autonomously — without the user explicitly picking a candidate.
    //
    // All five conditions are purely structural (schema field checks, array lengths,
    // Set membership). No string pattern matching is used.
    //
    // Condition 1 — hasPendingTickets:
    //   At least one ticket in pendingAmbiguousMatches (label NOT yet in resolvedLabels).
    //   If no pending tickets, there is nothing to block.
    //
    // Condition 2 — llmTopicMatchedATicket:
    //   LLM set activatedTicketLabel to a non-null value. This is the LLM's own structural
    //   signal that the current question is semantically related to a specific ticket.
    //   If null, the LLM correctly identified the question as unrelated (Rule 3 — domain
    //   pivot, general machinery query, etc.) → gate does NOT fire → tools proceed.
    //
    // Condition 3 — llmHasNoCandidatePick:
    //   ambiguitiesResolved array is empty. If the user explicitly said "the second one"
    //   and the LLM populated ambiguitiesResolved, that is the happy HITL-resolution path —
    //   gate does NOT fire, the resolved candidate flows through normally.
    //
    // Condition 4 — llmAskedNoClarification:
    //   LLM left clarifyingQuestion null. If the LLM correctly self-generated the question,
    //   this gate is not needed — just let it through.
    //
    // Condition 5 — llmCallingNonMetaTools:
    //   finalToolCalls contains at least one non-atomic-diagnostic tool. Meta-tools
    //   (mcp.clear_filters, mcp.query_active_filters) are state management, not retrieval —
    //   they should never be blocked by ambiguity.
    //
    // When all five fire: block all tools, force SUMMARIZE, inject the clarifying question
    // built from the ticket's structured candidate list (no string heuristics in the question
    // text itself — it is assembled from the ticket's candidate[].label and candidate[].type).
    // ─────────────────────────────────────────────────────────────────
    const AMBIGUITY_META_TOOLS = new Set(['mcp.clear_filters', 'mcp.query_active_filters']);

    const hasPendingTickets        = pendingAmbiguousMatches.length > 0;
    const llmTopicMatchedATicket   = response.activatedTicketLabel !== null && response.activatedTicketLabel !== undefined;
    const llmHasNoCandidatePick    = (response.ambiguitiesResolved ?? []).length === 0;
    const llmAskedNoClarification  = !effectiveClarifyingQuestion;
    const llmCallingNonMetaTools   = finalToolCalls.length > 0 &&
                                     !finalToolCalls.every((t: any) => AMBIGUITY_META_TOOLS.has(t.name));

    const ambiguityGateShouldFire =
        hasPendingTickets &&
        llmTopicMatchedATicket &&
        llmHasNoCandidatePick &&
        llmAskedNoClarification &&
        llmCallingNonMetaTools;

    if (ambiguityGateShouldFire) {
        // Find the ticket the LLM matched — structural equality on schema field, no pattern search
        const interceptedTicket = pendingAmbiguousMatches.find(
            (m: any) => m.label === response.activatedTicketLabel
        );

        if (interceptedTicket) {
            // Build the clarifying question from the ticket's structured candidate array.
            // No string heuristics — ordinals are index-derived, labels come from DB records.
            const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th'];
            const candidateLines = (interceptedTicket.candidates || [])
                .map((c: any, i: number) => {
                    const display = c.label || c.type || `Candidate ${i + 1}`;
                    return `${ORDINALS[i] ?? `${i + 1}th`}: ${display}`;
                })
                .join(' | ');

            effectiveClarifyingQuestion =
                `"${interceptedTicket.label}" matches ${interceptedTicket.candidates?.length ?? 0} records — ` +
                `${candidateLines}. Which one did you mean?`;

            finalToolCalls = [];
            finalVerdict = 'SUMMARIZE';
            finalReasoning =
                `[AMBIGUITY INTERCEPTION GATE] LLM matched topic to ticket "${interceptedTicket.label}" ` +
                `(${interceptedTicket.candidates?.length ?? 0} candidates) but set activatedTicketLabel ` +
                `without a candidate pick (ambiguitiesResolved=[]) and called retrieval tools. ` +
                `Blocked ${(response.tools || []).length} tool(s). Injecting candidate-list question.`;

            console.warn(
                `\x1b[41m\x1b[97m[Orchestrator] 🛡️ AMBIGUITY INTERCEPTION GATE FIRED\x1b[0m\x1b[31m` +
                ` — ticket="${interceptedTicket.label}"` +
                ` | candidates=${interceptedTicket.candidates?.length ?? 0}` +
                ` | blocked=${(response.tools || []).length} tool(s)` +
                ` | activatedTicketLabel="${response.activatedTicketLabel}"` +
                ` | ambiguitiesResolved=[]` +
                `\x1b[0m`
            );
        }
    } else {
        console.log(
            `\x1b[32m[Orchestrator] ✅ AMBIGUITY GATE: not triggered.\x1b[0m` +
            ` pendingTickets=${pendingAmbiguousMatches.length}` +
            ` | activatedTicketLabel=${response.activatedTicketLabel ?? 'null'}` +
            ` | ambiguitiesResolved=${(response.ambiguitiesResolved ?? []).length}` +
            ` | clarifyingQ=${!!effectiveClarifyingQuestion}` +
            ` | nonMetaTools=${llmCallingNonMetaTools}`
        );
    }

    // 🛡️ RESOLVE_LABELS GUARD: Deterministic signal — if labels are pending resolution,
    // suppress any LLM-emitted clarifyingQuestion. The question is premature: resolution
    // hasn't run yet. resolve_labels fires next, the LLM gets IDs on the following turn.
    // NOTE: The old 'DETERMINISTIC VESTIBULE' string check has been removed — it relied on
    // the now-disabled Strategic Intercept block which no longer stamps finalReasoning.
    if (effectiveClarifyingQuestion &&
        !finalReasoning?.includes('DISCOVERY STALL GUARD') &&
        actualUnclassified.length === 0) {
        updates.messages = [new AIMessage(effectiveClarifyingQuestion)];
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

    console.log(`[LangGraph Orchestrator] Verdict: ${updates.feedBackVerdict} | Tools Requested: ${JSON.stringify(response.tools.map((t: any) => `${t.name} (conf: ${t.confidence})`))} `);

    return updates;
}
