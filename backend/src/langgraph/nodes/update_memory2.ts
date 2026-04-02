import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { z } from "zod";
import type { SkylarkState } from "../state.js";

/**
 * Two-phase memory node:
 *   Phase 1 (Code): Extract org scope + resolved entity IDs deterministically from tool results.
 *   Phase 2 (LLM):  Produce structured queryContext JSON — pendingIntents, activeFilters, lastTurnInsight.
 *
 * Tier 1 (sessionContext) → persists across all queries, never reset.
 * Tier 2 (queryContext)   → reset ONLY on the very first turn of a brand-new request.
 * HITL continuation       → detected via isHITLContinuation flag OR existing rawQuery to skip Tier 2 reset.
 *
 * FIX (§55 + §55.2): HITL Context Collapse remediation.
 *   - rawQuery is now preserved from the ORIGINAL question even across HITL exchanges.
 *   - isNewQuery is strictly: (iter <= 1) && !isHITLContinuation — no startTurnIndex or existingRawQuery
 *     dependency, which ensures follow-up questions (Q2, Q3...) correctly reset Tier 2 context.
 *   - Phase 2 LLM receives the full HITL Q→A pair as a CONTEXT REFINEMENT block, so it
 *     understands the HITL reply is a *scoping refinement* of the original query, not a new query.
 */

const queryContextSchema = z.object({
    pendingIntents: z.array(z.string()).max(5).describe(
        "What parts of the user's original question have NOT yet been answered. Max 5 items. Empty array if everything is answered."
    ),
    activeFilters: z.array(z.object({
        key: z.string(),
        value: z.string()
    })).describe(
        "List of filters currently in use (e.g. statusCode, startDate, limit, distributionScope). Only include filters that are actively scoping results."
    ),
    lastTurnInsight: z.string().max(150).describe(
        "ONE sentence (max 150 chars) describing what just happened. Focus on IDs found or intents completed."
    ),
});

