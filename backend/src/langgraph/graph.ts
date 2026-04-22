import { StateGraph } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import type { SkylarkState } from "./state.js";
import { nodeOrchestrator } from "./nodes/orchestrator.js";
import { nodeExecuteTools } from "./nodes/execute_tools.js";
import { nodeUpdateMemory2 } from "./nodes/update_memory2.js";
import { nodeSummarizer } from "./nodes/summarizer.js";
import { nodeResolveLabels } from "./nodes/resolve_labels.js";

import { nodeError } from "./nodes/error.js";

/**
 * 1. Initialize State Graph with custom channels (reducers)
 */
const workflow = new StateGraph<SkylarkState>({
  channels: {
    messages: {
      // 🟢 GAP-9 FIX: Increased from 6 to 10 (5 full turns).
      // The 6-message window was too small for multi-HITL chains: the original human message
      // could slide off and break the rawQuery anchor fallback in update_memory2.ts.
      reducer: (x: any[], y: any[]) => x.concat(y).slice(-10),
      default: () => [],
    },
    workingMemory: {
        // Deep-merge: incoming y wins for scalar fields
        reducer: (x: any, y: any) => {
            if (!y) return x;
            return {
                sessionContext: {
                    ...(x?.sessionContext || {}),
                    ...(y?.sessionContext || {}),
                    scope: { ...(x?.sessionContext?.scope || {}), ...(y?.sessionContext?.scope || {}) },
                },
                queryContext: y?.queryContext ?? x?.queryContext,
            };
        },
        default: () => ({
            sessionContext: { scope: {} },
            queryContext: { rawQuery: "", pendingIntents: [], activeFilters: {}, lastTurnInsight: "" },
        }),
    },
    isHITLContinuation: {
        reducer: (x: boolean, y: boolean) => y ?? x,
        default: () => false,
    },
    toolCalls: { default: () => [] },
    toolResults: { 
        reducer: (x: any[], y: any) => {
          console.log(`[LangGraph Reducer] toolResults input:`, { x_type: typeof x, x_isArray: Array.isArray(x), y_present: !!y });
          const current = Array.isArray(x) ? x : [];
          if (!y) return current;
          const appended = [...current, y];
          // 🟢 GAP-15 FIX: Cap toolResults at 30 turns to prevent the MongoDB checkpoint document
          // from hitting the 16MB BSON limit in long sessions. The existing 15MB pre-validation
          // guard in execute_tools.ts protects PAYLOADS, but accumulated state can also grow
          // unboundedly. Pruning old turns here keeps the checkpoint lean.
          if (appended.length > 30) {
            const pruned = appended.slice(appended.length - 30);
            console.warn(`[LangGraph Reducer] ⚠️ toolResults pruned from ${appended.length} to 30 turns to prevent BSON overflow.`);
            return pruned;
          }
          return appended;
        },
        default: () => [] 
    },
    feedBackVerdict: { default: () => "SUMMARIZE" },
    iterationCount: { 
        reducer: (x: number, y: number) => y ?? x,
        default: () => 0 
    },
    startTurnIndex: {
        reducer: (x: number, y: number) => y ?? x,
        default: () => 0
    },
    error: { default: () => undefined },
    // 🟢 GAP-16 FIX: Added explicit reducer for hitl_required.
    // Without a reducer, LangGraph uses the default "last-write-wins" strategy which is
    // non-deterministic in parallel branches (update_memory + summarizer). If one branch
    // writes true and the other writes undefined, the winner is random.
    // With this reducer, an explicit true always wins over undefined, and the most recent
    // explicit value (true or false) always takes priority.
    hitl_required: {
        reducer: (x: boolean | undefined, y: boolean | undefined) => y !== undefined ? y : x,
        default: () => undefined as any,
    },
    // 🌐 BROAD SCOPE FIX: Must be declared as a channel or orchestrator writes are silently dropped.
    // (x, y) => y ?? x: the most recent explicit value (true or false) always wins.
    // 🟢 Intent-First Persistence: Register reformulatedQuery as a state channel.
    // Without this, the Orchestrator's reformulatedQuery is dropped between turns.
    reformulatedQuery: {
        reducer: (x: string | undefined, y: string | undefined) => y ?? x,
        default: () => undefined as any,
    },
    isBroadScopeRequest: {
        reducer: (x: boolean | undefined, y: boolean | undefined) => y !== undefined ? y : x,
        default: () => undefined as any,
    },
    // 🟢 SEQUENTIAL EXECUTION FLAG: Must be declared as a channel or orchestrator writes are silently dropped.
    // Reducer: most recent explicit value wins (true/false). Default true (parallel).
    // execute_tools branches on this: false → sequential for...of; true → Promise.all().
    parallelizeTools: {
        reducer: (x: boolean | undefined, y: boolean | undefined) => y !== undefined ? y : x,
        default: () => true,
    },
    // 🟢 DOMAIN PIVOT FLAG: Emitted by Orchestrator when the new query switches operational domain
    // (e.g., maintenance → competency). Consumed by UpdateMemory2 to clear stale domain-specific
    // activeFilters. Uses LastValue reducer — most recent Orchestrator decision always wins.
    isDomainPivot: {
        reducer: (x: boolean | undefined, y: boolean | undefined) => y !== undefined ? y : x,
        default: () => false,
    },

    // 12. Deterministic Label Resolution Channel
    // Written by orchestrator, read by graph conditional edge and resolve_labels node.
    // resolve_labels always clears this to [] after running (success or failure).
    unclassifiedLabels: {
        reducer: (x: any, y: any) => y !== undefined ? y : x,
        default: () => [] as any,
    },

    // 13. Ambiguity Ticket Activation Signals (Phase 22)
    // Written by orchestrator each turn. Consumed by update_memory2 (ambiguitiesResolved)
    // and summarizer (activatedTicketLabel/Confidence/CandidateIndex).
    // Without these channels, LangGraph silently drops all four fields between nodes.
    ambiguitiesResolved: {
        // Reset to [] each turn so stale signals from a prior turn don't bleed into the next.
        reducer: (x: string[] | undefined, y: string[] | undefined) => y !== undefined ? y : x,
        default: () => [] as string[],
    },
    activatedTicketLabel: {
        reducer: (x: string | null | undefined, y: string | null | undefined) => y !== undefined ? y : x,
        default: () => null as any,
    },
    activatedTicketConfidence: {
        reducer: (x: number | undefined, y: number | undefined) => y !== undefined ? y : x,
        default: () => 0,
    },
    activatedCandidateIndex: {
        reducer: (x: number | null | undefined, y: number | null | undefined) => y !== undefined ? y : x,
        default: () => null as any,
    },

  } as any 
});

