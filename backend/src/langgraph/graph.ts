import { StateGraph } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";
import type { SkylarkState } from "./state.js";
import { nodeOrchestrator } from "./nodes/orchestrator.js";
import { nodeExecuteTools } from "./nodes/execute_tools.js";
import { nodeUpdateMemory } from "./nodes/update_memory.js";
import { nodeSummarizer } from "./nodes/summarizer.js";

import { nodeError } from "./nodes/error.js";

/**
 * 1. Initialize State Graph with custom channels (reducers)
 */
const workflow = new StateGraph<SkylarkState>({
  channels: {
    messages: {
      reducer: (x: any[], y: any[]) => x.concat(y), // Standard LangChain append
      default: () => [],
    },
    workingMemory: {
        default: () => ({ activeTopics: [], extractedEntities: {}, summaryBuffer: "" }),
    },
    toolCalls: { default: () => [] },
    toolResults: { 
        reducer: (x: any, y: any) => ({ ...x, ...y }), // Shallow merge to preserve multi-turn outputs
        default: () => ({}) 
    },
    feedBackVerdict: { default: () => "SUMMARIZE" },
    iterationCount: { default: () => 0 },
    error: { default: () => undefined }, // Optional error string
    hitl_required: { default: () => undefined }, // 🟢 Add this to preserve state update mechanics flawless!
  } as any 
});

// 2. Add Nodes
workflow.addNode("orchestrator", nodeOrchestrator as any);
workflow.addNode("execute_tools", nodeExecuteTools as any);
workflow.addNode("update_memory", nodeUpdateMemory as any);
workflow.addNode("summarizer", nodeSummarizer as any);
workflow.addNode("errorNode", nodeError as any);

// 3. Set Edges
workflow.addEdge("__start__" as any, "orchestrator" as any);

// Conditional Edge from Orchestrator
workflow.addConditionalEdges(
  "orchestrator" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";
      if (state.hitl_required) return "__end__"; // 🟢 Skip Summarizer for clarifying question breakouts flawlessly!
      if (!state.toolCalls || state.toolCalls.length === 0) {
          return "summarizer";
      }
      return "execute_tools";
  }) as any,
  {
      execute_tools: "execute_tools" as any,
      summarizer: "summarizer" as any,
      errorNode: "errorNode" as any,
      __end__: "__end__" as any // 🟢 Add this!
  } as any
);

// Conditional Edge from Execute Tools
workflow.addConditionalEdges(
  "execute_tools" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";
      return "update_memory";
  }) as any,
  {
      update_memory: "update_memory" as any,
      errorNode: "errorNode" as any,
  } as any
);

// 4. Conditional Edge for opinion decision loops
workflow.addConditionalEdges(
  "update_memory" as any,
  ((state: SkylarkState) => {
      if (state.error) return "errorNode";
      if (state.iterationCount >= 2) {
          return "summarizer"; 
      }

      const results = Object.values(state.toolResults || {});
      const standsAmbiguous = results.some((r: any) => r && r.__ambiguity_stop === true);
      if (standsAmbiguous) {
          return "summarizer";
      }

      return state.feedBackVerdict === "FEED_BACK_TO_ME" ? "orchestrator" : "summarizer";
  }) as any,
  {
      orchestrator: "orchestrator" as any,
      summarizer: "summarizer" as any,
      errorNode: "errorNode" as any,
  } as any
);

workflow.addEdge("summarizer" as any, "__end__" as any);
workflow.addEdge("errorNode" as any, "__end__" as any);

// 5. Compile with MongoDBSaver Checkpointer for durable persistence
const uri = process.env.SKYLARK_MONGODB_URI || "mongodb://localhost:27017/SkylarkDB";
const dbName = uri.split('/').pop()?.split('?')[0] || "SkylarkDB";

const client = new MongoClient(uri);
const memorySaver = new MongoDBSaver({ 
    client: client as any, 
    dbName 
});

export const skylarkGraph = workflow.compile({ checkpointer: memorySaver as any });
