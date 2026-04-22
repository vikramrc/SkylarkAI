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

    // ─────────────────────────────────────────────────────────────────
    // SNAPSHOT: Record which entity-scope keys+values are INHERITED from the previous session.
    // This must be captured BEFORE Phase 1 runs, so we can distinguish precisely between:
    //   (a) stale pointers from prior queries (same key AND same value as inherited)
    //   (b) freshly resolved IDs from THIS turn's tools (same key type, DIFFERENT new hex value)
    //
    // Using a Map<key, value> instead of a Set<key>: if Phase 1 resolves "MV Blue Sky" to a
    // new vesselID 'abc123' but the inherited vesselID was '683b...', the value mismatch ensures
    // the fresh ID is promoted correctly to currentScope (not mistakenly excluded as stale).
    // ─────────────────────────────────────────────────────────────────
    const TRANSIENT_SCOPE_KEYS = ['vesselID', 'machineryID', 'scheduleID', 'activityID', 'costCenterID', 'searchTerm', 'label'];
    const inheritedEntityScopeSnapshot = new Map<string, string>(
        TRANSIENT_SCOPE_KEYS
            .filter(k => !!(existingMemory.sessionContext?.scope as any)?.[k])
            .map(k => [k, (existingMemory.sessionContext?.scope as any)[k] as string])
    );

    // Flatten latest tool results
    const rawResults = state.toolResults || [];
    const history = Array.isArray(rawResults) ? rawResults : [rawResults];
    // 🟢 GAP-PRUNE FIX: startTurnIndex is a lifetime absolute offset. If the toolResults array
    // was pruned (capped at 30) in graph.ts, the absolute index may exceed the array length,
    // causing an empty slice. Clamp to always include at least the last 1 entry (this request).
    const historyLen = history.length;
    const safeStart = Math.min(state.startTurnIndex || 0, Math.max(0, historyLen - 1));
    const currentTurns = history.slice(safeStart);

    const latestTurn = currentTurns[currentTurns.length - 1] || {};

    console.log(`\x1b[36m[UpdateMemory2] 📊 State snapshot: startTurnIndex=${state.startTurnIndex ?? 0} | iter=${iter} | isHITL=${state.isHITLContinuation} | existingRawQuery="${(existingMemory.queryContext?.rawQuery || '').substring(0, 60)}"\x1b[0m`);
    console.log(`\x1b[36m[UpdateMemory2] 📦 Tool turns in this request: total=${history.length} | current slice: ${currentTurns.length} turn(s) | latestTurn keys: [${Object.keys(latestTurn).join(', ') || 'none'}]\x1b[0m`);

    // ─────────────────────────────────────────────────────────────────
    // SCOPE_NAVIGABLE_KEYS: Entity types whose ObjectIds belong in currentScope
    // (the fleet-iteration array used by the Orchestrator to loop over vessels).
    //
    // Non-navigable IDs (crewcompetencysignalID, activityID, scheduleID, etc.) are
    // stored in sessionStateCommit.scope under their typed key — available to the
    // Orchestrator as query parameters — but NEVER promoted into currentScope.
    // This prevents cross-domain ID contamination (e.g., a signal ObjectId being
    // passed as vesselID to maintenance.query_status).
    // ─────────────────────────────────────────────────────────────────
    const SCOPE_NAVIGABLE_KEYS = new Set(['vesselID', 'machineryID']);

    // Extract scope + resolved entities from ALL current turns
    const labelToMatches: Record<string, any[]> = {};
    const organicallyDiscoveredIds = new Set<string>();

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

            // Helper: reject null, undefined, or empty/whitespace-only org values
            const isValidOrgValue = (val: any): val is string => typeof val === 'string' && val.trim() !== '';

            // A. Extract org scope from any tool result
            if (isValidOrgValue(data?.organizationID) && !sessionStateCommit.scope.organizationID) {
                sessionStateCommit.scope.organizationID = data.organizationID;
                console.log(`\x1b[33m[UpdateMemory2] 🏢 Captured orgID: ${data.organizationID}\x1b[0m`);
            }
            if (isValidOrgValue(data?.appliedFilters?.organizationShortName) && !sessionStateCommit.scope.organizationShortName) {
                sessionStateCommit.scope.organizationShortName = data.appliedFilters.organizationShortName;
                console.log(`\x1b[33m[UpdateMemory2] 🏢 Captured orgShortName: ${data.appliedFilters.organizationShortName}\x1b[0m`);
            }

            // B. Harvest Identity Resolutions (The Ambiguity Bridge)
            // Check data.capability first — synthetic results from resolve_labels node set
            // capability='mcp.resolve_entities' in the payload but use a different key prefix.
            const isResolutionResult = data?.capability === 'mcp.resolve_entities' || turnKey.includes('mcp.resolve_entities');
            if (isResolutionResult && Array.isArray(data?.items)) {
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

            // C. Harvest ALL organic IDs from any returned array payload ONLY for discovery tools.
            // This prevents context bleeding from leaf-node tools like 'maintenance.query_status' (which can return 500 tasks).
            const capabilityStr = typeof data?.capability === 'string' ? data.capability : turnKey;
            const isDiscovery = capabilityStr.includes('overview') || 
                                capabilityStr.includes('resolve_entities') || 
                                capabilityStr.includes('structures') || 
                                capabilityStr.includes('search');
            
            if (isDiscovery && Array.isArray(data?.items)) {
                data.items.forEach((item: any) => {
                    const id = item._id || item.id;
                    if (typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id)) {
                        // 🟢 SCOPE_NAVIGABLE_KEYS FILTER: For resolve_entities results, only harvest
                        // IDs of scope-navigable entity types (Vessel, Machinery) into currentScope.
                        // Non-navigable types (CrewCompetencySignal, MaintenanceActivity, etc.) are
                        // stored in sessionStateCommit.scope[typeKey] by the label resolution block
                        // below — they stay as typed query params, not scope navigators.
                        // For other discovery tools (fleet.query_overview) — harvest all (they return vessels).
                        if (isResolutionResult) {
                            const typeKey = `${(item.type || '').toLowerCase()}ID`;
                            if (SCOPE_NAVIGABLE_KEYS.has(typeKey)) {
                                organicallyDiscoveredIds.add(id);
                            }
                            // else: ID is already captured in sessionStateCommit.scope[typeKey] — skip currentScope
                        } else {
                            organicallyDiscoveredIds.add(id);
                        }
                    }
                });
            }
        }
    }

    // D. Resolve Ambiguities or Promote Singular Hits
    const newAmbiguousMatches: any[] = []; // ← Renamed: only tickets born THIS turn from resolve_labels
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
            const convIndex = (existingMemory.sessionContext?.humanConversationCount ?? 0) + 1;
            newAmbiguousMatches.push({
                label,
                candidates: matches,
                // 🟢 TICKET MODEL: Capture the query that caused this ambiguity so the Orchestrator
                // can semantically match future user messages to the right ticket without re-asking.
                originQuery: state.reformulatedQuery || existingMemory.queryContext?.rawQuery || label,
                // 🟢 LIFECYCLE: Used by Summarizer's 20-to-7 compression to prune stale tickets.
                conversationIndex: convIndex,
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 🎯 PERSISTENT TICKET MODEL — Three-Step Union (Phase 22 Fix)
    //
    // ─────────────────────────────────────────────────────────────────
    const inheritedAmbiguousMatches: any[] = (existingMemory.sessionContext?.scope as any)?.ambiguousMatches || [];
    const ambiguitiesResolvedThisTurn: string[] = (state as any).ambiguitiesResolved ?? [];
    // Also read the explicit candidate index the Orchestrator signalled (0-based, per Zod schema)
    const activatedTicketLabel: string | null = (state as any).activatedTicketLabel ?? null;
    const activatedCandidateIdx: number | null = (state as any).activatedCandidateIndex ?? null;

    if (!sessionStateCommit.scope.resolvedLabels) sessionStateCommit.scope.resolvedLabels = {};

    // Step 1 — Process LLM-signalled candidate promotions on INHERITED tickets
    // Also checks newAmbiguousMatches (brand-new tickets) in case the LLM activates a ticket
    // on the same turn it was born (e.g. RULE 2 topic-match auto-activation).
    const allTicketsForStep1 = [
        ...inheritedAmbiguousMatches,
        // Include new tickets NOT already in inherited (deduplicate by label to avoid double-processing)
        ...newAmbiguousMatches.filter((n: any) => !inheritedAmbiguousMatches.some((i: any) => i.label === n.label)),
    ];

    if (ambiguitiesResolvedThisTurn.length > 0 && allTicketsForStep1.length > 0) {
        for (const entry of allTicketsForStep1) {
            if (ambiguitiesResolvedThisTurn.includes(entry.label) && entry.candidates?.length > 0) {
                // 🟢 GAP-2 FIX: Prefer the explicit Orchestrator-signalled candidate index over the
                // brittle toolCallsStr heuristic. activatedCandidateIdx is 0-based (per Zod schema comment).
                // Only fall back to string-search if: (a) no index, or (b) this ticket's label doesn't
                // match the activatedTicketLabel (i.e. a different ticket was activated this turn).
                let picked: any;
                const isThisTheActivatedTicket = activatedTicketLabel === entry.label;
                if (isThisTheActivatedTicket && typeof activatedCandidateIdx === 'number'
                    && activatedCandidateIdx >= 0 && activatedCandidateIdx < entry.candidates.length) {
                    // ✅ Deterministic path — use explicit LLM-signalled index
                    picked = entry.candidates[activatedCandidateIdx];
                    console.log(`\x1b[32m[UpdateMemory2] 🎯 TICKET ACTIVATED (explicit index ${activatedCandidateIdx}): label "${entry.label}" → ${picked.type}:${picked.id.substring(0,8)}…\x1b[0m`);
                } else {
                    // ⚠️ Fallback path — search toolCalls for the used ID
                    const toolCallsStr = JSON.stringify((state as any).toolCalls || []);
                    const usedCandidate = entry.candidates.find((c: any) => c.id && toolCallsStr.includes(c.id));
                    picked = usedCandidate ?? entry.candidates[0];
                    if (picked !== entry.candidates[0]) {
                        console.log(`\x1b[32m[UpdateMemory2] 🎯 TICKET ACTIVATED (toolCall search): label "${entry.label}" → ${picked.type}:${picked.id.substring(0,8)}…\x1b[0m`);
                    } else {
                        console.log(`\x1b[33m[UpdateMemory2] 🎯 TICKET ACTIVATED (defaulted to candidates[0]): label "${entry.label}" — no explicit index, no toolCall match.\x1b[0m`);
                    }
                }

                if (!sessionStateCommit.scope.resolvedLabels[entry.label]) {
                    sessionStateCommit.scope.resolvedLabels[entry.label] = { id: picked.id, type: picked.type };
                }
            }
        }
        console.log(`\x1b[32m[UpdateMemory2] 🧹 Processed ${ambiguitiesResolvedThisTurn.length} ticket activation(s) via LLM signal (checked ${allTicketsForStep1.length} tickets: ${inheritedAmbiguousMatches.length} inherited + ${newAmbiguousMatches.length} new).\x1b[0m`);
    }


    // Step 2 — Build the unified ticket set: inherited UNION new (deduplicated by label)
    // New tickets from this turn take precedence if the label collides (they have fresher originQuery/candidates).
    const resolvedIdsSet = new Set(
        Object.values(sessionStateCommit.scope.resolvedLabels || {}).map((v: any) => v?.id).filter(Boolean)
    );
    const newTicketLabels = new Set(newAmbiguousMatches.map((m: any) => m.label));

    // Start with all inherited tickets, then append truly new ones (no label collision).
    const candidateUnion: any[] = [
        ...inheritedAmbiguousMatches.filter((entry: any) => !newTicketLabels.has(entry.label)),
        ...newAmbiguousMatches,
    ];

    // Step 3 — Vestibule-prune: ONLY drop tickets if ALL candidates are resolved
    // 🟢 IMPORTANT: Resolved tickets STAY in ambiguousMatches as reusable lookup tables.
    // The user may say "now the third one" after already picking "the second one".
    // Deletion now only happens via the 20-to-7 compression lifecycle in summarizer.ts.
    // This step only removes tickets where a candidate has been chosen AND the purpose
    // of the ticket (showing candidates) is now superseded by resolvedLabels.
    //
    // CHANGED: Previously `return false` (delete) for resolved candidates.
    // Now we always `return true` (keep) so the ticket persists for follow-up ordinal picks.
    // The resolvedLabels entry already records the chosen candidate — that's sufficient.
    const survivingTickets = candidateUnion.filter((entry: any) => {
        const chosenCandidate = entry.candidates.find((c: any) => resolvedIdsSet.has(c.id));
        if (chosenCandidate) {
            // 🟢 VESTIBULE REGISTRATION: Register the chosen candidate in resolvedLabels
            // so the Vestibule guard won't re-fire resolve_entities for this label on future turns.
            const existingEntry = sessionStateCommit.scope.resolvedLabels[entry.label];
            if (!existingEntry) {
                sessionStateCommit.scope.resolvedLabels[entry.label] = { id: chosenCandidate.id, type: chosenCandidate.type };
                console.log(`\x1b[32m[UpdateMemory2] ✅ Vestibule-registered "${entry.label}" → ${chosenCandidate.type}:${chosenCandidate.id.substring(0,8)}… (skip guard granted)\x1b[0m`);
            }
            // 🟢 KEEP THE TICKET: Do NOT return false here. The ticket stays in ambiguousMatches
            // so the user can say "now the third one" and the LLM still has the full candidate list.
            console.log(`\x1b[32m[UpdateMemory2] 📌 Ticket "${entry.label}" resolved but PERSISTED for follow-up ordinal picks.\x1b[0m`);
        }
        return true; // Always keep — lifecycle managed by 20-to-7 compression only
    });

    // Step 4 — Unconditionally write back the surviving ticket set.
    // 🟢 KEY INVARIANT: This write is NOT conditional on ambiguitiesResolvedThisTurn.
    // Even on turns where the user asks a completely different question (no ticket activated),
    // we preserve the inherited tickets by writing them back here.
    if (survivingTickets.length > 0) {
        sessionStateCommit.scope.ambiguousMatches = survivingTickets;
        console.log(`\x1b[32m[UpdateMemory2] 📌 Ticket store: ${survivingTickets.length} ticket(s) persisted (${inheritedAmbiguousMatches.length} inherited, ${newAmbiguousMatches.length} new this turn).\x1b[0m`);
    } else {
        delete sessionStateCommit.scope.ambiguousMatches;
        if (inheritedAmbiguousMatches.length > 0 || newAmbiguousMatches.length > 0) {
            console.log(`\x1b[32m[UpdateMemory2] ✅ All ambiguity tickets resolved or vestibule-pruned — cleared from scope.\x1b[0m`);
        }
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
    // FIX §55.3 — isNewQuery must fulfill:
    //   1. iter <= 1 : First iteration loop of this specific HTTP request
    //   2. !wasHITL  : The prior graph run did NOT end with a clarifying question
    //
    // CRITICAL: We use `hitl_required` (checkpoint-level signal) NOT `isHITLContinuation`
    // (turn-level signal). Here's why they differ:
    //
    //   isHITLContinuation — set to `true` when AI emits a clarifying question, but
    //     RESET to `false` by orchestrator.ts line ~1365 on the FIRST tool run of this
    //     HTTP request. By the time update_memory2 runs at iter=1, isHITLContinuation
    //     is already `false`, so (iter<=1 && !false) = TRUE → spurious Tier 2 reset.
    //
    //   hitl_required — set to `true` in the LangGraph checkpoint when the AI asks a
    //     clarifying question (orchestrator.ts line ~1555). It is only reset to `false`
    //     when orchestrator.ts runs a normal non-HITL turn. It correctly survives the
    //     full HTTP boundary and both iter=0 AND iter=1 of the continuation request.
    //
    // Principle (owner-stated invariant):
    //   "If the AI asked a question → HITL. The next request is ALWAYS a continuation.
    //    A NEW query only begins AFTER the Summarizer completes (hitl_required=false)."
    //
    // We explicitly DO NOT use `startTurnIndex === 0` because that tracks thread-level
    // accumulated tool history, which is > 0 for genuine follow-up questions.
    // We explicitly DO NOT check `!existingRawQuery`, otherwise follow-up questions
    // would permanently lock onto the very first query's topic.
    //
    // ─────────────────────────────────────────────────────────────────
    // Debug Insight: What state context is reaching Phase 2?
    // ─────────────────────────────────────────────────────────────────
    console.log(`\x1b[36m[UpdateMemory2] 📊 State snapshot: startTurnIndex=${state.startTurnIndex || 0} | iter=${iter} | isHITL=${state.isHITLContinuation} | reformulatedQuery=${state.reformulatedQuery ? 'YES' : 'NO'}\x1b[0m`);

    const existingRawQuery = existingMemory.queryContext?.rawQuery || "";
    // 🟢 FIX §55.4: Detect HITL continuation from MESSAGE HISTORY — immune to state flag timing.
    //
    // Previous attempts used state.hitl_required or state.isHITLContinuation. Both fail because
    // orchestrator.ts resets them at line ~1359 on the FIRST tool run of the continuation request.
    // By the time update_memory2 runs at iter=1, both flags are already false.
    //
    // Message history is IMMUTABLE. If the AI message immediately before the current human
    // message contains a '?' and is NOT an [INSIGHT] summary, the prior graph run ended with
    // a clarifying question — this request is definitively a HITL continuation.
    //
    // Owner-stated invariant:
    //   "If the AI asked a question → HITL. The next request is ALWAYS a continuation.
    //    A NEW query only begins AFTER the Summarizer completes."
    const _allMsgsForHitl = state.messages || [];
    const _revMsgsForHitl = [..._allMsgsForHitl].reverse();
    const _lastHumanIdx = _revMsgsForHitl.findIndex((m: any) =>
        (m._getType?.() || m.role) === 'human'
    );
    const _precedingAI = _lastHumanIdx >= 0
        ? _revMsgsForHitl.slice(_lastHumanIdx + 1).find((m: any) => {
            const t = m._getType?.() || m.role;
            return t === 'ai' || t === 'assistant';
          })
        : null;
    const _precedingContent: string = (_precedingAI as any)?.content || '';
    // HITL if: prior AI message has a '?' AND is not an [INSIGHT] summary (which naturally has '?' sometimes)
    const wasHITL = !!(_precedingContent.includes('?') && !_precedingContent.includes('[INSIGHT]'));
    const isNewQuery = (iter <= 1) && !wasHITL;

    // 🛡️ NOTE: Ambiguity cleanup is handled deterministically by lines 200-205 above.
    // If fresh resolve_entities tools ran and found multiple matches → ambiguousMatches is SET (line 202).
    // If no ambiguities found (0 or 1 match per label) → ambiguousMatches is DELETED (line 204).
    // A separate GC block here was previously deleting fresh ambiguities at iter=1 (isNewQuery=true),
    // causing the Orchestrator to never see AMBIGUITY DETECTED and re-intercepting forever.
    // Line 204 already covers the stale-cleanup case: if no resolve tools ran in this request,
    // labelToMatches is empty → ambiguousMatches=[] → line 204 deletes any inherited stale ones. ✅

    console.log(`\x1b[35m[UpdateMemory2] 🔀 Tier 2 Reset Decision:\x1b[0m`);
    console.log(`\x1b[35m  iter <= 1 = ${iter <= 1}\x1b[0m`);
    console.log(`\x1b[35m  wasHITL (message-history scan) = ${wasHITL} | precedingAI snippet: "${_precedingContent.substring(0, 60)}"\x1b[0m`);
    console.log(`\x1b[35m  isHITLContinuation (turn-level ref) = ${state.isHITLContinuation} | hitl_required (state ref) = ${!!(state as any).hitl_required}\x1b[0m`);
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
    let rawQuery = state.reformulatedQuery || "";

    if (!rawQuery) {
        if (isNewQuery) {
            // ─────────────────────────────────────────────────────────────────
            // CLEAN rawQuery ANCHORING
            // ─────────────────────────────────────────────────────────────────
            // At isNewQuery=true (iter ≤ 1 AND not HITL continuation), we are always on the FIRST
            // tool turn of a brand-new user request. The last HumanMessage in state.messages IS the
            // new query — no ambiguity, no string scanning needed.
            //
            // Why not the INSIGHT scan that was here before?
            //   - INSIGHT scanning was fragile: looked for literal "[INSIGHT]" but real summaries
            //     use "[INSIGHT title=...]", so the match was always -1 → wrong boundary.
            //   - It solved a problem that doesn't exist: "what if the last HumanMessage is a HITL
            //     answer from the previous conversation?" That can't happen here because if it were
            //     a HITL continuation, isHITLContinuation=true and isNewQuery would be false.
            // ─────────────────────────────────────────────────────────────────
            const lastHumanMsg = [...allMessages].reverse().find((m: any) => {
                const type = m._getType?.() || m.role;
                return type === 'human';
            });
            const missionTopic = (lastHumanMsg as any)?.content || existingRawQuery || "";

            if (existingRawQuery && existingRawQuery !== missionTopic) {
                console.log(`\x1b[32m[UpdateMemory2] ⚓ NEW CONVERSATION DETECTED — TOPIC PIVOT:\x1b[0m`);
                console.log(`\x1b[36m  From: "${existingRawQuery.substring(0, 80)}"\x1b[0m`);
                console.log(`\x1b[32m  To:   "${missionTopic.substring(0, 80)}"\x1b[0m`);
            } else {
                console.log(`\x1b[33m[UpdateMemory2] ⚓ rawQuery anchored to last human message: "${missionTopic.substring(0, 80)}"\x1b[0m`);
            }
            rawQuery = missionTopic;
        } else if (existingRawQuery) {
            // Internal loop or HITL continuation — the topic was already anchored on isNewQuery=true.
            rawQuery = existingRawQuery;
            console.log(`\x1b[33m[UpdateMemory2] ♻️ Using existing rawQuery anchor: "${rawQuery.substring(0, 80)}"\x1b[0m`);
        } else {
            // Edge case: very first turn of a thread, no prior rawQuery.
            const lastHumanMsg = [...allMessages].reverse().find((m: any) => {
                const type = m._getType?.() || m.role;
                return type === 'human';
            });
            rawQuery = (lastHumanMsg as any)?.content || "";
            console.log(`\x1b[33m[UpdateMemory2] 🔄 Edge case (no prior rawQuery) — using last human message: "${rawQuery.substring(0, 80)}"\x1b[0m`);
        }
    } else {
        console.log(`\x1b[36m[UpdateMemory2] 🎯 Adopted Orchestrator's Reformulated intent: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    }

    // ─────────────────────────────────────────────────────────────────
    // 🟢 CONVERSATION JOURNAL: Build turn-by-turn factual log
    // Code-maintained — never LLM-written. The orchestrator reads ONLY this to produce reformulatedQuery.
    // Format: "T_n [Tag]: <factual statement>"
    // Reset on isNewQuery. Appended on every continuation turn.
    // ─────────────────────────────────────────────────────────────────
    const existingJournal: string[] = (existingMemory.queryContext as any)?.conversationJournal || [];
    let updatedJournal: string[] = [...existingJournal];
    const nextTurnNum = updatedJournal.length + 1;

    if (isNewQuery) {
        // Brand-new conversation: seed with the user's original query
        updatedJournal = [`T1 [User]: ${rawQuery.substring(0, 200)}`];
        console.log(`\x1b[33m[UpdateMemory2] 📋 JOURNAL RESET — new conversation. Seeded: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    } else {
        // ── Append tool-run entry (if tools ran this turn) ──
        if (Object.keys(latestTurn).length > 0) {
            const toolLines: string[] = [];
            for (const [key, res] of Object.entries(latestTurn)) {
                let data: any = res;
                if (data?.content?.[0]?.text) {
                    try { data = JSON.parse(data.content[0].text); } catch { /* ignore */ }
                }
                const isResolution = key.includes('resolve_entities') || data?.capability === 'mcp.resolve_entities';
                const count = Array.isArray(data?.items) ? data.items.length : (data?.isError ? -1 : 0);
                if (isResolution) {
                    const label = data?.appliedFilters?.searchTerm || 'unknown';
                    if (count === 0) {
                        toolLines.push(`Resolve "${label}" → no matches`);
                    } else if (count === 1) {
                        const hit = data.items[0];
                        toolLines.push(`Resolve "${label}" → 1 unique match: ${hit.label || hit.type} (${hit.type}:${(hit.id||'').substring(0,8)}…)`);
                    } else {
                        const types = [...new Set((data.items as any[]).map((i: any) => i.type))].join(', ');
                        const labels = (data.items as any[]).map((i: any) => i.label || i.type).slice(0, 4).join(', ');
                        toolLines.push(`Resolve "${label}" → ${count} matches (${types}): ${labels}${count > 4 ? '…' : ''}`);
                    }
                } else {
                    const capName = data?.capability || key;
                    const status = data?.isError ? 'FAILED' : count > 0 ? `${count} records` : '0 records (empty)';
                    toolLines.push(`${capName} → ${status}`);
                }
            }
            if (toolLines.length > 0) {
                updatedJournal.push(`T${nextTurnNum} [Tool]: ${toolLines.join(' | ')}`);
                console.log(`\x1b[33m[UpdateMemory2] 📋 JOURNAL +Tool: "${toolLines.join(' | ').substring(0, 120)}"\x1b[0m`);
            }
        // ── Capture HITL Q/A pair when this is a HITL continuation with no tools yet ──
        // iter <= 1 guard: only capture once (on the FIRST iteration of the continuation).
        // Without this, on a FEED_BACK_TO_ME no-tool loop at iter=2+, wasHITL is still
        // true (message history is static), causing the same Q/A pair to be appended again.
        } else if (wasHITL && iter <= 1 && allMessages.length >= 2) {
            // No tools ran — first iteration of a HITL continuation.
            // Record the AI question and user answer as a pair.
            const lastHumanContent = (allMessages[allMessages.length - 1] as any)?.content || '';
            const aiQuestion = _precedingContent.substring(0, 250);
            updatedJournal.push(
                `T${nextTurnNum} [AI Clarification]: ${aiQuestion}${_precedingContent.length > 250 ? '…' : ''}`,
                `T${nextTurnNum + 1} [User Reply]: ${lastHumanContent.substring(0, 200)}`
            );
            console.log(`\x1b[33m[UpdateMemory2] 📋 JOURNAL +HITL Q/A: AI asked → User replied "${lastHumanContent.substring(0, 60)}"\x1b[0m`);
        }
    }
    console.log(`\x1b[33m[UpdateMemory2] 📋 JOURNAL (${updatedJournal.length} entries): ${updatedJournal.map(e => `"${e.substring(0, 60)}"`).join(' → ')}\x1b[0m`);

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
                // Fix Gap 2: Use state.isHITLContinuation as the primary structural signal
                // instead of a length heuristic (< 300 chars). The length check silently
                // dropped the HITL context block for long disambiguation questions such as:
                //   "I found 3 candidates: CCCCCCC (Machinery), CCCCCCC (Component), ..."
                // which easily exceed 300 chars but are genuine clarifying questions.
                // state.isHITLContinuation is set to true by the Orchestrator whenever it
                // emits a HITL question and stays true on the state until update_memory2
                // resets it at the very end of this function — so at this point it is still
                // the incoming value and is a reliable structural signal.
                // Belt-and-suspenders fallback: also accept any preceding AI message that
                // contains a question mark, for rare edge cases where the flag isn't set.
                const isClarifyingQuestion = state.isHITLContinuation === true || clarifyingQuestion.includes('?');
                if (isClarifyingQuestion && lastHumanContent !== rawQuery) {
                    hitlContextBlock = `
CONTEXT REFINEMENT (user answered a clarifying question in this session):
  Original question: "${rawQuery}"
  AI asked: "${clarifyingQuestion.substring(0, 300)}"
  User replied: "${lastHumanContent}"
  CRITICAL INSTRUCTION: The user's reply contains BOTH the answer to the clarifying question (e.g. org name) AND potentially a query refinement. Treat the reply as narrowing/refining the original question — NOT as a replacement. Extract any refinements (like limits, status, dates) as activeFilters. The rawQuery topic remains "${rawQuery}".`;
                    console.log(`\x1b[35m[UpdateMemory2] 💬 HITL Q→A pair detected and injected into Phase 2 context:\x1b[0m`);
                    console.log(`\x1b[35m   Q: "${clarifyingQuestion.substring(0, 80)}"\x1b[0m`);
                    console.log(`\x1b[35m   A: "${lastHumanContent.substring(0, 80)}"\x1b[0m`);
                } else {
                    console.log(`\x1b[36m[UpdateMemory2] 💬 No HITL Q→A injection: reply is same as rawQuery or preceding AI was an analysis (isHITL=${state.isHITLContinuation}, hasQ=${clarifyingQuestion.includes('?')}).\x1b[0m`);
                }
            } else {
                console.log(`\x1b[36m[UpdateMemory2] 💬 No preceding AI message found — no HITL context to inject.\x1b[0m`);
            }
        }
    }

    // Build previous query context for Phase 2.
    // FIX: DO NOT wipe activeFilters automatically on isNewQuery=true. 
    // If the user's new query is an implicit continuation or pivot (e.g. "what about 2025" or "and for XXX2"), State resets
    // but the user expects filters (like 'status=cancelled') to dynamically carry over.
    // By passing existingMemory.queryContext?.activeFilters, we allow the Phase 2 LLM prompt rule "FILTER INHERITANCE" 
    // to determine whether the filters still apply to the new rawQuery.
    let previousQueryContext = isNewQuery
        ? {
            ...existingMemory.queryContext,
            rawQuery,
            pendingIntents: [],
            lastTurnInsight: "",
            currentScope: [],
            // 🟢 DOMAIN PIVOT: If the Orchestrator detected a domain switch (maintenance→competency etc.),
            // clear domain-specific attribute filters — they are meaningless in the new domain.
            // On entity pivot within the same domain (XXX1→YYY1), isDomainPivot=false, so filters
            // are inherited as normal per the FILTER INHERITANCE rule in Phase 2.
            activeFilters: state.isDomainPivot
                ? ((): Record<string, string> => {
                    console.log(`\x1b[35m[UpdateMemory2] 🔀 DOMAIN PIVOT ACTIVE — clearing domain-specific activeFilters (${JSON.stringify(existingMemory.queryContext?.activeFilters || {})}).\x1b[0m`);
                    return {};
                })()
                : (existingMemory.queryContext?.activeFilters || {})
          }
        : { ...existingMemory.queryContext, rawQuery }; // rawQuery always comes from our resolved value above

    // ─────────────────────────────────────────────────────────────────
    // 🌐 BROAD SCOPE OVERRIDE: When state.isBroadScopeRequest=true, the user explicitly de-scoped
    // from a specific entity to org/fleet-wide THIS turn. We surgically clear OLD entity-scope IDs from
    // the scope so they don't pollute this investigation.
    // Entity-scope keys: vesselID, machineryID, scheduleID, activityID, costCenterID
    // Attribute filters (statusCode, date, limit, etc.) are NOT touched here — they follow LLM reasoning.
    const isBroadScopeTriggered = state.isBroadScopeRequest === true;
    const entityScopeKeys = ['vesselID', 'machineryID', 'scheduleID', 'activityID', 'costCenterID', 'searchTerm', 'entityLabel', 'resolvedEntityType'];
    
    if (isBroadScopeTriggered) {
        entityScopeKeys.forEach(k => {
            delete sessionStateCommit.scope[k];
            if (previousQueryContext.activeFilters) {
                delete (previousQueryContext.activeFilters as any)[k];
            }
        });
        console.log(`\x1b[35m[UpdateMemory2] 🌐 Broad Scope TRIGGERED — cleared entity-scope filters (vesselID, machineryID, searchTerm, etc.) from session scope. Attribute filters (status, date, limit) handled by Phase 2.\x1b[0m`);
    }

    // Persist the mode so Orchestrator remembers it's doing a broad scope search across iterations.
    //
    // FIX (Bug C): isBroadScope must EXIT when a new query starts that is NOT a broad-scope request.
    // Previously it was: triggered || existingBroadScope — meaning once true, always true.
    // A user going "show org wide" followed by "show me XXX1 specifically" would forever stay in
    // broad scope mode: the Vessel Gravity Shield would hide their vessel ID, ledger isolation would
    // hide their prior vessel results, and the broad scope prompt would keep firing incorrectly.
    //
    // Correct logic:
    //   - If triggered this turn: ACTIVE (user just asked for broad scope)
    //   - If previous turn was already broad scope AND this is a continuation (not a new query): ACTIVE
    //   - If isNewQuery=true AND NOT triggered this turn: RESET (user started a fresh, scoped query)
    const previouslyBroadScope = (existingMemory.queryContext as any)?.isBroadScope === true;
    const isBroadScopeActive = isBroadScopeTriggered
        ? true
        : isNewQuery
            ? false   // New query without explicit broad scope request = exit broad scope
            : previouslyBroadScope; // Continuation turn: carry forward existing mode


    // ─────────────────────────────────────────────────────────────────
    // GAP-2 FIX: Align scope clearing with orchestrator.ts's textual pivot check.
    // isNewQuery (structural: iter<=1) is too broad — if the user retries with the EXACT same
    // query text, isNewQuery=true but orchestrator shows the old scope (text didn't change),
    // causing a split-brain: Orchestrator's iter=0 prompt says "you have vessel XXX1" but
    // update_memory2's iter=1 writes currentScope=[] — the LLM acted on XXX1 but the scope
    // is wiped before it gets confirmation. Scope clearing must be gated on CONTENT change.
    //
    // isGenuineTopicPivot = structural new query AND the query text actually changed.
    // This precisely mirrors orchestrator.ts: anchoredRawQuery !== query?.rawQuery.
    // ─────────────────────────────────────────────────────────────────
    const isGenuineTopicPivot = isNewQuery && !!existingRawQuery && rawQuery.trim() !== existingRawQuery.trim();
    if (isNewQuery) {
        console.log(`\x1b[35m[UpdateMemory2] 🔀 Scope Pivot Check: isNewQuery=${isNewQuery} | isGenuineTopicPivot=${isGenuineTopicPivot} | existingRawQuery="${existingRawQuery.substring(0, 50)}" | newRawQuery="${rawQuery.substring(0, 50)}"\x1b[0m`);
    }

    // ─────────────────────────────────────────────────────────────────
    // SCOPE BOUNDARY ISOLATION: deterministicScope extraction
    // ─────────────────────────────────────────────────────────────────
    // On a genuine topic pivot (isGenuineTopicPivot=true), sessionStateCommit.scope holds STALE
    // TRANSIENT entity-scope pointers from the PREVIOUS investigation.
    //
    // We exclude these INHERITED STALE pointers from deterministicScope AND delete them from
    // sessionStateCommit.scope entirely.
    //
    // GAP-1 FIX — why delete is mandatory:
    // Without deletion, the stale key survives in sessionStateCommit.scope and gets written to
    // LangGraph state. On iter=2+, isGenuineTopicPivot is false (only applies at iter=1),
    // so the filter doesn't run — and the stale vesselID is resurrected into deterministicScope,
    // re-contaminating currentScope mid-investigation.
    //
    // Stale-vs-fresh detection: A key is stale if BOTH the key AND value match the inherited
    // snapshot (Map<key, value>). If Phase 1 freshly resolved the same key type to a NEW hex ID
    // (e.g., vesselID for a different vessel), value mismatch excludes it from deletion.
    //
    // The knowledge is NOT lost — stale IDs remain in:
    //   - resolvedLabels (label → hex ID mapping for re-use when user mentions "XXX1" again)
    //   - secondaryScope (rolling 7-conv entity ledger in summarizer.ts)
    const deterministicScope = new Set<string>(organicallyDiscoveredIds);
    Object.entries(sessionStateCommit.scope).forEach(([k, v]) => {
        if (typeof v === 'string' && /^[0-9a-fA-F]{24}$/.test(v) && k !== 'organizationID') {
            // 🟢 SCOPE_NAVIGABLE_KEYS FILTER: Only promote IDs of fleet-navigable entity types
            // (vesselID, machineryID) into deterministicScope → currentScope.
            // crewcompetencysignalID, activityID, scheduleID, costCenterID etc. remain
            // in sessionStateCommit.scope as typed query params for the Orchestrator to read,
            // but MUST NOT enter currentScope where they could be misused as vesselIDs.
            if (!SCOPE_NAVIGABLE_KEYS.has(k)) {
                return; // Not a navigable type — skip, but preserve in scope for Orchestrator reads
            }
            const inheritedValue = inheritedEntityScopeSnapshot.get(k);
            const isStaleInherited = inheritedValue !== undefined && v === inheritedValue;
            if (isGenuineTopicPivot && !isBroadScopeTriggered && isStaleInherited) {
                console.log(`\x1b[35m[UpdateMemory2] 🧹 SCOPE BOUNDARY: Deleted stale "${k}" (${v.substring(0, 8)}…) from scope. Preserved in resolvedLabels + secondaryScope.\x1b[0m`);
                delete sessionStateCommit.scope[k]; // GAP-1 FIX: remove from scope to block resurrection at iter=2+
                return; // Exclude from deterministicScope
            }
            deterministicScope.add(v);
        }
    });

    const currentScopeArray = Array.from(deterministicScope);
    console.log(`\x1b[33m[UpdateMemory2] 🆔 GAP-30: Deterministic currentScope Sync: [${currentScopeArray.join(', ')}]${isBroadScopeActive ? ' (BROAD SCOPE MODE)' : ''}\x1b[0m`);


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
        // Internal Skylark diagnostic tools (mcp.query_active_filters, mcp.clear_filters) return
        // {capability, activeFilters} — no `items` array. Without this check Phase 2 treats them as
        // "0 items (empty)" and keeps pending intents alive, causing an infinite loop.
        const isInternalDiagnosticTool = count === 0 && !data?.isError && typeof data?.capability === 'string'
            && (data?.activeFilters != null || data?.clearedFilters != null);
        const status = data?.isError ? "FAILED"
            : count > 0 ? `${count} items returned`
            : isInternalDiagnosticTool
                ? (data?.clearedFilters
                    ? `filters cleared [${(data.clearedFilters as string[]).join(', ') || 'none'}]`
                    : `active filters: ${JSON.stringify(data.activeFilters)}`)
            : "0 items (empty)";
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
   - PROTECTED DOMAIN CONTEXT (HIGHEST PRIORITY): If the user input contains a "PROTECTED DOMAIN CONTEXT" block, ALL filters listed in it are MANDATORY. You MUST include every key-value pair from that block in your output activeFilters, without exception. These represent the established investigative subject of the conversation (e.g., a specific competency signal or training mode) that the user is continuing — NOT abandoning. You may add new filters to cover the new scope, but you are STRICTLY FORBIDDEN from dropping any protected filter.
   - FILTER INHERITANCE: If the user's latest message is a continuation or an entity pivot (e.g., 'and for MV Phoenix', 'now show me XXX2'), you SHOULD preserve relevant filters from the 'Previous activeFilters' list (like statusCode: committed, limit, dates).
   - CRITICAL (ANTI-POISONING): If the "Tools executed this turn" block shows a tool ran with specific parameters (e.g. statusCode="completed"), you MUST update activeFilters to match those parameters, even if the "Previous activeFilters" or the "rawQuery" suggest otherwise. The tool result is the ground truth of the current turn's scope.
   - ENTITY PRESERVATION: If the original 'rawQuery' contains a specific label (e.g. 'XXX1', 'DFGRE') that is NOT yet a canonical 24-char hex ID, you MUST preserve it in 'activeFilters' even if the user provides a different piece of info (like an Organization). Do NOT allow a context refinement to delete an unresolved label.
   - If the user specifies a limit or distribution scope, add them here. Do NOT hallucinate filters that are not clearly requested.
   - ANTI-HALLUCINATION (CRITICAL): You are STRICTLY FORBIDDEN from inferring or guessing attribute filter values (e.g. blockageReason, failureCode, triggerOrigin, repairType) that do NOT appear verbatim in the tool's [appliedFilters] block in the "Tools executed this turn" section. Only extract a filter if it is present as an explicit parameter in the tool call result. If no such parameter appears, the filter MUST NOT appear in activeFilters.
3. lastTurnInsight: You MUST summarize in EXACTLY ONE sentence ONLY. Your sentence MUST explicitly state BOTH what the user asked for (based on the rawQuery) AND what data was actually retrieved or resolved altogether this turn. Max 300 chars.
   - TICKET ACTIVATION: If an ambiguity ticket was activated this turn (the user picked a candidate with an ordinal like "the second one"), your sentence MUST identify which candidate was chosen. E.g.: "User picked the 2nd CCCCCCC (machinery) and retrieved 5 maintenance records." Do NOT write generic phrases like "retrieval completed" when a specific candidate selection occurred — the specific candidate name is the key fact.
4. rawQuery — [Clarification] prefix cleanup (CRITICAL):
   - The rawQuery you output is used as the summary of the current conversation topic in future turns.
   - If the rawQuery you received starts with "[Clarification]" (e.g. "[Clarification] For organization X, identify which of the three Machinery records..."), this means the session was mid-disambiguation.
   - If a retrieval tool ran this turn (a tool OTHER than mcp.resolve_entities, mcp.clear_filters, or mcp.query_active_filters), the disambiguation is OVER — the user made their pick and the system acted on it.
   - In that case, you MUST rewrite the rawQuery to be a CLEAN, concrete statement of the resolved intent WITHOUT the "[Clarification]" prefix.
   - Example: "[Clarification] For org myorg, identify which of the 3 Machinery records..." → "For org myorg, vessel XXX1, show maintenance details for Machinery ccccccccccccc (ID: 68385e580aa5d05cc5c872d9)"
   - If NO retrieval tool ran (only resolve_entities or internal tools), keep the rawQuery as-is.`;

    // 🟢 GAP-18 FIX: PROTECTED DOMAIN CONTEXT injection
    // When isNewQuery=true (fresh HTTP request) AND the Orchestrator did NOT detect a domain pivot,
    // the user is continuing in the SAME investigative subject (e.g., expanding "XXX1 competency"
    // to "org-wide competency"). In that case, the previous activeFilters represent the established
    // domain context — they must survive the new rawQuery's scope expansion.
    //
    // Without this, Phase 2 sees rawQuery="Organization-wide investigation..." (no mention of Tanker
    // Management) + tools that show only fleet.query_overview, and legally strips signalName/mode.
    // The PROTECTED block makes those filters mandatory, not just advisory.
    const prevFilters = previousQueryContext.activeFilters || {};
    const hasPrevFilters = Object.keys(prevFilters).length > 0;
    const isTopicContinuation = isNewQuery && !state.isDomainPivot && hasPrevFilters;
    let protectedDomainBlock = "";
    if (isTopicContinuation) {
        // Strip entity-scope keys (vesselID, machineryID) — those are legitimately changing with the new scope.
        // Preserve domain/attribute filters (signalName, signalID, mode, statusCode, etc.).
        const entityScopeKeySet = new Set(['vesselID', 'machineryID', 'scheduleID', 'activityID', 'costCenterID', 'searchTerm', 'entityLabel', 'resolvedEntityType', 'vesselLabel']);
        const domainFilters = Object.fromEntries(
            Object.entries(prevFilters).filter(([k]) => !entityScopeKeySet.has(k))
        );
        if (Object.keys(domainFilters).length > 0) {
            protectedDomainBlock = `\n\nPROTECTED DOMAIN CONTEXT (MANDATORY — do NOT drop any of these):\n${JSON.stringify(domainFilters, null, 2)}\nRationale: The Orchestrator determined this question is a continuation of the same investigative topic (not a domain pivot). These filters represent what the user is still asking about — only the scope has widened.`;
            console.log(`\x1b[32m[UpdateMemory2] 🛡️ GAP-18: Injecting PROTECTED DOMAIN CONTEXT (${Object.keys(domainFilters).length} filters): ${JSON.stringify(domainFilters)}\x1b[0m`);
        }
    }

    const userContent = `rawQuery: "${rawQuery}"

Tools executed this turn:
${toolSummaryLines.join('\n') || "None"}

Previous activeFilters (Inherit these if applicable):
${JSON.stringify(previousQueryContext.activeFilters || {}, null, 2)}

Previous pending intents:
${(previousQueryContext.pendingIntents || []).length > 0 ? previousQueryContext.pendingIntents.map((i: string) => `- ${i}`).join('\n') : "None (first turn)"}${hitlContextBlock}${protectedDomainBlock}`;

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
            isBroadScope: isBroadScopeActive, // 🌐 Persist broad scope flag across iterations
            conversationJournal: updatedJournal, // 🟢 JOURNAL: Code-maintained turn-by-turn log
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
                queryContext: {
                    ...previousQueryContext,
                    rawQuery,
                    isBroadScope: isBroadScopeActive, // 🌐 Preserve broad scope flag even on LLM failure
                    conversationJournal: updatedJournal, // 🟢 JOURNAL: preserve code-built entries even when LLM fails
                },
            },
            isHITLContinuation: false,
        };
    }
}
