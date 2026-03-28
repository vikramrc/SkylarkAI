import { BaseMessage } from "@langchain/core/messages";

/**
 * SkylarkState defines the unified memory and execution state for the LangGraph pipeline.
 */
export interface SkylarkState {
  // 1. Thread Message History (Back-fed Automatically by Checkpointer)
  messages: BaseMessage[];

  // 2. Two-Tier Agent Memory
  workingMemory: {
    // TIER 1: Session-scoped. Persists across ALL queries in a conversation. Code-written. Never reset.
    sessionContext: {
      scope: {
        organizationID?: string;
        organizationShortName?: string;
        organizationName?: string;
      };
      // Key = "entityType:humanLabel" (e.g. "cost_center:TESTCOSTCENTER1")
      // Value = resolved DB ID and metadata
      resolvedEntities: Record<string, {
        id: string;
        label: string;
        entityType: string;
      }>;
    };

    // TIER 2: Query-scoped. Reset on every new user question. LLM-written (Zod structured output, NOT prose).
    queryContext: {
      rawQuery: string;              // Verbatim user question for this current query cycle
      pendingIntents: string[];      // What from rawQuery remains unanswered (max 5 items)
      activeFilters: Record<string, string>; // Current active tool filters (dateRange, statusCode, etc.)
      lastTurnInsight: string;       // ONE sentence max 120 chars. What just happened this turn.
    };
  };

  // 3. HITL Continuation Flag
  // Set to true by Orchestrator when returning hitl_required=true.
  // Prevents Tier 2 reset when the user answers a clarifying question (iterationCount=0 but same logical query).
  isHITLContinuation: boolean;

  // 4. Execution Control & Data Outputs
  toolCalls: any[];
  toolResults: Record<string, any>[];
  feedBackVerdict: 'SUMMARIZE' | 'FEED_BACK_TO_ME';
  reasoning?: string;

  // 5. Safety Loop Safeguard
  iterationCount: number;

  // 6. Graceful Error Handling
  error: string | undefined;
  hitl_required: boolean | undefined;

  // 7. Request Isolation
  startTurnIndex: number;

  // 8. Conductor Result Selection
  selectedResultKeys?: string[];
}
