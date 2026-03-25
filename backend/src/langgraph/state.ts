import { BaseMessage } from "@langchain/core/messages";

/**
 * SkylarkState defines the unified memory and execution state for the LangGraph pipeline.
 */
export interface SkylarkState {
  // 1. Thread Message History (Back-fed Automatically by Checkpointer)
  messages: BaseMessage[];

  // 2. Observational & Working Memory Context
  workingMemory: {
    activeTopics: string[];
    summaryBuffer: string;
    extractedEntities: {
      userPreferences?: { role?: string; timezone?: string; currentFocusedVessel?: string };
      organization?: { id?: string; name?: string; shortName?: string };
      vessel?: { id?: string; name?: string };
      maintenance?: Record<string, any>;
      procurement?: Record<string, any>;
      inventory?: Record<string, any>;
      budget?: Record<string, any>;
      crew?: Record<string, any>;
      fleet?: Record<string, any>;
      documents?: Record<string, any>;
    };
  };

  // 3. Execution Control & Data Outputs
  toolCalls: any[]; // The parallel tools listed by the Orchestrator
  toolResults: Record<string, any>; // execution outputs mapped by tool name
  feedBackVerdict: 'SUMMARIZE' | 'FEED_BACK_TO_ME'; // Prompt decisions
  reasoning?: string; // 🟢 Captured thought process from the Orchestrator flawlessly!

  // 4. Safety Loop Safeguard
  iterationCount: number;

  // 5. Graceful Error Handling
  error: string | undefined; // Descriptive explanation for breakouts flawless!
  hitl_required: boolean | undefined; // 🟢 MARK HITL REQUIRED execution pauses breakouts flawless!
}
