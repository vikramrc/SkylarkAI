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

### `currentScope` (The Unified Investigatory Bridge)

We have unified the transient investigation memory into **`currentScope`**. The term `accumulatedScope` is deprecated.

*   **`currentScope` (The Voice)**: This is the field in the **Orchestrator's Output Schema** (`orchestratorSchema`). When the AI discovers an ID (e.g., via `fleet.query_overview`), it "speaks" that ID back to us in the `currentScope` array in its JSON response.
*   **The Bridge**: In the next turn, the prompt injector takes the contents of `currentScope` and shows it to the AI under the label: `currentScope (Organic Discoveries)`. This ensures the AI doesn't forget IDs found in prior turns of the *same* conversation.

### 🆔 `resolvedLabels` (Current Identity Ledger)

We have implemented a persistent **Identity Ledger** in the session context (`sessionContext.scope.resolvedLabels`). 
- **Persistence**: Unlike `currentScope` (which resets per query), `resolvedLabels` persists indefinitely for the conversation.
- **Deduplication**: Once a label (e.g., "XXX1") is resolved to a hex ID, it is stored in this ledger.
- **LLM Grounding**: This mapping is injected into every Orchestrator turn (as `🆔 RESOLVED ENTITIES`), ensuring the LLM never loses the link between a human-readable name and its canonical ID, even if the raw discovery results are purged from the short-term prompt buffer.

---

## 🛠️ Status & Implementation Details

1.  **State Schema**: Updated in [state.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/state.ts).
2.  **Compression Engine**: Implemented in [summarizer.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/summarizer.ts).
3.  **Orchestrator Rules**: Updated in [orchestrator_rules.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts).
4.  **Identity-First Strategy**: Implemented in [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts).
5.  **Deduplicated Harvesting**: [update_memory2.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts) now automatically extracts discovery results.

**STATUS**: The architecture is **Hardened**. Identity resolution is now deterministic, and memory scoping is unified to prevent context leakage or blindspot loops.

> [!IMPORTANT]
> **Identity-First Protocol (Section 64/65)**: As of April 2026, the Orchestrator now uses a deterministic "Strategic Interceptor" to force entity resolution before retrieval. See the root `handover2.md` for the full technical specification of the Ambiguity Bridge and Context Thievery.
