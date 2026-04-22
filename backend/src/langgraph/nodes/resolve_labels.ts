import type { SkylarkState } from "../state.js";
import { resolveEntities } from "../../mcp/capabilities/lookup_logic.js";

/**
 * nodeResolveLabels — Deterministic Label Resolution Node
 *
 * Fires automatically when the orchestrator emits one or more unclassifiedLabels.
 * Runs all label × type resolution calls in parallel using resolveEntities() directly.
 *
 * Contract:
 *  - Always clears unclassifiedLabels: [] regardless of outcome (found or not found).
 *  - Injects found entity IDs into workingMemory.queryContext.currentScope.
 *  - Writes a resolution summary into toolResults so the LLM sees what happened.
 *  - If a label is not found, the LLM will naturally ask the user for clarification.
 *  - No retry loops, no persistent failed-label state needed.
 */
export async function nodeResolveLabels(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const ts = () => `[${new Date().toISOString().substring(11, 19)}]`;
    const labels = state.unclassifiedLabels || [];
    console.log(`\x1b[36m${ts()} [resolve_labels] ▶ Node invoked with ${labels.length} label(s): [${labels.map((l: any) => l.label).join(', ')}]\x1b[0m`);
    console.log(`\x1b[36m${ts()} [resolve_labels]   feedBackVerdict=${state.feedBackVerdict} | toolCalls=${state.toolCalls?.length ?? 0}\x1b[0m`);

    // Minimal filter: skip empty or sentence-length strings (not entity names)
    const toResolve = labels.filter(l => {
        const lbl = (l.label || '').trim();
        return lbl.length > 0 && lbl.length <= 50;
    });

    if (toResolve.length === 0) {
        console.log(`\x1b[36m[resolve_labels] No valid labels to resolve — passthrough. Verdict=${state.feedBackVerdict}\x1b[0m`);
        // Inject a minimal synthetic result so update_memory2 Phase 2 has a signal, even on passthrough.
        return {
            unclassifiedLabels: [],
            toolResults: {
                'resolve_labels::passthrough': {
                    content: [{ text: JSON.stringify({
                        capability: 'mcp.resolve_entities',
                        appliedFilters: {},
                        items: [],
                        note: 'resolve_labels: No valid entity labels to resolve (all filtered out or empty).',
                    }) }]
                }
            } as any,
        };
    }

    const scope = state.workingMemory?.sessionContext?.scope || {};
    const orgID = scope.organizationID;

    if (!orgID) {
        // Org unknown — can't resolve. Clear labels and let ORG CONTEXT GATE handle it.
        console.warn(`\x1b[33m[resolve_labels] ⚠️ No organizationID in scope — skipping resolution for labels: [${toResolve.map(l => l.label).join(', ')}]\x1b[0m`);
        // Inject a synthetic no-org result so update_memory2 Phase 2 has a proper signal
        // rather than an empty latestTurn. The ORG CONTEXT GATE in the orchestrator handles recovery.
        // Keep feedBackVerdict: FEED_BACK_TO_ME (orchestrator's write stays) — update_memory
        // will route back to orchestrator where the ORG GATE asks for the org name.
        return {
            unclassifiedLabels: [],
            feedBackVerdict: 'FEED_BACK_TO_ME' as any,
            toolResults: {
                'resolve_labels::no-org': {
                    content: [{ text: JSON.stringify({
                        capability: 'mcp.resolve_entities',
                        appliedFilters: { searchTerm: toResolve.map(l => l.label).join(', ') },
                        items: [],
                        isError: false,
                        note: 'resolve_labels: Skipped — organizationID not yet available in scope. ORG CONTEXT GATE will request it.',
                    }) }]
                }
            } as any,
        };
    }

    console.log(`\x1b[36m[resolve_labels] 🔎 Resolving ${toResolve.length} label(s) for org ${orgID}: [${toResolve.map(l => l.label).join(', ')}]\x1b[0m`);

    // Build all resolution tasks: label × type pairs
    type ResolutionTask = {
        label: string;
        type: string;
        confidence: number;
    };

    const tasks: ResolutionTask[] = toResolve.flatMap(item =>
        (item.likelyEntityTypes || []).map(t => ({
            label: item.label,
            type: typeof t === 'string' ? t : (t as any).type,
            confidence: typeof t === 'string' ? 1.0 : ((t as any).confidence ?? 1.0)
        }))
    );

    if (tasks.length === 0) {
        console.log(`\x1b[36m[resolve_labels] No entity types provided for labels — clearing.\x1b[0m`);
        // Inject a minimal synthetic result so update_memory2 Phase 2 has a signal.
        return {
            unclassifiedLabels: [],
            toolResults: {
                'resolve_labels::no-types': {
                    content: [{ text: JSON.stringify({
                        capability: 'mcp.resolve_entities',
                        appliedFilters: {},
                        items: [],
                        note: 'resolve_labels: No likelyEntityTypes provided for any label — nothing to resolve.',
                    }) }]
                }
            } as any,
        };
    }

    // Run all in parallel
    const settled = await Promise.allSettled(
        tasks.map(async task => {
            try {
                const res = await resolveEntities({
                    entityType: task.type,
                    searchTerm: task.label,
                    organizationID: orgID,
                }, '');
                const parsed = JSON.parse(res?.content?.[0]?.text || '{}');
                const items: any[] = parsed?.items || [];
                return { ...task, items, error: null };
            } catch (err: any) {
                return { ...task, items: [], error: err?.message || 'Unknown error' };
            }
        })
    );

    // Collect results, group by label
    const byLabel: Record<string, { type: string; confidence: number; items: any[]; error: string | null }[]> = {};
    settled.forEach(result => {
        if (result.status === 'fulfilled') {
            const { label, type, confidence, items, error } = result.value;
            if (!byLabel[label]) byLabel[label] = [];
            byLabel[label].push({ type, confidence, items, error });
        }
    });

    // Build resolution summary string for LLM context, and synthetic tool results for update_memory2.
    // KEY PREFIX: "resolve_labels::label::type" — deliberately NOT "mcp.resolve_entities-auto-*".
    // Using a distinct prefix prevents:
    //   (a) STALL GUARD from treating this as a discovery turn (prevTurnWasDiscovery check)
    //   (b) hasRetrievalInCurrentRequest from counting it as a retrieval tool
    // update_memory2 reads the content payload (capability field) — not the key — so it still
    // processes these results correctly regardless of key name.
    let summaryLines: string[] = ['[resolve_labels] Entity resolution results:'];
    const newIDs: string[] = [];
    const fakeToolResults: Record<string, any> = {};


    for (const [label, results] of Object.entries(byLabel)) {
        summaryLines.push(`\nLabel "${label}":`);
        for (const r of results) {
            // 1. Build the text summary for the terminal log
            if (r.error) {
                summaryLines.push(`  → ${r.type} (conf ${r.confidence.toFixed(2)}): ⚠️ Error — ${r.error}`);
            } else if (r.items.length === 0) {
                summaryLines.push(`  → ${r.type} (conf ${r.confidence.toFixed(2)}): ❌ No match found`);
            } else if (r.items.length === 1) {
                const item = r.items[0];
                const id = item._id || item.id || '';
                const name = item.name || item.displayName || item.title || item.activityName || item.machineryName || label;
                summaryLines.push(`  → ${r.type} (conf ${r.confidence.toFixed(2)}): ✅ FOUND — ID: ${id}, Name: "${name}"`);
                if (id) newIDs.push(id);
            } else {
                summaryLines.push(`  → ${r.type} (conf ${r.confidence.toFixed(2)}): ⚠️ Ambiguous — ${r.items.length} matches found`);
                r.items.slice(0, 3).forEach((item: any, idx: number) => {
                    const id = item._id || item.id || '';
                    const name = item.name || item.displayName || item.title || item.activityName || item.machineryName || `Match ${idx + 1}`;
                    summaryLines.push(`      ${idx + 1}. ID: ${id}, Name: "${name}"`);
                });
            }

            // 2. Inject a synthetic tool result that update_memory2 processes natively.
            // Key format: resolve_labels::{label}::{type} — unique per label×type pair.
            // update_memory2 reads the content[0].text payload (capability field), not the key,
            // so it handles this identically to a real mcp.resolve_entities call.
            const fakeToolId = `resolve_labels::${label}::${r.type}`;
            fakeToolResults[fakeToolId] = {
                content: [{
                    text: JSON.stringify({
                        capability: "mcp.resolve_entities",
                        appliedFilters: { searchTerm: label, entityType: r.type },
                        items: r.items,
                        isError: !!r.error,
                        error: r.error
                    })
                }]
            };
        }
    }

    const summary = summaryLines.join('\n');
    console.log(`\x1b[36m[resolve_labels] Resolution complete. Found ${newIDs.length} new ID(s): [${newIDs.join(', ')}]\x1b[0m`);
    console.log(summary);

    // 🔴 ZERO-HIT HITL GATE
    // If ALL entity types for a label resolved to items:[] (total miss), inject an explicit
    // ZERO_HIT_HITL synthetic result. Without this, the orchestrator sees only silent empty
    // results and the pendingIntents mandate (Rule 28) overrides Rule 11 (Hard-Stop HITL),
    // causing the LLM to hallucinate a tool call rather than ask for clarification.
    // This injection only fires on the already-broken all-empty path — it is never reached
    // when any type returns ≥1 match.
    for (const [label, results] of Object.entries(byLabel)) {
        const allEmpty = results.every(r => !r.error && r.items.length === 0);
        if (allEmpty && results.length > 0) {
            const zeroHitKey = `resolve_labels::${label}::ZERO_HIT_HITL`;
            fakeToolResults[zeroHitKey] = {
                content: [{
                    text: JSON.stringify({
                        capability: "mcp.resolve_entities",
                        appliedFilters: { searchTerm: label },
                        items: [],
                        zeroHitHITL: true,
                        message: `ZERO_HIT_HITL: Label "${label}" could not be resolved to any entity type. ` +
                                 `Attempted: [${results.map(r => r.type).join(', ')}]. ` +
                                 `You MUST trigger Rule 11 Hard-Stop HITL — ask the user what "${label}" refers to ` +
                                 `(e.g. is it an Activity, Machinery, Component, or something else?). ` +
                                 `Do NOT proceed with any retrieval tool call for this label.`,
                    })
                }]
            };
            console.log(`\x1b[33m[resolve_labels] ⚠️ ZERO_HIT_HITL injected for label "${label}" — all ${results.length} type(s) returned 0 results\x1b[0m`);
        }
    }

    // Merge found IDs into currentScope (same shape that update_memory2 uses)
    const existingScope: string[] = state.workingMemory?.queryContext?.currentScope || [];
    const mergedScope = [...new Set([...existingScope, ...newIDs])];

    console.log(`\x1b[36m[resolve_labels] ✅ Done. Resolved IDs: [${newIDs.join(', ')}] | Clearing unclassifiedLabels | Next: update_memory2 → orchestrator\x1b[0m`);

    const updates: Partial<SkylarkState> = {
        // Always clear unclassifiedLabels — resolution is done regardless of outcome
        unclassifiedLabels: [],

        // Force FEED_BACK_TO_ME so update_memory2 routes back to orchestrator.
        // Without this, if the orchestrator said SUMMARIZE, update_memory2 routes to __end__
        // and the orchestrator never sees the resolved label context.
        feedBackVerdict: 'FEED_BACK_TO_ME' as any,

        // Inject resolution results as synthetic JSON tool results
        toolResults: fakeToolResults as any,

        // Merge resolved IDs into currentScope
        workingMemory: {
            ...state.workingMemory,
            sessionContext: state.workingMemory?.sessionContext || { scope: {} },
            queryContext: {
                ...(state.workingMemory?.queryContext || { rawQuery: '', pendingIntents: [], activeFilters: {}, lastTurnInsight: '' }),
                currentScope: mergedScope,
            },
        },
    };

    return updates;
}
