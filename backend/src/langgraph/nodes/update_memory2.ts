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
 * Tier 2 (queryContext)   → reset on new user question, updated on FEED_BACK_TO_ME turns.
 * HITL continuation       → detected via isHITLContinuation flag to skip Tier 2 reset.
 */

const queryContextSchema = z.object({
    pendingIntents: z.array(z.string()).max(5).describe(
        "What parts of the user's original question have NOT yet been answered. Max 5 items. Empty array if everything is answered."
    ),
    activeFilters: z.array(z.object({
        key: z.string(),
        value: z.string()
    })).describe(
        "List of filters currently in use (e.g. statusCode, startDate, limit). Only include filters that are actively scoping results."
    ),
    lastTurnInsight: z.string().max(150).describe(
        "ONE sentence (max 150 chars) describing what just happened. Focus on IDs found or intents completed."
    ),
});

export async function nodeUpdateMemory2(state: SkylarkState): Promise<Partial<SkylarkState>> {
    const ts = () => `[${new Date().toISOString().substring(11, 19)}]`;
    console.log(`\x1b[33m${ts()} [LangGraph] 🧠 UpdateMemory2 Node invoked (iter=${state.iterationCount})\x1b[0m`);

    // ─────────────────────────────────────────────────────────────────
    // PHASE 1: Code-driven — deterministic extraction, zero LLM cost
    // ─────────────────────────────────────────────────────────────────

    const existingMemory = state.workingMemory || {
        sessionContext: { scope: {}, resolvedEntities: {} },
        queryContext: { rawQuery: "", pendingIntents: [], activeFilters: {}, lastTurnInsight: "" },
    };

    // Clone Tier 1 for mutation
    const sessionContext = {
        scope: { ...existingMemory.sessionContext?.scope },
        resolvedEntities: { ...existingMemory.sessionContext?.resolvedEntities },
    };

    // Flatten latest tool results
    const rawResults = state.toolResults || [];
    const history = Array.isArray(rawResults) ? rawResults : [rawResults];
    const currentTurns = history.slice(state.startTurnIndex || 0);

    const latestTurn = currentTurns[currentTurns.length - 1] || {};

    // Extract scope + resolved entities from ALL current turns
    for (const turn of currentTurns) {
        for (const [, res] of Object.entries(turn || {})) {
            let data: any = res;
            if (data?.content?.[0]?.text) {
                try {
                    const text = data.content[0].text;
                    if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
                        data = JSON.parse(text);
                    }
                } catch { /* ignore */ }
            }

            // Extract org scope from any tool result
            if (data?.organizationID && !sessionContext.scope.organizationID) {
                sessionContext.scope.organizationID = data.organizationID;
                console.log(`\x1b[33m[UpdateMemory2] 🏢 Captured orgID: ${data.organizationID}\x1b[0m`);
            }
            if (data?.appliedFilters?.organizationShortName && !sessionContext.scope.organizationShortName) {
                sessionContext.scope.organizationShortName = data.appliedFilters.organizationShortName;
            }

            // Extract resolved entities from mcp.resolve_entities results
            if (data?.capability === "mcp.resolve_entities" && Array.isArray(data?.items)) {
                const entityType = data.appliedFilters?.entityType || "unknown";
                const searchTerm = data.appliedFilters?.searchTerm || "unknown";
                for (const item of data.items) {
                    if (item.id && item.id.length === 24) { // Must be a valid 24-char hex ID
                        const ledgerKey = `${entityType}:${searchTerm}`;
                        // 🟢 Deduplication Guard: Only write the FIRST resolved ID for a given key.
                        // This prevents the second match (a container/parent doc) from overwriting
                        // the correct target ID from the first match.
                        if (!sessionContext.resolvedEntities[ledgerKey]) {
                            sessionContext.resolvedEntities[ledgerKey] = {
                                id: item.id,
                                label: item.label || searchTerm,
                                entityType,
                            };
                            console.log(`\x1b[32m[UpdateMemory2] \u2705 Entity Ledger: "${ledgerKey}" → "${item.id}"\x1b[0m`);
                        } else {
                            console.log(`\x1b[33m[UpdateMemory2] ⚠️ Entity Ledger: "${ledgerKey}" already resolved to "${sessionContext.resolvedEntities[ledgerKey].id}" — skipping duplicate ID "${item.id}"\x1b[0m`);
                        }
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 1b: Tier 2 reset logic
    // ─────────────────────────────────────────────────────────────────
    // A "new query" is one that starts a fresh thread from turn index 0 (not a HITL continuation). 
    // We use startTurnIndex (set by the route before the run begins) rather than iterationCount,
    // because iterationCount is already 1+ by the time this node runs (Orchestrator incremented it).
    const isNewQuery = (state.startTurnIndex === 0) && !state.isHITLContinuation;

    // Find latest human message for rawQuery
    const allMessages = state.messages || [];
    const lastHumanMsg = [...allMessages].reverse().find((m: any) => {
        const type = m._getType?.() || m.role;
        return type === 'human';
    });
    const rawQuery = (lastHumanMsg as any)?.content || existingMemory.queryContext?.rawQuery || "";

    // If new query, start fresh Tier 2. If continuation, carry forward.
    let previousQueryContext = isNewQuery
        ? { rawQuery, pendingIntents: [], activeFilters: {}, lastTurnInsight: "" }
        : { ...existingMemory.queryContext, rawQuery: existingMemory.queryContext?.rawQuery || rawQuery };

    if (isNewQuery) {
        console.log(`\x1b[33m[UpdateMemory2] 🔄 New query detected — Tier 2 reset. RawQuery: "${rawQuery.substring(0, 80)}"\x1b[0m`);
    }

    // ─────────────────────────────────────────────────────────────────
    // PHASE 2: LLM-driven — structured queryContext update
    // ─────────────────────────────────────────────────────────────────
    const provider = process.env.MASTRA_SUMMARIZER_PROVIDER || 'openai';
    const modelName = process.env.MASTRA_SUMMARIZER_MODEL || 'gpt-5.4-mini';

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

    const systemPrompt = `You are the Skylark Agent Memory Controller. Your job is to produce a structured JSON update for the agent's query context.

Given:
- The user's original question (rawQuery)
- Tools executed this turn and their outcomes
- Previous pending intents (what was still unanswered before this turn)

Produce ONLY the structured JSON output. No prose. No explanation.

Rules:
1. pendingIntents: Remove any intent that was just answered by a tool. Keep intents that still need data. Max 5 items.
2. activeFilters: Extract only the filters that are actively scoping results in this query (e.g. statusCode, startDate, limit). 
3. lastTurnInsight: One sentence only. Focus on what was resolved or found. If entities were resolved, mention the ID. Max 150 chars.`;

    const userContent = `rawQuery: "${rawQuery}"

Tools executed this turn:
${toolSummaryLines.join('\n') || "None"}

Previous pending intents:
${previousQueryContext.pendingIntents.length > 0 ? previousQueryContext.pendingIntents.map(i => `- ${i}`).join('\n') : "None (first turn)"}`;

    try {
        const model = baseModel.withStructuredOutput(queryContextSchema);
        const response = await model.invoke([
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
        ]);

        const { logTokenSavings } = await import("../utils/logger.js");
        logTokenSavings("UpdateMemory2", response);

        const activeFiltersRecord: Record<string, string> = {};
        if (Array.isArray(response.activeFilters)) {
            for (const filter of response.activeFilters) {
                if (filter.key && filter.value) {
                    activeFiltersRecord[filter.key] = filter.value;
                }
            }
        }

        const updatedQueryContext = {
            rawQuery: previousQueryContext.rawQuery,
            pendingIntents: response.pendingIntents || [],
            activeFilters: activeFiltersRecord,
            lastTurnInsight: response.lastTurnInsight || "",
        };

        console.log(`\x1b[32m${ts()} [UpdateMemory2] ✅ Phase 2 Complete. Intents: [${updatedQueryContext.pendingIntents.join(', ') || 'none'}] | Insight: "${updatedQueryContext.lastTurnInsight}"\x1b[0m`);

        return {
            workingMemory: {
                sessionContext,
                queryContext: updatedQueryContext,
            },
            isHITLContinuation: false, // Reset after processing
        };
    } catch (e: any) {
        const { logLLMError } = await import("../utils/logger.js");
        logLLMError("UpdateMemory2", e);
        // Graceful degradation: keep existing memory, don't crash the graph
        return {
            workingMemory: {
                sessionContext,
                queryContext: previousQueryContext,
            },
            isHITLContinuation: false,
        };
    }
}
