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
        ambiguousMatches?: any[];
        [key: string]: any; // Allow dynamic promotion of IDs (vesselID, machineryID, etc.)
      };
      // 🟢 Long-term infinite buffer compressed by LLM every 20 conversations
      longTermBuffer?: string;
      // 🟢 Exact verbatim text of Q&A for the last 7 to 20 window
      summaryBuffer?: { q: string; a: string; conversationIndex: number }[];
      // 🟢 Rolling short-term memory of canonical concrete IDs
      // Tagged with conversationIndex so we can prune to the exact same 7-conversations verbatim window
      secondaryScope?: {
        modelType: string;
        name: string;
        id: string;
        conversationIndex: number;
      }[];
      // Counts ONLY finalized conversations (incremented on every SUMMARIZE verdict).
      humanConversationCount?: number;
    };

    // TIER 2: Query-scoped. Reset on every new user question. LLM-written (Zod structured output, NOT prose).
    queryContext: {
      rawQuery: string;              // Verbatim user question for this current query cycle
      pendingIntents: string[];      // What from rawQuery remains unanswered (max 5 items)
      activeFilters: Record<string, string>; // Current active tool filters (dateRange, statusCode, etc.)
      lastTurnInsight: string;       // ONE sentence max 120 chars. What just happened this turn.
      currentScope?: string[];   // All IDs listed in currentScope across all turns of this query
      isBroadScope?: boolean;    // Set to true when user explicitly requested org/fleet-wide scope override
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
  // 🟢 LLM-distilled intent of the current conversation, set by Orchestrator on each turn.
  // Used by Summarizer to write a clean, de-noised 'q:' field into the summaryBuffer
  // instead of the raw fragmented rawQuery (e.g., "myorg, show for XXX1 only").
  reformulatedQuery?: string;

  // 5. Safety Loop Safeguard
  iterationCount: number;

  // 6. Graceful Error Handling
  error: string | undefined;
  hitl_required: boolean | undefined;

  // 7. Request Isolation
  startTurnIndex: number;

  // 8. Broad Scope Override Flag
  // Emitted by Orchestrator when user explicitly requests org/fleet-wide scope.
  // Consumed by UpdateMemory2 to clear entity-scope filters and persist isBroadScope.
  isBroadScopeRequest?: boolean;

  // 9. Parallel Execution Mode Flag
  // Emitted by Orchestrator each turn. When false, execute_tools runs tools sequentially
  // in the exact order they appear in toolCalls[] instead of via Promise.all().
  // The LLM must set this to false whenever mcp.clear_filters or any other state-mutating
  // tool is in the list — the tool ordering in toolCalls[] then defines the execution sequence.
  // Defaults to true (parallel) when not set, preserving existing behavior.
  parallelizeTools?: boolean;

  // 10. Domain Pivot Signal
  // Emitted by Orchestrator when the new user query switches operational domain
  // (e.g., maintenance → competency/crew, crew → inventory).
  // Consumed by UpdateMemory2 to clear domain-specific activeFilters that no longer
  // apply to the new domain. Differs from isBroadScopeRequest: that flag controls
  // entity-scope expansion; this flag controls attribute-filter clearing.
  // Defaults to false (same domain, filters inherited).
  isDomainPivot?: boolean;

  // 11. Ambiguity Resolution Signal
  // Emitted by Orchestrator each turn. The LLM lists the label strings (exactly as
  // they appear in scope.ambiguousMatches) that it definitively resolved this turn —
  // meaning: the user's answer was understood, a specific candidate was chosen, and
  // a retrieval tool is being called with that candidate's ID THIS TURN.
  // Consumed by UpdateMemory2 to promote the chosen candidate to resolvedLabels.
  // NOTE: The ticket entry is NO LONGER deleted from ambiguousMatches on resolution —
  // it stays as a reusable lookup table until pruned by the 20-to-7 compression.
  // Empty array (default) = no ticket activated this turn.
  ambiguitiesResolved?: string[];

  // 11b. Activated Ticket Signal (companion to ambiguitiesResolved)
  // Emitted by Orchestrator when it activates a specific ambiguity ticket to answer
  // the user's current message. Used by Summarizer to render attribution in insights.
  activatedTicketLabel?: string | null;       // which ticket's label was activated
  activatedTicketConfidence?: number;         // 0–1 confidence in the ticket match
  activatedCandidateIndex?: number | null;    // candidates[i] that was chosen (for ordinal display)

  // 12. Deterministic Label Resolution
  // Emitted by Orchestrator each turn. Contains entity labels (codes/names) that the LLM
  // could not resolve to a 24-char ID from its ledger, along with guessed entity types and
  // confidence scores. The resolve_labels LangGraph node reads this, resolves all labels in
  // parallel using resolveEntities(), injects found IDs into scope and toolResults, then
  // always clears this field to [] — regardless of whether resolution succeeded or failed.
  // The LLM then sees the resolution results and can either proceed (if IDs found) or
  // ask the user for clarification in natural language (if not found).
  unclassifiedLabels?: {
    label: string;
    likelyEntityTypes: { type: string; confidence: number }[];
  }[];
}