// 2. Add Nodes
workflow.addNode("orchestrator", nodeOrchestrator as any);
workflow.addNode("resolve_labels", nodeResolveLabels as any);
workflow.addNode("execute_tools", nodeExecuteTools as any);
workflow.addNode("update_memory", nodeUpdateMemory2 as any);
workflow.addNode("summarizer", nodeSummarizer as any);
workflow.addNode("errorNode", nodeError as any);

// 3. Set Edges
workflow.addEdge("__start__" as any, "orchestrator" as any);

// Conditional Edge from Orchestrator
workflow.addConditionalEdges(
  "orchestrator" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";
      if (state.hitl_required) return "__end__"; 

      // ─────────────────────────────────────────────────────────────────
      // RESOLVE_LABELS INTERCEPT: If the orchestrator emitted unclassified labels,
      // route to resolve_labels FIRST (before execute_tools). resolve_labels resolves
      // all labels in parallel, injects IDs into scope and toolResults, clears
      // unclassifiedLabels:[], then always passes to execute_tools.
      // This fires even when toolCalls is non-empty — we want IDs available before
      // execute_tools runs the retrieval plan.
      // ─────────────────────────────────────────────────────────────────
      if ((state.unclassifiedLabels || []).length > 0) {
          return "resolve_labels";
      }

      // ─────────────────────────────────────────────────────────────────
      // GAP-LOOP-1 FIX: toolCalls check MUST come BEFORE feedBackVerdict check.
      // ─────────────────────────────────────────────────────────────────
      if (state.toolCalls && state.toolCalls.length > 0) {
          return "execute_tools";
      }

      // Only reach here when there are NO tools. Now honor the verdict.
      if (state.feedBackVerdict === "FEED_BACK_TO_ME") {
          return "update_memory";
      }

      return "summarizer";
  }) as any,
  {
      resolve_labels: "resolve_labels" as any,
      execute_tools: "execute_tools" as any,
      update_memory: "update_memory" as any,
      summarizer: "summarizer" as any,
      errorNode: "errorNode" as any,
      __end__: "__end__" as any
  } as any
);

