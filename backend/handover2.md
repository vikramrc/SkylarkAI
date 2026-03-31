# Handover: SkylarkAI 4-Conversation Rolling Memory Implementation

## 🎯 Current Objective
Stabilize the SkylarkAI orchestrator by enforcing a **4-Conversation Rolling Window** for short-term memory (discovered Entity IDs) using a deterministic accumulation and promotion model.

## 🟢 System State (As of Mar 31st, 19:40)
The core architecture is now stabilized and verified across turns.

### 1. State Schema (`src/langgraph/state.ts`)
- **`accumulatedScope`**: Added to `queryContext`. This acts as a query-scoped buffer that collects every ID discovered by the LLM during multiple iterations (FEED_BACK_TO_ME loops) before the final summary.
- **`humanConversationCount`**: Tracks the number of completed investigations.

### 2. State Propagation (`src/langgraph/graph.ts`)
- **FIXED**: The `workingMemory` reducer was previously dropping `secondaryScope`. It has been patched to spread the existing `sessionContext` so rolling memory actually persists in the MongoDB checkpoint.

### 3. Deterministic Promotion (`src/langgraph/nodes/orchestrator.ts`)
- **Accumulation**: Every turn, `currentScope` IDs are merged into `accumulatedScope`.
- **Lock-In**: When the verdict is `SUMMARIZE`, the engine automatically promotes the entire `accumulatedScope` to `secondaryScope` with the current `conversationIndex`.
- **Pruning**: `secondaryScope` is strictly pruned to a 4-turn rolling window (current + 3 previous).
- **Debug Visibility**: Removed verbose system prompt logs; replaced with a clean `[DEBUG]` object dumping session/query context.

### 4. Summarizer Mapping Rule (`src/langgraph/prompts/summarizer_rules.ts`)
- **[NEW] Section VIII**: The Summarizer is now mandated to output a structured JSON `[ENTITIES]` block at the end of every summary.
- **Purpose**: This creates a machine-readable ledger of (ModelType | Name | ID) that the next turn's Orchestrator can read directly from history, bypassing the need for fragile backend scrapers.

---

## 🛠️ Next Steps (Work in Progress)

### 1. Refactor `UpdateMemory2`
- **Task**: Update `src/langgraph/nodes/update_memory2.ts` to parse the new `[ENTITIES]` JSON block from the Summarizer's message.
- **Benefit**: This allows us to delete the "custom crap" (regex extraction/hardcoded key lookups like `scheduleID` vs `_id`) in the backend code.

### 2. Verification
- **Test**: Run a multi-turn maintenance inquiry (Vessel -> Schedules -> Activities) and verify that the `[ENTITIES]` block successfully populates the Tier 1 Ledger (`resolvedEntities`) in the subsequent turn.

## 📂 Key Files Modified
- [state.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/state.ts) (Added `accumulatedScope`)
- [graph.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/graph.ts) (Fixed Reducer persistence)
- [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts) (Implemented Accumulation/Promotion/Pruning)
- [summarizer_rules.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/summarizer_rules.ts) (Added JSON [ENTITIES] block mandate)

**STATUS**: Memory persistence is now **RELIABLE**. The system successfully holds the Vessel ID across conversations. The next phase is ensuring it also holds the "List" items (Schedules/Activities) via the new Summarizer JSON path.
