# Handover: SkylarkAI 5-Tier Memory Architecture & Orchestration

## 🎯 Current Objective
Establish a deterministic, token-efficient 5-tier memory architecture that eliminates "hallucinated IDs" and brittle backend scraping. The system now balances verbatim recent history, a rolling entity scope, and infinite conceptual long-term memory.

## 🟢 System Architecture (The 5-Tier Stack)

Details for each tier are in [skylark_memory.md](file:///home/phantom/.gemini/antigravity/brain/f1cda7da-bcd5-4a2f-ac09-4df45fb2430e/skylark_memory.md).

1.  **Knowledge Graph (Static)**: Maritime schemas and SFI codes.
2.  **`longTermBuffer` (Infinite)**: Compressed narrative of interactions older than the verbatim window.
3.  **`summaryBuffer` (7-20 Verbatim)**: Stores exact Q&A pairs. Slices the oldest 13 conversations into `longTermBuffer` when it hits 20, resetting to the latest 7.
4.  **`secondaryScope` (7-Conversation Rolling IDs)**: A FIFO list of (ModelType | Name | ID) parsed from the Summarizer's `[ENTITIES]` block.
5.  **`currentScope` (Immediate Scratchpad)**: Ephemeral scratchpad for the active investigation/turn.

---

## 🧠 Memory Persistence & Scoping Logic

### `accumulatedScope` vs `currentScope` (The "Notebook" vs the "Voice")
There is often confusion between these two terms in the code vs. the prompt:

*   **`currentScope` (The Voice)**: This is the field name defined in the **Orchestrator's Output Schema** (`orchestratorSchema`). When the AI discovers an ID (e.g., via `fleet.query_overview`), it "speaks" that ID back to us in the `currentScope` array in its JSON response.
*   **`accumulatedScope` (The Notebook)**: Because the AI's output message doesn't persist across turns of the *same* conversation, we store those discovered IDs in **`workingMemory.queryContext.accumulatedScope`**. 
*   **The Bridge**: In the next turn, the prompt injector takes the contents of `accumulatedScope` and shows it to the AI under the label: `currentScope (Organic Discoveries)`. This ensures that if it takes 3 turns to answer a question, the AI doesn't forget the ID it found in Turn 1.

### The [ENTITIES] Block Extraction
We have deleted manual regex scrapers from the backend. 
- **summarizer.ts** now uses a hardened regex to extract a `[ENTITIES]` JSON block from the AI's final answer.
- This block is the **Single Source of Truth** for populating `secondaryScope`.
- It is hardened against markdown codefences (e.g., it strips ```json tags if the LLM hallucinates them).

---

## 🛠️ Status & Implementation Details

1.  **State Schema**: Updated in [state.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/state.ts) to include the new buffers.
2.  **Compression Engine**: Implemented in [summarizer.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/summarizer.ts). It triggers a native `invoke` turn to summarize history when the buffer reaches 20 items.
3.  **Orchestrator Rules**: Updated in [orchestrator_rules.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts) to enforce "The Golden Rule": consult `secondaryScope` or `currentScope` before executing discovery tools.
4.  **State Safety**: Both `update_memory2.ts` and `summarizer.ts` have been refactored to return **Partial State Updates**. This prevent parallel branches from overwriting each other's memory modifications (e.g., `scope` vs `buffers`).

**STATUS**: The architecture is **Sturdy**. Long-term, short-term, and immediate memory are now logically isolated and deterministic.

> [!IMPORTANT]
> **Identity-First Protocol (Section 64/65)**: As of April 2026, the Orchestrator now uses a deterministic "Strategic Interceptor" to force entity resolution before retrieval. See the root `handover2.md` for the full technical specification of the Ambiguity Bridge and Context Thievery.