// resolve_labels is a deterministic intercept — it resolves labels, injects results
// into toolResults, forces feedBackVerdict=FEED_BACK_TO_ME, then always passes to
// update_memory2 so resolved IDs are written to scope.resolvedLabels / ambiguousMatches.
// update_memory2's conditional edge then routes back to orchestrator (FEED_BACK_TO_ME path),
// where the LLM sees the RESOLVED ENTITIES / AMBIGUITY DETECTED blocks and acts on them.
workflow.addEdge("resolve_labels" as any, "update_memory" as any);

// Conditional Edge from Execute Tools
// Conditional Edge from Execute Tools
workflow.addConditionalEdges(
  "execute_tools" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";

      const turns = state.toolResults || [];
      const results = Object.values(turns[turns.length - 1] || {});
      const standsAmbiguous = results.some((r: any) => r && r.__ambiguity_stop === true);

      if (standsAmbiguous) {
          return "__end__"; // 🟢 Direct end for ambiguity breakout flawlessly!
      }

      // 🟢 Parallelization Optimization: 
      // If we are summarizing, run BOTH update_memory and summarizer in parallel branches concurrently.
      // Increase limit to 8 to support deep multi-step discovery loops flawlessly!
      const isSummarizing = state.feedBackVerdict === "SUMMARIZE" || (state.iterationCount || 0) >= 8;
      
      const loopColor = (state.iterationCount || 0) >= 7 ? '\x1b[31m' : '\x1b[34m';
      console.log(`${loopColor}[LangGraph Loop] Iteration: ${state.iterationCount || 0}/8 | Verdict: ${state.feedBackVerdict} | Summarizing: ${isSummarizing}\x1b[0m`);

      if (isSummarizing) {
          return ["update_memory", "summarizer"];
      }

      return "update_memory";
  }) as any,
  {
      update_memory: "update_memory" as any,
      summarizer: "summarizer" as any,
      errorNode: "errorNode" as any,
      __end__: "__end__" as any, // 🟢 Allowed breakout!
  } as any
);

// 4. Conditional Edge for opinion decision loops
workflow.addConditionalEdges(
  "update_memory" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";

      const turns = state.toolResults || [];
      const results = Object.values(turns[turns.length - 1] || {});
      const standsAmbiguous = results.some((r: any) => r && r.__ambiguity_stop === true);

      // 🟢 Parallelization Guard:
      // If we were already summarizing (parallel branches), just END this node's branch to prevent double triggers on summarizer.
      const wasSummarizing = state.feedBackVerdict === "SUMMARIZE" || standsAmbiguous || (state.iterationCount || 0) >= 8;
      if (wasSummarizing) {
          return "__end__"; 
      }

      return state.feedBackVerdict === "FEED_BACK_TO_ME" ? "orchestrator" : "summarizer";
  }) as any,
  {
      orchestrator: "orchestrator" as any,
      summarizer: "summarizer" as any,
      errorNode: "errorNode" as any,
      __end__: "__end__" as any,
  } as any
);

workflow.addEdge("summarizer" as any, "__end__" as any);
workflow.addEdge("errorNode" as any, "__end__" as any);

// 5. Compile with MongoDBSaver Checkpointer for durable persistence
const uri = process.env.SKYLARK_MONGODB_URI || "mongodb://localhost:27017/SkylarkDB";
const dbName = uri.split('/').pop()?.split('?')[0] || "SkylarkDB";

const client = new MongoClient(uri);
const memorySaver = new MongoDBSaver({ client: client as any, dbName });

export { client, dbName };
export const skylarkGraph = workflow.compile({ checkpointer: memorySaver as any });