export async function nodeUpdateMemory2(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const ts = () => `[${new Date().toISOString().substring(11, 19)}]`;
    const iter = state.iterationCount ?? 0;
    console.log(`\x1b[33m${ts()} [LangGraph] 🧠 UpdateMemory2 Node invoked (iter=${iter})\x1b[0m`);

    // ─────────────────────────────────────────────────────────────────
    // PHASE 1: Code-driven — deterministic extraction, zero LLM cost
    // ─────────────────────────────────────────────────────────────────
    const existingMemory = state.workingMemory || {
        sessionContext: { scope: {} },
        queryContext: { rawQuery: "", pendingIntents: [], activeFilters: {}, lastTurnInsight: "" },
    };

    // Return ONLY the nested scope mutation to allow flawless parallel deep-merging.
    // Do NOT spread existing session state to avoid overwriting Summarizer's parallel buffer commits!
    const sessionStateCommit = {
        scope: { ...existingMemory.sessionContext?.scope },
    };

    // Flatten latest tool results
    const rawResults = state.toolResults || [];
    const history = Array.isArray(rawResults) ? rawResults : [rawResults];
    const currentTurns = history.slice(state.startTurnIndex || 0);

    const latestTurn = currentTurns[currentTurns.length - 1] || {};

    console.log(`\x1b[36m[UpdateMemory2] 📊 State snapshot: startTurnIndex=${state.startTurnIndex ?? 0} | iter=${iter} | isHITL=${state.isHITLContinuation} | existingRawQuery="${(existingMemory.queryContext?.rawQuery || '').substring(0, 60)}"\x1b[0m`);
    console.log(`\x1b[36m[UpdateMemory2] 📦 Tool turns in this request: total=${history.length} | current slice: ${currentTurns.length} turn(s) | latestTurn keys: [${Object.keys(latestTurn).join(', ') || 'none'}]\x1b[0m`);

    // Extract scope + resolved entities from ALL current turns
    const labelToMatches: Record<string, any[]> = {};

    for (const turn of currentTurns) {
        for (const [turnKey, res] of Object.entries(turn || {})) {
            let data: any = res;
            if (data?.content?.[0]?.text) {
                try {
                    const text = data.content[0].text;
                    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                        data = JSON.parse(text);
                    }
                } catch { /* ignore */ }
            }

            // A. Extract org scope from any tool result
            if (data?.organizationID && !sessionStateCommit.scope.organizationID) {
                sessionStateCommit.scope.organizationID = data.organizationID;
                console.log(`\x1b[33m[UpdateMemory2] 🏢 Captured orgID: ${data.organizationID}\x1b[0m`);
            }
            if (data?.appliedFilters?.organizationShortName && !sessionStateCommit.scope.organizationShortName) {
                sessionStateCommit.scope.organizationShortName = data.appliedFilters.organizationShortName;
                console.log(`\x1b[33m[UpdateMemory2] 🏢 Captured orgShortName: ${data.appliedFilters.organizationShortName}\x1b[0m`);
            }

            // B. Harvest Identity Resolutions (The Ambiguity Bridge)
            if (turnKey.includes('mcp.resolve_entities') && Array.isArray(data?.items)) {
                const label = data.appliedFilters?.searchTerm;
                if (label) {
                  if (!labelToMatches[label]) labelToMatches[label] = [];
                  const existing = labelToMatches[label]!;
                  data.items.forEach((item: any) => {
                    const exists = existing.some(m => m.id === item.id);
                    if (!exists) existing.push(item);
                  });
                }
            }
        }
    }

    // C. Resolve Ambiguities or Promote Singular Hits
    const ambiguousMatches: any[] = [];
    if (!sessionStateCommit.scope.resolvedLabels) {
        sessionStateCommit.scope.resolvedLabels = (existingMemory.sessionContext.scope as any).resolvedLabels || {};
    }

    for (const [label, matches] of Object.entries(labelToMatches)) {
        if (matches.length === 0) continue;

        if (matches.length === 1) {
            const hit = matches[0];
            const typeKey = `${hit.type.toLowerCase()}ID`; // e.g. vesselID, machineryID
            sessionStateCommit.scope[typeKey] = hit.id;
            
            // 🟢 PERSIST MAPPING: Store the label link so the Orchestrator knows "683..." is "XXX1"
            sessionStateCommit.scope.resolvedLabels[label] = { id: hit.id, type: hit.type };
            
            console.log(`\x1b[32m[UpdateMemory2] 💎 Promoted unique match: ${label} -> ${typeKey}: ${hit.id}\x1b[0m`);
        } else {
            console.log(`\x1b[31m[UpdateMemory2] ⚠️ Ambiguity detected for label "${label}": ${matches.length} UNIQUE matches found.\x1b[0m`);
            ambiguousMatches.push({ label, candidates: matches });
        }
    }

    // Store ambiguities in scope for Orchestrator to see
    if (ambiguousMatches.length > 0) {
        sessionStateCommit.scope.ambiguousMatches = ambiguousMatches;
    } else {
        delete sessionStateCommit.scope.ambiguousMatches; // Clear if resolved
    }

    // ─────────────────────────────────────────────────────────────────
    // NOTE: secondaryScope is intentionally NOT written here.
    // Its promotion (currentScope → secondaryScope with conversationIndex tagging
    // and 4-conversation rolling pruning) is handled deterministically in
    // orchestrator.ts at the SUMMARIZE "finish line", keeping this node clean.
    // ─────────────────────────────────────────────────────────────────
    // PHASE 1b: Tier 2 reset logic
    // ─────────────────────────────────────────────────────────────────
    //
    // FIX §55.2 — isNewQuery must fulfill:
    //   1. iter <= 1 : First iteration loop of this specific HTTP request
    //   2. !isHITLContinuation : Not a user answering a clarifying question
    //
    // We explicitly DO NOT use `startTurnIndex === 0` because that tracks thread-level
    // accumulated tool history, which is > 0 for genuine follow-up questions.
    // We explicitly DO NOT check `!existingRawQuery`, otherwise follow-up questions
    // would permanently lock onto the very first query's topic.
    //
    const existingRawQuery = existingMemory.queryContext?.rawQuery || "";
    const isNewQuery = (iter <= 1) && !state.isHITLContinuation;

    // 🛡️ AMBIGUITY GARBAGE COLLECTION: If this is a brand-new question, wipe any stale collisions 
    // from previous topics so they don't pollute the new investigation's prompt context.
    if (isNewQuery) {
        delete sessionStateCommit.scope.ambiguousMatches;
    }

    console.log(`\x1b[35m[UpdateMemory2] 🔀 Tier 2 Reset Decision:\x1b[0m`);
    console.log(`\x1b[35m  iter <= 1 = ${iter <= 1}\x1b[0m`);
    console.log(`\x1b[35m  isHITLContinuation = ${state.isHITLContinuation}\x1b[0m`);
    console.log(`\x1b[35m  existingRawQuery = "${existingRawQuery.substring(0, 60)}${existingRawQuery.length > 60 ? '...' : ''}"\x1b[0m`);
    console.log(`\x1b[35m  → isNewQuery = ${isNewQuery} ${isNewQuery ? '(🔄 TIER 2 WILL RESET)' : '(♻️ TIER 2 PRESERVED)'}\x1b[0m`);

    // ─────────────────────────────────────────────────────────────────
    // FIX §55 — rawQuery resolution: PRESERVE original query topic across HITL turns
    //
    // The HITL reply (e.g. "myco, show me top 5 per vessel") is a SCOPING REFINEMENT
    // of the original question ("Show me all overdue maintenance activities"). It contains:
    //   (a) The answer to the clarifying question (org name → captured by Phase 1 scope extraction)
    //   (b) A query refinement ("top 5 per vessel" → captured as activeFilters by Phase 2)
    //
    // The rawQuery field MUST stay anchored to the original question topic so Phase 2 generates
    // correct pendingIntents. Using the HITL reply as rawQuery strips the topic and causes the LLM
    // to declare "metric is unknown" → stall → discovery loop.
    // ─────────────────────────────────────────────────────────────────
    const allMessages = state.messages || [];
    let rawQuery = existingRawQuery; 
    
    if (!rawQuery && isNewQuery) {
        // Genuinely new request — use the latest human message
        const lastHumanMsg = [...allMessages].reverse().find((m: any) => {
            const type = m._getType?.() || m.role || 'human';
            return type === 'human';
        });
        rawQuery = (lastHumanMsg as any)?.content || "";
        console.log(`\x1b[33m[UpdateMemory2] ⚓ Anchoring rawQuery from last human message: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    } else if (rawQuery) {
        console.log(`\x1b[33m[UpdateMemory2] ♻️ Using existing rawQuery anchor: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    } else {
        // Edge case: first HITL continuation turn — memory exists but rawQuery was never set yet.
        // Use the FIRST HumanMessage in the thread (the original question), NOT the last one
        // (which would be the HITL reply like "myco, show me top 5 per vessel").
        const firstHumanMsg = allMessages.find((m: any) => {
            const type = m._getType?.() || m.role;
            return type === 'human';
        });
        const lastHumanMsg = [...allMessages].reverse().find((m: any) => {
            const type = m._getType?.() || m.role;
            return type === 'human';
        });
        rawQuery = (firstHumanMsg as any)?.content || (lastHumanMsg as any)?.content || "";
        console.log(`\x1b[33m[UpdateMemory2] 🔄 Edge case (HITL first turn, no prior rawQuery) — using FIRST human message: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    }

    // ─────────────────────────────────────────────────────────────────
    // FIX §55 — Detect HITL Q→A pair for Phase 2 context injection
    //
    // Walk the message history to find the last AI clarifying question + the human reply to it.
    // This tells Phase 2 that the human reply is a REFINEMENT of the original query, not a new query.
    // ─────────────────────────────────────────────────────────────────
    // allMessages already declared above — reuse for HITL detection
    let hitlContextBlock = "";

    if (!isNewQuery && allMessages.length >= 2) {
        // Walk backwards: find the last HumanMessage and check if the message before it was an AIMessage (clarifying question)
        const revMessages = [...allMessages].reverse();
        const lastHumanIdx = revMessages.findIndex((m: any) => {
            const type = m._getType?.() || m.role;
            return type === 'human';
        });

        if (lastHumanIdx >= 0) {
            const lastHumanContent = (revMessages[lastHumanIdx] as any)?.content || "";
            // Look for preceding AI message (clarifying question)
            const precedingAI = revMessages.slice(lastHumanIdx + 1).find((m: any) => {
                const type = m._getType?.() || m.role;
                return type === 'ai' || type === 'assistant';
            });

            if (precedingAI) {
                const clarifyingQuestion = (precedingAI as any)?.content || "";
                // Only inject if the AI message looks like a clarifying question (not a full analysis)
                const isClarifyingQuestion = clarifyingQuestion.length < 300;
                if (isClarifyingQuestion && lastHumanContent !== rawQuery) {
                    hitlContextBlock = `
CONTEXT REFINEMENT (user answered a clarifying question in this session):
  Original question: "${rawQuery}"
  AI asked: "${clarifyingQuestion.substring(0, 200)}"
  User replied: "${lastHumanContent}"
  CRITICAL INSTRUCTION: The user's reply contains BOTH the answer to the clarifying question (e.g. org name) AND potentially a query refinement. Treat the reply as narrowing/refining the original question — NOT as a replacement. Extract any refinements (like limits, status, dates) as activeFilters. The rawQuery topic remains "${rawQuery}".`;
                    console.log(`\x1b[35m[UpdateMemory2] 💬 HITL Q→A pair detected and injected into Phase 2 context:\x1b[0m`);
                    console.log(`\x1b[35m   Q: "${clarifyingQuestion.substring(0, 80)}"\x1b[0m`);
                    console.log(`\x1b[35m   A: "${lastHumanContent.substring(0, 80)}"\x1b[0m`);
                } else {
                    console.log(`\x1b[36m[UpdateMemory2] 💬 No HITL Q→A injection: reply is same as rawQuery or preceding AI was an analysis (len=${clarifyingQuestion.length}).\x1b[0m`);
                }
            } else {
                console.log(`\x1b[36m[UpdateMemory2] 💬 No preceding AI message found — no HITL context to inject.\x1b[0m`);
            }
        }
    }

    // Build previous query context for Phase 2
    // 🟢 SOFT PERSISTENCE: Instead of wiping activeFilters on a new human message, we carry them forward 
    // to the LLM as context so it can decide which ones remain relevant to the ongoing investigation.
    let previousQueryContext = isNewQuery
        ? { ...existingMemory.queryContext, rawQuery, pendingIntents: [], lastTurnInsight: "", currentScope: [] }
        : { ...existingMemory.queryContext, rawQuery }; // rawQuery always comes from our resolved value above

    // ─────────────────────────────────────────────────────────────────
    // Phase 1c: Deterministic currentScope Sync (GAP-30)
    //
    // Harvest all 24-character hex IDs from the session scope (excluding orgID) 
    // to ensure they are available in the Orchestrator's ledger for the current 
    // investigation. This prevents the LLM from losing track of resolved IDs
    // between turns even if the Phase 2 structured output misses them.
    // ─────────────────────────────────────────────────────────────────
    const deterministicScope = new Set<string>();
    Object.entries(sessionStateCommit.scope).forEach(([k, v]) => {
        if (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) && k !== 'organizationID') {
            deterministicScope.add(v);
        }
    });
    const currentScopeArray = Array.from(deterministicScope);
    console.log(`\x1b[33m[UpdateMemory2] 🆔 GAP-30: Deterministic currentScope Sync: [${currentScopeArray.join(', ')}]\x1b[0m`);

    // ─────────────────────────────────────────────────────────────────
    // PHASE 2: LLM-driven — structured queryContext update
    // ─────────────────────────────────────────────────────────────────
    const provider = process.env.MASTRA_SUMMARIZER_PROVIDER || 'openai';
    const modelName = process.env.MASTRA_SUMMARIZER_MODEL || 'gpt-5.4-mini';

    console.log(`\x1b[36m[UpdateMemory2] 🤖 Phase 2 starting — provider=${provider} model=${modelName}\x1b[0m`);
    console.log(`\x1b[36m[UpdateMemory2] 📋 Phase 2 rawQuery: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    console.log(`\x1b[36m[UpdateMemory2] 📋 Phase 2 prevIntents: [${(previousQueryContext.pendingIntents || []).join(', ') || 'none'}]\x1b[0m`);

    let baseModel: any;
    if (provider === 'openai') {
        baseModel = new ChatOpenAI({ modelName });
    } else if (provider === 'google') {
        baseModel = new ChatGoogleGenerativeAI({ model: modelName, apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || "" });
    } else {
        throw new Error(`[UpdateMemory2] Provider '${provider}' not implemented.`);
    }

    // Summarize what tools ran in the latest turn
    const toolSummaryLines: string[] = [];
    for (const [key, res] of Object.entries(latestTurn)) {
        let data: any = res;
        if (data?.content?.[0]?.text) {
            try { data = JSON.parse(data.content[0].text); } catch { /* ignore */ }
        }
        const count = Array.isArray(data?.items) ? data.items.length : (data?.isError ? -1 : 0);
        const status = data?.isError ? "FAILED" : count > 0 ? `${count} items returned` : "0 items (empty)";
        const filters = data?.appliedFilters 
            ? Object.entries(data.appliedFilters).filter(([,v]) => v).map(([k,v]) => `${k}=${v}`).join(', ') 
            : "";
        toolSummaryLines.push(`- ${key}: ${status}${filters ? ` [${filters}]` : ""}`);
    }

    console.log(`\x1b[36m[UpdateMemory2] 🔧 Tools this turn: ${toolSummaryLines.join(' | ') || 'none'}\x1b[0m`);

    const systemPrompt = `You are the Skylark Agent Memory Controller. Your job is to produce a structured JSON update for the agent's query context.

Given:
- The user's original question (rawQuery) — this is the TRUE TOPIC of the investigation
- Tools executed this turn and their outcomes
- Previous pending intents (what was still unanswered before this turn)
- Optional: A CONTEXT REFINEMENT block showing how the user refined or scoped their query

Produce ONLY the structured JSON output. No prose. No explanation.

Rules:
1. pendingIntents: Remove any intent that was just answered by a tool. Keep intents that still need data. Max 5 items.
   - IMPORTANT: If a discovery tool ran (e.g. fleet overview returning vessel IDs), the discovery intent is NOW COMPLETE. Do NOT keep "discover vessels" as a pending intent.
   - IMPORTANT: If entity IDs are now known (from discovery), the retrieval step is the ONLY remaining intent.
2. activeFilters: Extract all filters that are scoping the current query (e.g. statusCode, startDate, limit, distributionScope like "per vessel"). 
   - FILTER INHERITANCE: If the user's latest message is a continuation or an entity pivot (e.g., 'and for MV Phoenix', 'now show me XXX2'), you SHOULD preserve relevant filters from the 'Previous activeFilters' list (like statusCode: committed, limit, dates) unless the user explicitly changes them or the context makes them irrelevant.
   - ENTITY PRESERVATION: If the original 'rawQuery' contains a specific label (e.g. 'XXX1', 'DFGRE') that is NOT yet a canonical 24-char hex ID, you MUST preserve it in 'activeFilters' even if the user provides a different piece of info (like an Organization). Do NOT allow a context refinement to delete an unresolved label.
   - If the user specifies a limit or distribution scope, add them here. Do NOT hallucinate filters that are not clearly requested.
3. lastTurnInsight: One sentence only. Focus on what was resolved or found. If entities were resolved, mention the count. Max 150 chars.`;

    const userContent = `rawQuery: "${rawQuery}"

Tools executed this turn:
${toolSummaryLines.join('\n') || "None"}

Previous activeFilters (Inherit these if applicable):
${JSON.stringify(previousQueryContext.activeFilters || {}, null, 2)}

Previous pending intents:
${(previousQueryContext.pendingIntents || []).length > 0 ? previousQueryContext.pendingIntents.map((i: string) => `- ${i}`).join('\n') : "None (first turn)"}${hitlContextBlock}`;

    try {
        // includeRaw: true → response is { parsed: ZodOutput, raw: AIMessage }
        // This gives logTokenSavings access to raw.usage_metadata for real token metrics.
        const model = baseModel.withStructuredOutput(queryContextSchema, { includeRaw: true });
        const rawResponse = await model.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
        ]);
        const response = rawResponse.parsed;

        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("UpdateMemory2", rawResponse.raw); // raw AIMessage has usage_metadata

        const activeFiltersRecord: Record<string, string> = {};
        if (Array.isArray(response.activeFilters)) {
            for (const filter of response.activeFilters) {
                if (filter.key && filter.value) {
                    activeFiltersRecord[filter.key] = filter.value;
                }
            }
        }

        const updatedQueryContext = {
            ...previousQueryContext,
            rawQuery,   // Always use our deterministically resolved rawQuery, not whatever the LLM might output
            pendingIntents: response.pendingIntents || [],
            activeFilters: activeFiltersRecord,
            lastTurnInsight: response.lastTurnInsight || "",
            currentScope: currentScopeArray, // 🟢 GAP-30: Use deterministic truth from Phase 1
        };

        // Rich diagnostic output
        console.log(`\x1b[32m${ts()} [UpdateMemory2] ✅ Phase 2 Complete.\x1b[0m`);
        console.log(`\x1b[32m  rawQuery (preserved): "${updatedQueryContext.rawQuery.substring(0, 80)}"\x1b[0m`);
        console.log(`\x1b[32m  pendingIntents (${updatedQueryContext.pendingIntents.length}): [${updatedQueryContext.pendingIntents.join(' | ') || 'none ← READY TO RETRIEVE'}]\x1b[0m`);
        console.log(`\x1b[32m  activeFilters: ${JSON.stringify(updatedQueryContext.activeFilters)}\x1b[0m`);
        console.log(`\x1b[32m  lastTurnInsight: "${updatedQueryContext.lastTurnInsight}"\x1b[0m`);

        if (updatedQueryContext.pendingIntents.length === 0) {
            console.log(`\x1b[32m[UpdateMemory2] 🚀 No pending intents — Orchestrator should proceed directly to RETRIEVAL on next turn.\x1b[0m`);
        } else {
            console.log(`\x1b[33m[UpdateMemory2] ⏳ ${updatedQueryContext.pendingIntents.length} intent(s) still pending — Orchestrator will continue.\x1b[0m`);
        }

        return {
            workingMemory: {
                sessionContext: sessionStateCommit,
                queryContext: updatedQueryContext,
            },
            isHITLContinuation: false, // Reset after processing
        };
    } catch (e: any) {
        const { logLLMError } = await import("../utils/logger.js");
        logLLMError("UpdateMemory2", e);
        console.log(`\x1b[31m[UpdateMemory2] ⚠️ Phase 2 FAILED — preserving existing queryContext with rawQuery="${rawQuery.substring(0, 60)}"\x1b[0m`);
        // Graceful degradation: keep existing memory, don't crash the graph
        return {
            workingMemory: {
                sessionContext: sessionStateCommit,
                queryContext: { ...previousQueryContext, rawQuery },
            },
            isHITLContinuation: false,
        };
    }
}
