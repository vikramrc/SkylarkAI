# Final Handover: SkylarkAI Architectural Hardening & Memory Resilience

This document summarizes the comprehensive stabilization work performed on the SkylarkAI orchestrator as of April 2, 2026. The system is now hardened against context collapse, memory bloat, and non-deterministic race conditions.

## 🏗️ The 5-Tier Memory Stack (Finalized)

The memory system is now a deterministic, single-owner hierarchy that prevents token blowup and "Identity Blind Spots."

1.  **Knowledge Graph (Static)**: Foundation of maritime relations (SFI, Schemas) loaded at startup.
2.  **`longTermBuffer` (Infinite)**: A conceptual summary of interactions older than the verbatim window.
3.  **`summaryBuffer` (7-20 Verbatim)**: Stores exact Q&A pairs. Ownership migrated to `summarizer.ts` (GAP-31).
    - **Compression Engine**: When the buffer hits 20 entries, the **oldest 13** are compressed into `longTermBuffer`, resetting the buffer to the **latest 7** (20-to-7 logic).
    - **HITL Persistence**: Clarifying exchanges are now proactively detected and committed here (GAP-3).
4.  **`secondaryScope` (7-Conversation Rolling IDs)**: A FIFO ledger of concrete IDs (`ModelType | Name | ID`) parsed from the `[ENTITIES]` block. Pruned to match the 7-turn verbatim window.
5.  **`currentScope` (Immediate Scratchpad)**:
    - **Transient Truth**: Wiped on brand-new queries but persists across HITL/Iterative loops.
    - **GAP-30 Fix**: Now deterministically synchronized from Phase 1 resolved IDs in `update_memory2.ts` before Phase 2 LLM execution.

---

## 🛡️ Critical Gap Remediations (The 34-GAP Audit)

### 1. Memory & State Integrity
- **GAP-2 (Context Wipe)**: Removed `queryContext` writes from the summarizer to prevent parallel-branch race conditions from wiping active filters.
- **GAP-9 (Windowing)**: Increased message window from 6 to 10 to prevent original human queries from sliding off the buffer during deep HITL chains.
- **GAP-16 (Non-Determinism)**: Implemented an explicit LangGraph `reducer` for `hitl_required` to prevent "last-write-wins" randomness in parallel branches.
- **GAP-31 (Race Conditions)**: Consolidated all Tier 1 memory writes to `summarizer.ts`, eliminating state collisions between memory and summary nodes.

### 2. Identity & Relational Reasoning
- **GAP-1 (Precedence)**: Established a constitutional mandate that `resolvedLabels` (current) always take precedence over `secondaryScope` (past).
- **GAP-10 (Connection Pool)**: Implemented a module-level **MongoDB Singleton Client** to prevent TCP exhaustion during parallel resolution calls.
- **The Ambiguity Bridge**: Tool results now emit an `__ambiguity_stop` sentinel when multiple entities match a label, triggering a direct graph breakout for clarification.

### 3. Stability & Infrastructure
- **GAP-15 (BSON Limit)**: Capped `toolResults` at 30 turns to prevent MongoDB 16MB checkpoint overflows.
- **GAP-29 (Timeout)**: Implemented a **25s Promise.race timeout** for all tool executions (GAP-32 ensures no dangling timer handles).
- **GAP-18 (Lookup Isolation)**: Restricted `active: { $ne: false }` filters to relevant collections to avoid index-blindness errors on specialized lookups.

### 4. Orchestration & UX
- **GAP-8 (Clarifying Mandate)**: Enforced explicit clarifying question triggers in the orchestrator's "deadEndStr" to prevent silent failures.
- **GAP-13 (Description Sync)**: Fixed tool parameter descriptions to correctly reference `optionalQuery` for optional parameters.
- **Strategic Interceptor**: Implemented a deterministic diversion that pauses retrieval turns to force entity resolution if unclassified labels are detected.

---

### 5. Maintenance Execution & Status Hardening (April 3, 2026)
- **Terminal Status Support**: Added explicit support for `cancelled`, `rescheduled`, and `missed` statuses in `mcp.service.js` and `contract.ts`.
- **Conditional Base Match**: Modified `getMaintenanceExecutionHistory` to conditionally drop the `committed: true` constraint when a terminal status is requested, preventing "disappearing" cancelled records.
- **Orchestrator Discipline (Rule III.2.3)**: Implemented a strict "Only send what is requested" mandate. The LLM is forbidden from adding default boolean flags (e.g., `taggedOnly: false`) or hallucinated filters (e.g., `maintenanceType: Corrective`) which previously caused empty results due to lack of matching event documents.
- **Tool Steering Hardening**: Updated `contract.ts` to strictly steer `cancelled` and "who did it" (performer) queries away from the lighter `query_status` tool and towards the high-fidelity `query_execution_history` tool.

---

## 🛠️ Developer Checklist for Next Agent

- **State Schema**: See `src/langgraph/state.ts` for the final memory interfaces.
- **Constitutional Rules**: See `orchestrator_rules.ts` for the latest "Identity-First" and "Sequential Turn" mandates.
- **Status Normalization**: See `mcp.service.js` (`buildMaintenanceStatusFilter`) for how `overdue`, `cancelled`, and `missed` are handled.
- **Timeout Logic**: Check `execute_tools.ts` for the 25s guardrail.
- **Compression**: Loop logic is in `summarizer.ts` (lines 340-380).

**STATUS**: ✅ **PRODUCTION READY**. All identified gaps, including the recent maintenance retrieval stalls, have been addressed. The system is robust, deterministic, and token-efficient.
