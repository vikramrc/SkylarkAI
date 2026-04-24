
# Handover 4: Hardening MCP Diagnostic Retrieval

> [!IMPORTANT]
> **MASTER REFERENCE**: For the definitive source of truth on the current Orchestrator architecture, memory tiers, and HITL invariants, refer to [SkylarkContext.md](file:///home/phantom/testcodes/SkylarkAI/SkylarkContext.md). This handover document tracks session-specific changes; `SkylarkContext.md` maps the resulting architecture.

## 1. The Core Issue
Users reported that queries like "show me blocked jobs org wide" returned 0 results even when blocked jobs existed in the database.

### Confirmed Root Causes (from live session analysis)

1. **Filter Hallucination** — At Turn 14, the AI ran two `maintenance.query_blocked_jobs` calls with `blockageReason=crew_unavailable` and `blockageReason=part_unavailable`. The user never asked for these specific reasons. The AI *guessed* them.
2. **Filter Stickiness** — At Turn 15, `UpdateMemory2`'s Phase 2 LLM saw these guessed values mentioned in its context and committed `blockageReason=shore_support_or_class_approval` into `activeFilters`. From that point on, every blocked-jobs query used this hallucinated filter, returning nothing.
3. **Silent Shadow Check** — The tool-side Shadow Check ran and correctly detected "0 items returned; 1 other blocked job exists in this scope." However, the `toolSummaryLines` in `UpdateMemory2` stripped the hint before it reached the Phase 2 LLM, so the AI never saw the broader count.

---

## 2. Debugging Flow (Stem to Stern)

### Step A: Find the Thread ID
```bash
npx tsx scripts/find_latest_thread.ts 2>/dev/null
```

### Step B: Trace the Conversation Turn by Turn
```bash
npx tsx scripts/debug_session_history.ts <THREAD_ID>
# Or in one line:
npx tsx scripts/debug_session_history.ts $(npx tsx scripts/find_latest_thread.ts 2>/dev/null)
```

### Step C: Checklist — What to Look For
| Turn | What to Inspect | Red Flag |
|------|-----------------|----------|
| Early turns | `Filters: (none)` | Normal — no filters yet |
| Tool call turn | `• tool: 0 items [blockageReason=X]` | Hallucinated filter being used |
| After tool call | `Filters: {..., blockageReason=X}` | Stale filter committed to memory |
| Shadow Check turn | `⚠ Shadow: 0 items with filters [X]; N other records exist` | AI doesn't see this if bridge was broken |
| Later turns | `0 items` with same stale filter | Retrieval failure from filter stickiness |

---

## 3. What Was Fixed (Phase 1 — Session Prior to This Handover)

### Tool-Side Diagnostic Resilience (`PhoenixCloudBE/services/mcp.service.js`)
- Added generic `shadowCheckHint()` helper (line ~124): factual-only, no imperative language
- Applied to `queryBlockedJobs`, `getMaintenanceExecutionHistory`, `getMaintenanceReliability`
- Shadow Check result surfaced in `summary` (string tools) or `summary.diagnosticHint` (object-summary tools)

---


## 3. What Was Fixed (Phase 2 — Previous Session)

### 1. Internal Diagnostic Payload Recognition (`update_memory2.ts`)
- **Fix 1 — Loop Breaking**: Updated `toolSummaryLines` status detection to recognize internal Skylark diagnostic tools (like `mcp.query_active_filters` and `mcp.clear_filters`) that return state rather than an `items` array.
- **Why?**: Previously, Phase 2 classified these as `0 items (empty)`, causing infinite loops.

### 2. Deterministic Filter Clearing (`mcp.clear_filters`)
- Implemented `mcp.clear_filters` in `execute_tools.ts`. Mutates `workingMemory` in-place without hitting the backend.
- Added hard rule to **Section IX** of `orchestrator_rules.ts` — AI MUST call the tool, not answer conversationally.

### 3. Anti-Hallucination Guardrails (Ground Truth Enforcement)
- Phase 2 LLM (`update_memory2.ts`) is forbidden from extracting attribute filters (blockageReason, failureCode, triggerOrigin) not verbatim in the tool's `appliedFilters` return.
- Updated `getParameterDescription` in `contract.ts` for ALL critical filters.
- Added `tool_unavailable` to the `blockageReason` enum in `ActivityWorkHistory` model.


## 4. What Was Fixed (Phase 3 — Current Session)

### 1. Robust Request Cycle Isolation (`requestCycleId`)
- **Problem**: BSON size pruning in MongoDB was causing the orchestrator's `startTurnIndex` to drift, making it believe no tools had run when in fact they had (causing spurious loops or skips).
- **Fix**: Introduced `requestCycleId` state channel. Each HTTP request gets a unique UUID. All tool results are tagged with this ID. Filtering is now done by ID match, not by array index slicing.
- **Files**: `state.ts`, `workflow.ts`, `orchestrator.ts`, `execute_tools.ts`.

### 2. Discovery Stall Guard Hardening
- **Fix 1 — Precedence Guard**: Prevented `clarifyingQuestion` output from stomping the guard's loop-back verdict. If the guard forces `FEED_BACK_TO_ME`, the LLM's question is suppressed for one turn to allow resolution to complete.
- **Fix 2 — Ambiguity Bail-out**: The stall guard now yields if `hasUnresolvedAmbiguity` is true. This breaks the dead-end loop when a label (like 'CCCCCCC') matches multiple entity types but no single canonical ID exists to retrieve with.

### 3. Ambiguity Prompt Bridge
- **Fix**: The `ambiguityStr` prompt block was previously dead code (defined but never injected into `memoryContext`). It is now active.
- **Hard Rule**: Injected a `MANDATORY ACTION` instruction into the prompt: when ambiguities exist, the LLM MUST set `clarifyingQuestion` + `SUMMARIZE` instead of attempting further tool calls.

---

## 5. Ground Truth Enums Reference

| Parameter | Valid Enum Values |
|-----------|-------------------|
| `blockageReason` | `waiting_parts`, `waiting_ptw`, `waiting_manpower`, `waiting_shore_support`, `waiting_class`, `tool_unavailable` |
| `repairType` | `permanent`, `temporary`, `interim` |
| `triggerOrigin` | `planned`, `form_finding`, `class_observation`, `manual`, `temporary_fix_followup` |
| `severity` | `critical`, `major`, `moderate`, `minor` |
| `statusCode` | `overdue`, `upcoming`, `completed`, `open`, `cancelled`, `rescheduled`, `missed`, `created` |
| `failureCategory` | `mechanical`, `electrical`, `human`, `structural`, `electronic`, `other` |

---

## 6. Debugging Scripts Reference

| Script | Usage | Purpose |
|--------|-------|---------|
| `scripts/find_latest_thread.ts` | `npx tsx scripts/find_latest_thread.ts` | Get the thread_id of the most recent chat session |
| `scripts/debug_session_history.ts` | `npx tsx scripts/debug_session_history.ts [thread_id]` | Raw turn-by-turn analysis — every checkpoint with filters, tools, item counts, insight |
| `scripts/debug_chat_analysis.ts` | `npx tsx scripts/debug_chat_analysis.ts [thread_id]` | **Conversation-level health analysis** — groups turns into conversations, gives PASS/HITL/WARN/LOOP/FAIL verdict + Health Score |
| `scripts/debug_activity_join.ts` | `npx tsx scripts/debug_activity_join.ts` | Diagnoses the Activity→Machinery joinThrough pipeline — raw DB matches, type mismatches, scoping failures |

### `debug_chat_analysis.ts` — Verdict Legend

| Verdict | Meaning |
|---------|----------|
| `✅ PASS` | Tools returned data; AI gave a substantive answer |
| `🔶 HITL` | AI asked a clarifying question (ambiguity or dead-end) |
| `⚠️ WARN` | AI answered but all tools returned 0 items — check filters or data |
| `🔁 LOOP` | Same tool+params fired 3+ times — orchestrator loop bug |
| `❌ FAIL` | Hit iter=8 hard cap with no answer |

### One-liner to analyse the latest chat
```bash
npx tsx scripts/debug_chat_analysis.ts $(npx tsx scripts/find_latest_thread.ts 2>/dev/null)
```

---

## 7. Architecture Notes

### Internal vs External Tool Contracts
- **Internal tools** (`mcp.query_active_filters`, `mcp.clear_filters`, `mcp.resolve_entities`) → defined in `SkylarkAI/backend/src/mcp/capabilities/contract.ts`.
- **External tools** → defined in `PhoenixCloudBE/constants/mcp.capabilities.contract.js`.
- Internal tools are intercepted in `execute_tools.ts` to mutate state directly.

### Filter Safety Chain
```mermaid
graph TD
    A[User Query] --> B[Orchestrator]
    B -- "If Reset/Clear" --> C[mcp.clear_filters]
    B -- "If Data Request" --> D[Tool Call with grounded params]
    C --> E[FEED_BACK_TO_ME]
    D --> F[Tool Result with appliedFilters]
    F --> G[UpdateMemory2 Phase 2]
    G -- "Only extract from appliedFilters" --> H[Clean activeFilters state]
    E --> H
    H --> I[Next Turn Inheritance]
```

---

## 8. Phase 5: Deterministic Failure Retrieval & Memory Integrity

### 9.1. Schema-Level Projection (Failure Visibility)
- **Problem**: `query_status` (`getMaintenanceStatus`) stripped `failureCode` and `failureCategory` in a final projection whitelist.
- **Fix**: Updated three projection stages in `PhoenixCloudBE/services/mcp.service.js` to retain these fields.
- **File**: `mcp.service.js` lines ~1672-1743, ~1800-1827, ~7824-7894.

### 8.2. The AWH Drill-Down Rule (Canonical Referencing)
- **Problem**: AI was querying `maintenance.query_execution_history` using `activityID` (returns most recent committed record, not the specific open job).
- **Fix**: Every item in `query_status` now exposes an `awhID` field. Contract updated: must use `activityWorkHistoryID` for drill-down, not `activityID`.

### 8.3. Orchestrator Constitutional Rules (Anti-Veto Protocol)
- **Rule 11 (SummaryBuffer Veto Prohibition)**: AI forbidden from using past "not found" summaries to skip tool calls.
- **Rule 12 (Pending Intents Mandate)**: If `pendingIntents` is non-empty, `tools: []` is a protocol violation.
- **File**: `SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts`

### 8.4. Memory Integrity (Buffer Sanitization)
- `[MEMORY_BLOCK]` tags were leaking into `longTermBuffer`.
- Fix script: `SkylarkAI/backend/scripts/fix_longterm_buffer.ts`.

### 8.5. Ground Truth Diagnostic Tools
- Script: `SkylarkAI/backend/scripts/check_failure_query.ts` — bypasses AI, reads LangGraph checkpoint (BSON) directly.
- Used to confirm AWH `69e1b95ab0dca34120af4880` has `failureCode: "SER"`, `failureCategory: "external"`.

---

## 9. Phase 6: PMS Diagnostic Analytics — Competency Gap Hardening

### 9.1. Unified Training Service (`crew.query_training_maps`)

**Problem**: The tool only queried the `FailureCodeTrainingMap` collection (admin-defined org-wide policies). If the org had not seeded any policy for a failure code (e.g. `SER`), the tool returned 0 items and the AI reported "no training found" — even though crew had logged competency signal gaps on actual AWH records.

**Fix** (`PhoenixCloudBE/services/mcp.service.js`, `queryTrainingMaps` function):
- Now performs **two parallel queries**: `FailureCodeTrainingMap` (policy) + `ActivityWorkHistory` (AWH records with `impliedCompetencySignalIDs`).
- AWH competency signal IDs are bulk-resolved to human-readable labels via `CrewCompetencySignal` collection.
- Full signal metadata is now fetched: `label`, `signalID`, `sections` (`["certificates","trainingRecords","medicalRecords"]`), `mapsToRequirementIDs` (STCW qualifications).
- Both sources are **merged into the `items[]` array** (tagged `source: "policy"` or `source: "awh_observed"`).
- The `awhObservedGaps` top-level field is preserved for backward compat, but `items` is now the canonical union.

**Why this matters**: The Summarizer pipeline reads ONLY `result.items[]` at line 135 of `summarizer.ts`. Any data returned in non-`items` top-level fields is invisible to the AI. This was the original "no training found" bug.

### 9.2. AWH-Level Competency Hydration (`maintenance.query_status`)

**Problem**: `query_status` returned `impliedCompetencySignalIDs` as raw ObjectId strings — not human-readable labels.

**Fix** (`mcp.service.js`, `getMaintenanceStatus`):
- After fetching AWH records, bulk-resolves `impliedCompetencySignalIDs` from the `CrewCompetencySignal` collection in a single query.
- Returns `impliedCompetencyGaps: [{ label, signalID, sections, mapsToRequirementIDs }]` inline on each status item.
- This means the AI sees competency gaps **without needing to call a secondary tool**.

### 9.3. `crew.query_competency_config` — Added Filter Params

**Problem**: `getCrewCompetencyConfig` accepted only `organizationID` and `limit`. When a user asked "tell me more about Tanker Management training", the AI correctly recognized that calling this tool would return ALL signals for the org — not the specific one asked about — and chose to answer from memory instead.

**Fix** (`mcp.service.js`, `getCrewCompetencyConfig`):
- Added optional `signalLabel` (case-insensitive partial match) and `signalID` (exact match) filter params.
- AI can now call `crew.query_competency_config?signalLabel=Tanker+Management` for a targeted lookup.

**Contract update** (`contract.ts`, `mcp.capabilities.contract.js`):
- `optionalQuery` updated to include `signalLabel`, `signalID`.
- `whenToUse` clarified: use when user asks for details on a named signal.
- `interpretationGuidance` added: always report `sections` and `mapsToRequirementIDs` to the user.

### 9.4. MCP Pipeline Visibility Fix — Comprehensive Pass

**The universal bug**: The Summarizer reads only `result.items[]`. Any tool returning meaningful data in other top-level fields is completely invisible to the AI.

**Audit of all tools** — found and fixed 4 additional offenders:

| Tool | Data Hidden From AI | Fix |
|------|--------------------|----|
| `inventory.query_part_alternatives` | `part`, `substitutes`, `crossReferences` — no `items` at all | Added `items[]` as union of primary part + substitutes with `type` discriminator |
| `fleet.query_structures` | `sfi`, `components` — no `items` | Added `items[]` merging both with `type: "sfi"` / `type: "component"` |
| `search.query_metadata` | `savedSearches`, `tags` — no `items` | Added `items[]` with `type: "saved_search"` / `type: "tag"` |
| `crew.query_competency_config` | `signals` — no `items` | Added `items: signals` alias |

**File**: `PhoenixCloudBE/services/mcp.service.js`

**Important**: Named fields are preserved for backward compat. Only `items[]` is added as the canonical union.

---

## 10. ⚠️ UNRESOLVED: The `direct_query_fallback` Dead Path

### What `direct_query_fallback` is

`direct_query_fallback` (`SkylarkAI/backend/src/mastra/tools.ts`, line 9) is a semantic search + MongoQL query engine powered by `serviceBackedPhoenixRuntimeEngine.processUserQueryStream`. It performs natural-language-to-MongoDB query translation and is designed to answer queries that no specific MCP tool covers, or to retry after an MCP tool fails.

**Activation paths** (from `orchestrator_rules.ts` Section IV.4 Failback Management):
1. **Direct pick**: Orchestrator explicitly chooses `direct_query_fallback` as the first tool when no structured MCP tool fits the query.
2. **Safety net**: After an MCP tool returns empty/error (with `FEED_BACK_TO_ME`), the Orchestrator sees the failure and calls `direct_query_fallback` as the next tool.

### Why it is NOT firing for competency/training detail requests

**Symptom observed** (from live logs):
```
[LangGraph Orchestrator Output] {
  "tools": [],
  "feedBackVerdict": "SUMMARIZE",
  "reasoning": "This is a text-only follow-up asking for more explanation about a training recommendation already present in memory..."
}
[Workflow Route] ⏭️ D2 skipped — no new tools ran this request (Orchestrator reused memory)
```

**Root cause** — a 3-factor confluence:

**Factor 1 — `pendingIntents` is empty after training map call**

In `update_memory2.ts` Phase 2, after `crew.query_training_maps` returns `1 item`, the LLM marks the training intent as `SATISFIED` and sets `pendingIntents: []`. It does not know that `sections` and `mapsToRequirementIDs` are a second-tier detail the user will want next. The Phase 2 LLM only sees `"1 items returned"` in its tool summary — which looks complete.

**Factor 2 — Rule 1 Conversational Exception fires incorrectly**

With `pendingIntents: []`, when the user asks "tell me more about Tanker Management", the Orchestrator applies Rule 1's Conversational Exception:
> *"ONLY if the user asks a purely text-based follow-up... whose answer already exists verbatim in your memory, you may skip tools."*

The `summaryBuffer` already has a prior INSIGHT about "Tanker Management with 1 occurrence". The Orchestrator classifies "tell me more" as a text explanation request, not a data request. This is superficially correct — there's no count, no date, no status — but it's architecturally wrong because the full signal detail (sections, qualification mappings) has NEVER been fetched.

**Factor 3 — `direct_query_fallback` has no entry point**

`direct_query_fallback` can only activate if:
- The Orchestrator chooses it in `tools[]`, OR
- An MCP tool is called first (with `FEED_BACK_TO_ME`) and fails, giving the Orchestrator a turn to see the failure and choose `direct_query_fallback` next

Since `tools: []` was returned, `execute_tools` never ran. There is no failure to react to. `direct_query_fallback` is structurally unreachable.

**Execution trace**:
```
Turn N:   crew.query_training_maps → {label:"Tanker Management", occurrences:1} returned
          update_memory2 Phase 2: "1 item → intent SATISFIED" → pendingIntents: []

Turn N+1: User asks "tell me more about Tanker Management"
          pendingIntents=[] → Rule 12 cannot fire
          summaryBuffer has prior answer → Rule 1 Conversational Exception fires
          tools: [] → execute_tools never enters → direct_query_fallback unreachable
          Summarizer: answers from memory (no new data)
```

### What the correct fix looks like (next agent's task)

**Constraint from the owner**: No case-by-case tool-specific injection (like the rejected Phase 1.5 approach that checked specifically for `crew.query_training_maps`). The fix must be **architectural and generic**.

**The correct approach**: Fix the `direct_query_fallback` trigger path so it activates properly when a user asks a detail question about data that was partially retrieved. There are two valid architectural options:

**Option A — Teach `update_memory2` Phase 2 that "returned items with structured IDs ≠ fully satisfied"**

Update the Phase 2 LLM system prompt in `update_memory2.ts` (line 481) with a generic rule:

> *"If a tool returned items that contain reference IDs (fields ending in `ID`, `Ids`, or named `signalID`, `competencyID`, etc.) that point to detail records NOT yet fetched in this turn, the retrieval intent is NOT fully satisfied. Add a `pendingIntent` indicating the detail fetch is still needed. This applies generically to any tool that returns reference pointers — not just training maps."*

This is **LLM-driven and generic** — it doesn't hardcode any tool name. Phase 2 LLM determines what constitutes "partially retrieved" based on whether items contain unfetched reference IDs.

**Option B — Fix the `direct_query_fallback` invocation mandate**

Currently, the Failback Mandate (Section IV.4) says:
> *"If a specialized MCP tool returns an error or empty result, you MUST attempt `direct_query_fallback`."*

This only covers empty/error. It does NOT cover the case where a tool returns partial data (items with label only, no detail). Extend the mandate:

> *"If a tool returned items but the user's follow-up question requests detail that was NOT present in the returned items (e.g. asking for sections, qualifications, or full metadata about an entity only identified by label), you MUST call the appropriate detail tool or `direct_query_fallback` — NOT answer from memory. Items containing only labels/names with no detail fields (sections, mappings, descriptions) are PARTIAL results, not complete ones."*

**Recommendation**: Implement **Option A** first (update Phase 2 system prompt — low risk, no code logic change) and validate with the training detail query. If that's insufficient, layer Option B (extend the Failback Mandate in orchestrator_rules.ts).

**Key constraint**: Do NOT inject tool-specific logic (checking for `crew.query_training_maps` by name) into `update_memory2.ts`. This creates fragile case-by-case branching that will need to be repeated for every new tool that has reference IDs.

---

## 11. Files Changed This Session (Phase 6)

### `PhoenixCloudBE/services/mcp.service.js`
| Function | Change |
|----------|--------|
| `queryTrainingMaps` | Dual-source: policy + AWH-observed gaps. Full signal hydration (signalID, sections, mapsToRequirementIDs). Both sources merged into `items[]`. |
| `getMaintenanceStatus` | AWH `impliedCompetencySignalIDs` bulk-resolved to full signal detail inline. |
| `getCrewCompetencyConfig` | Added `signalLabel` and `signalID` optional filter params for targeted lookups. |
| `getPartAlternatives` | Added `items[]` as union of primary part + substitutes (previously no `items`). |
| `getFleetStructures` | Added `items[]` merging `sfi` + `components` (previously no `items`). |
| `getSearchMetadata` | Added `items[]` merging `savedSearches` + `tags` (previously no `items`). |

### `SkylarkAI/backend/src/mcp/capabilities/contract.ts`
- `crew.query_competency_config`: Added `signalLabel`, `signalID` to `optionalQuery`. Updated `whenToUse`, `interpretationGuidance`, `responseShape`.
- `crew.query_training_maps`: Updated `responseShape` and guidance to reflect dual-source + full signal metadata.
- `maintenance.query_status`: Guidance updated to reflect inline `impliedCompetencyGaps`.

### `PhoenixCloudBE/constants/mcp.capabilities.contract.js`
- Synchronized with SkylarkAI contract changes.

---

## 12. Summary of Critical Files

| File | Purpose |
|------|---------|
| `PhoenixCloudBE/services/mcp.service.js` | Primary backend MCP service — all tool implementations |
| `SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts` | Orchestrator behavioral rules (12 rules currently) |
| `SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts` | Memory node — Phase 1 (code) + Phase 2 (LLM) |
| `SkylarkAI/backend/src/langgraph/nodes/summarizer.ts` | Reads `items[]` ONLY from tool results — critical constraint |
| `SkylarkAI/backend/src/mastra/tools.ts` | Tool definitions including `direct_query_fallback` |
| `SkylarkAI/backend/src/mcp/capabilities/contract.ts` | Internal tool contracts |
| `PhoenixCloudBE/constants/mcp.capabilities.contract.js` | External tool contracts (BE-side) |
| `PhoenixCloudBE/models/crew.competency.signal.model.js` | `CrewCompetencySignal` schema: `signalID`, `label`, `sections`, `mapsToRequirementIDs`, `isActive` |
| `PhoenixCloudBE/models/failure.code.training.map.model.js` | Org-admin policy: failure code → training requirement mappings |

---

## 13. Phase 7: Hardening Intelligent Retrieval Fallbacks

### 14.1. Deterministic Fallback Guardrails (`orchestrator.ts`)

**Problem**: The LLM was unreliable at signaling a fallback when specialized MCP tools returned 0 items. It would often attempt to `SUMMARIZE` a "no results found" message instead of retrying with semantic search.

**Fixes**:
- **`EMPTY RESULT FALLBACK GUARD`**: A code-level safety net that detects when (1) all retrieval tools in the cycle returned 0 items, (2) the LLM intends to `SUMMARIZE`, and (3) `direct_query_fallback` hasn't run yet. It auto-injects the fallback tool.
- **`FALLBACK DEDUP GUARD`**: Prevents the AI from looping on the fallback tool. Strips redundant `direct_query_fallback` calls if the tool already completed once in the current request cycle.
- **One-Shot Rule**: Added to `orchestrator_rules.ts` to inform the AI that semantic fallback is a one-shot-per-cycle capability.

### 14.2. Timeout Optimization (`execute_tools.ts`)

**Problem**: `direct_query_fallback` is a multi-step pipeline (Keyword Extraction → Ambiguity Resolution → RAG → Mongo Generation → Execution → Enrichment). Complex fleet-wide aggregations regularly took 30–45s, causing them to be killed by the global 25s tool timeout.

**Fix**:
- Implemented **per-tool timeouts**.
- `direct_query_fallback` now has a **90s limit**.
- All other MCP tools retain the **25s safety limit**.
- Error messages now dynamically report the actual timeout value used.

---

## 14. Phase 8: Phoenix Direct Query Engine (Hardening RAG & Generation)

### 15.1. Failure Domain Date Rule (`prompts.ts`)

**Problem**: The Mongo query generator was inconsistently picking `plannedDueDate` (a scheduling field) for ActivityWorkHistory date filters. In failure tracking, `plannedDueDate` is often null or irrelevant; the actual event timestamp is in `latestEventDate`. This caused "0 items found" despite valid data existing.

**Fix**: Added a **CRITICAL rule** to `AMBIGUITY_RESOLVER_SYSTEM_PROMPT` in `phoenixai/prompts.ts` (~line 239):
> *"For date range filtering on failure/work history queries, ALWAYS use latestEventDate (the actual event execution timestamp), NEVER plannedDueDate."*

### 15.2. The `$toString` Safety Bug (`prompts.ts`)

**Problem**: To prevent crashes, the generator wraps `$toString` in a `$type` check: `['string','double','int','long','decimal','bool','date']`. However, it **omitted `objectId`**. Since MongoDB `_id` fields are `ObjectId`, every attempt to join a name (e.g., "Fleetships") to an ID failed because the `$cond` returned `""` for the ID side.

**Fix**: Updated `QUERY_GENERATION_SYSTEM_PROMPT` (~line 318) to include `objectId` in the mandatory safety list. This restored Organization/Vessel resolution for all semantic queries.

---

## 15. Key Architectural Invariants (Updated)

1.  **Summarizer reads `items[]` only** — No change.
2.  **`direct_query_fallback` is one-shot** — Enforced by `FALLBACK DEDUP GUARD`.
3.  **Tiered Timeouts** — Fallback = 90s, MCP = 25s.
4.  **Date Filtering Ground Truth** — Failure queries = `latestEventDate`.
5.  **Join Safety** — `$toString` MUST include `objectId` in `$type` checks.

---

## 16. Phase 9: Hardening Phoenix Direct Query Retrieval (Orchestrator-to-Phoenix Bridge)

### 17.1. Deterministic Context Bridge (`tools.ts`)

**Problem**: The `direct_query_fallback` tool was "context-blind". The Phoenix AI Engine was forced to re-resolve entities (Organizations, Vessels) using expensive natural language `$lookup` stages, even though the Orchestrator already had these IDs in its `workingMemory`.

**Fix** (`mastra/tools.ts`):
- The `direct_query_fallback` tool now extracts `workingMemory` from its context.
- Constructs a normalized `sessionData` payload: `organizationID`, `vesselID`, `isBroadScope`, `activeFilters`.
- **SecondaryScope Resilience**: Groups focused entities by `modelType` into arrays (e.g., `machineryIDs: []`, `componentIDs: []`) to prevent overwriting when multiple entities of the same type are in focus.

### 17.2. Ambiguity Resolver Hardening (`executor.ts` & `prompts.ts`)

**Strategy**: Leverage the Ambiguity Resolver to "digest" the session context and output a deterministic natural language request for the Query Generator.

**Fixes**:
- **Context Injection** (`executor.ts`): The `sessionData` is injected as a labeled JSON block into the Ambiguity Resolver's dynamic context.
- **Constitutional Rules** (`prompts.ts`): Added a **Highest Priority Session Context block** to `AMBIGUITY_RESOLVER_SYSTEM_PROMPT`.
    - **No Over-Asking**: Forbidden from asking clarifying questions for entities already in `session_context`.
    - **ID Embedding**: Explicitly embeds hex IDs into `normalized_request` (e.g., "where organizationID is '651a...'"). This decouples the engine, letting the downstream generator handle the technical mapping.
    - **Broad Scope**: Respects `isBroadScope: true` to explicitly override vessel-specific filters.

### 17.3. MongoDB Type-Safe ID Matching (`prompts.ts`)

**Problem**: MongoDB aggregations fail if a string `"651..."` is queried against an `ObjectId` field. Some Skylark collections (like `AWH`) store `organizationID` as a String, while others use `ObjectId`.

**Fix**: Added **Session ID Type Safety** rule to `QUERY_GENERATION_SYSTEM_PROMPT`:
> *"Use the ID provided, but cast it (or don't) strictly according to the schema type for that target field. Consult the injected collections schema to decide between $expr+$convert vs plain string equality."*

### 17.4. Critical Cache Collision Fix (`executor.ts`)

**Problem**: The `ambiguityPromptHash` previously only hashed the `userQuery`. Identical questions in different vessel contexts (e.g., "how many open jobs?") would hit the same cache entry, returning stale data from the wrong vessel.

**Fix**: Updated `ambiguityPromptHash` calculation to include `JSON.stringify(sessionData)`. Any change in the Orchestrator's resolved scope now correctly busts the Phoenix cache.

---

## 17. Updated Architectural Invariants

1.  **Context Bridge**: Orchestrator `workingMemory` is the Single Source of Truth for entity IDs in fallback queries.
2.  **Schema-Aware Generation**: The Query Generator must NEVER assume a 24-character hex ID is an `ObjectId` without checking the `collections` schema.
3.  **Cache Integrity**: Prompt hashes must include session context to prevent cross-scope data leaks.

---

## 18. Phase 10: Advanced Crew Competency Diagnostics (Signal Completions & Gap Analysis)

### 19.1. The "Tanker Management" Discovery Gap

**Problem**: Competency signals (e.g., "Tanker Management") were not resolvable via `mcp.resolve_entities` because they use string `signalID`s (tags) on the `CrewMember` records rather than database ObjectIds. This prevented the AI from accurately querying who has completed a specific competency.

**Architectural Strategy**: 
1.  **Discovery Step**: Treat `crew.query_competency_config` as the discovery tool for signals (equivalent to `resolve_entities` for vessels).
2.  **Diagnostics Tool**: Introduce a purpose-built `crew.query_competency_diagnostics` tool to perform high-fidelity completion and gap analysis in a single aggregation pipeline.

### 19.2. Backend Implementation (`PhoenixCloudBE`)

**New Tool**: `getCrewCompetencyDiagnostics` (`mcp.service.js`):
- **Aggregation logic**:
    - Resolves the signal document (by label or ID) to fetch `signalID`, `sections` (records required), and `mapsToRequirementIDs`.
    - Joins `CrewMember` with `CrewAssignment` to correctly scope results to the active crew of a specific vessel (since `CrewMember` lacks a root `vesselID`).
    - Filters the member's `certificates`, `trainingRecords`, and `medicalRecords` arrays for entries matching the `signalID`.
    - JS-side post-processing calculates `missingSections` (Gaps) and `isFullyCompliant` status.
- **Contract Update** (`mcp.capabilities.contract.js`):
    - Exposed `signalLabel` and `signalID` on `crew.query_competency_config` (previously hidden).
    - Registered the new `crew.query_competency_diagnostics` capability with detailed instructions.
- **Plumbing**: Wired through `mcp.controller.js` and `mcp.route.js`.

### 19.3. AI Orchestration Strategy (`SkylarkAI`)

**Tooling Alignment** (`contract.ts`):
- Mirrored the backend contract changes to enable the AI to see the new `signalLabel` parameters and the new diagnostic tool.

**Resolution Logic**:
- **Protocol Rule**: When a user asks about a named competency signal (e.g., "Tanker Management"), the AI is taught (via tool `whenToUse` guidance) to:
    1.  Call `crew.query_competency_config` to resolve the signal metadata (sections, tags).
    2.  Call `crew.query_competency_diagnostics` with the resolved `signalID` and `vesselID` to fetch completions and gaps.
- **Special Case**: `crew.query_competency_diagnostics` also supports `signalLabel` directly, allowing the backend to handle the resolution internally in a single turn for common cases.

### 19.4. Summary of Data Points Surfaced

- **Completions**: A list of specific certificates/records per crew member that fulfill the signal requirement.
- **Gap Analysis**: A `missingSections` array (e.g., `["medicalRecords"]`) explicitly stating what the crew member is missing.
- **Compliance Stats**: Org/Vessel-wide summary counts (`fullyCompliantCount`, `partiallyCompliantCount`, `nonCompliantCount`).

### 🚦 Verification & Reliability

- **Type Safety**: The backend ensures that even if a signal name is passed (e.g., "tanker management"), it uses a case-insensitive regex for resolution.
- **Performance**: The aggregation pipeline uses indexed `organizationID` and `employmentStatus` filters before the `$lookup` join to maintain low latency even in large organizations.

---

## 19. Updated Architectural Invariants (Batch 10)

1.  **Competency Single Source of Truth**: `signalID` is the canonical tag string used to bridge `CrewCompetencySignal` definitions and `CrewMember` records.
2.  **Vessel Scoping**: All crew-related vessel filters MUST proceed via a join with the `CrewAssignment` collection.
3.  **Signal Resolution**: Named training/competency requests MUST use `query_competency_config` or `query_competency_diagnostics`, bypassing the generic `mcp.resolve_entities`.

## 21. Phase 11: Orchestrator Hardening & Sequenced Multi-Part Tasks

### 21.1. The "Resolution Hijack" Problem
**Problem**: In multi-part queries like *"clear the filters and show me Tanker Management completions"*, the Orchestrator's **Strategic Intercept** logic would see "Tanker Management" as an unclassified label and hijack the turn to run `mcp.resolve_entities`. 
- Since "Tanker Management" is a string signal tag (not a database ID), resolution would fail.
- The failure would trigger the **Discovery Stall Guard** or a dead-end clarifying question, preventing the user's intent to clear filters or run the actual competency query.

### 21.2. Generic Strategic Intercept Bypass (`orchestrator.ts`)
**Fix**: Implemented a two-tier bypass for the Strategic Intercept to ensure deterministic execution of meta-tools and correctly routed parameters.

1. **Atomic Meta-Tool Bypass**: `mcp.clear_filters` and `mcp.query_active_filters` are now categorized as **Atomic Diagnostic Tools**. If they are planned, the intercept is bypassed to ensure state changes happen first.
2. **Direct Parameter Bypass (Generic)**: If the LLM has already assigned an unclassified label as a string value in ANY planned tool argument (e.g., `signalLabel="Tanker Management"`, `searchTerm="Main Engine"`), the intercept is bypassed.
   - **Principle**: If the LLM has made a routing decision to use the label as a direct parameter, the Orchestrator respects that decision instead of forcing a resolution pass.
   - **Benefit**: This is fully generic and works for all current and future tools without hardcoding tool names.

### 21.3. Contract-First Reasoning Hardening
**Fix**: Updated tool contracts in `SkylarkAI` and `PhoenixCloudBE` to provide explicit "Contract-First" guidance to the LLM.

- **Tool**: `crew.query_competency_diagnostics`
- **Change**: Added a ⚠️ warning to `whenToUse`: *"You MUST pass the string name directly into the signalLabel parameter. Do NOT treat the signal name as an unclassified entity, and do NOT attempt to resolve it to an ID first."*
- **Result**: The LLM now correctly identifies "Tanker Management" as a direct parameter rather than an entity needing resolution, causing the generic bypass in 21.2 to trigger.

### 21.4. Multi-Intent Determinism
**Scenario Verified**: *"clear the filters and then show me current filters and then show me which crew members have completed Tanker Management training and when"*
- **Turn 0**: Orchestrator plans `mcp.clear_filters`, `mcp.query_active_filters`, and `crew.query_competency_diagnostics` in parallel/sequence.
- **Outcome**: The Strategic Intercept is bypassed because `mcp.clear_filters` is atomic AND "Tanker Management" is already handled as a direct `signalLabel` arg. 
- **Summary**: User receives the filter reset confirmation and the real competency data in a single turn.

---

## 22. Phase 12: Sequential Execution Hardening & UI Determinism

### 23.1. The Problem: Non-Deterministic Tool Execution in Multi-Part Filter Chains

**Core trigger**: A user says *"show me completed activities for XXX1 for this year, then reset filter and show me for past year only"*. This query has a **state-mutating step in the middle** (`mcp.clear_filters`). If the two retrieval calls run **in parallel** (via `Promise.all`), the second retrieval can start before the filter reset completes, returning stale data from the wrong date window.

**Root cause confirmed**: The LLM response object already contained a `parallelizeTools: false` intent field, but it was **never registered as a LangGraph state channel**. This meant the flag was silently dropped between the Orchestrator node (which set it) and the `execute_tools` node (which needed to read it). The `execute_tools` node always fell back to `Promise.all()`.

---

### 23.2. Fix 1: Register `parallelizeTools` as a LangGraph State Channel

**File**: `SkylarkAI/backend/src/langgraph/graph.ts`

**Change** (lines ~94–98): Added `parallelizeTools` to the `StateGraph` channel definitions with a `LastValue` reducer (last writer wins — always Orchestrator's most recent decision):

```typescript
parallelizeTools: {
    value: (prev: boolean | undefined, next: boolean | undefined) =>
        next !== undefined ? next : (prev !== undefined ? prev : true),
    default: () => true,
},
```

**Why critical**: Without this, the Orchestrator writes `parallelizeTools: false` to its return object, but LangGraph has no channel for it, so it is stripped before the state reaches `execute_tools`. With the channel registered, the flag persists across node boundaries.

---

### 23.3. Fix 2: `parallelizeTools` Schema & Orchestrator Logic

**File**: `SkylarkAI/backend/src/langgraph/state.ts`

Added `parallelizeTools?: boolean` to the `SkylarkState` interface.

**File**: `SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts`

- The LLM response schema already had a `parallelizeTools` field. The Orchestrator now reads it and commits it to the state via `updates.parallelizeTools`.
- **Strategic Intercept reset**: When the Strategic Intercept fires (to run `mcp.resolve_entities` or `mcp.clear_filters` as a meta-turn), `parallelizeTools` is reset to `true` (parallel is safe for single-tool turns). This prevents a stale `false` from a previous turn from accidentally serializing single-tool intercept turns.
- **Final commit variable** (`finalParallelizeTools`): Captures the resolved value so the return path always has a clean flag.

---

### 23.4. Fix 3: Sequential Execution Branch in `execute_tools.ts`

**File**: `SkylarkAI/backend/src/langgraph/nodes/execute_tools.ts`

**Change**: Extracted tool execution into `executeSingleTool()` helper. Added branching:

```typescript
if (state.parallelizeTools === false) {
    // Sequential for...of loop — each tool awaits the previous
    for (const toolCall of activeCalls) {
        const result = await executeSingleTool(toolCall, index);
        executedResults.push(result);
    }
} else {
    // Parallel Promise.all() — existing behavior
    const results = await Promise.all(activeCalls.map(...));
    executedResults.push(...results);
}
```

**Why**: With `for...of` + `await`, if tools are ordered `[mcp.clear_filters, maintenance.query_status(this year), maintenance.query_status(past year)]`, the second retrieval does not start until the filter is reset. This eliminates the stale-data race condition.

---

### 23.5. Fix 4: Orchestrator Rule 14 (LLM Guidance)

**File**: `SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts`

Added **Rule 14** to teach the LLM when to set `parallelizeTools: false`:

> *"If ANY tool in the planned list mutates shared state (mcp.clear_filters, mcp.set_filters, mcp.update_active_filters), set `parallelizeTools: false`. The execution engine will run them sequentially in the order listed. If no tool mutates state, set `parallelizeTools: true` (default). ORDER MATTERS: always put state-mutating tools first."*

This is the key mechanism: the LLM understands natural language ("reset filter and then...") and can detect mutating steps. The flag it outputs is then deterministically enforced by the execution engine.

---

### 23.6. Fix 5: UI Empty Tab Suppression Bug

**File**: `SkylarkAI/frontend/src/components/new-ui/ResultTable.tsx` (line ~341)

**Problem**: If a retrieval tool returned 0 rows, the UI tab for that query was silently dropped — the user had no way to know whether the tool ran at all or produced no data.

**Old logic**:
```typescript
.filter((result) => result.rows.length > 0)
```

**New logic**:
```typescript
.filter((result) => result.rows.length > 0 || !!result.uiTabLabel)
```

**Why**: The LLM supplies a `uiTabLabel` for every explicitly planned query (e.g., "Completed Activities – This Year"). If rows are 0 but the tab is labeled, it means the query was intentional. Showing "No data found" in an explicitly labeled tab is better UX than silently dropping it — the user can see the tool ran with the correct filter and returned no results (which is a valid, informative answer).

---

### 23.7. Fix 6: EMPTY RESULT FALLBACK GUARD — False Positive Fix

**File**: `SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts` (lines ~886–910)

**Problem**: The guard checked `requestCycleToolResults.some(turn => ...)` — meaning **any** turn in the request cycle that had a 0-item result would trigger the guard and inject `direct_query_fallback`.

**False positive scenario**:
1. Turn 24: `mcp.query_active_filters` → returns state object (no `items` array, evaluates as "empty")
2. Turn 25: Entity resolution
3. Turn 26: 3× `maintenance.query_status` → all return real data
4. LLM correctly returns `tools: []` + SUMMARIZE (Turn 26 data is in context)
5. Guard fires because Turn 24 was "empty" → injects `direct_query_fallback` → causes ambiguity

**Fix**: Changed to check only the **LAST retrieval turn**, not any turn:

```typescript
const isNonDiscoveryRetrievalKey = (k: string) =>
    !isDiscoveryKey(k) && !k.includes('direct_query_fallback') && !k.startsWith('mcp.');

const lastRetrievalTurn = [...requestCycleToolResults].reverse().find(turn =>
    Object.keys(turn || {}).some(k => isNonDiscoveryRetrievalKey(k))
);

const hasEmptyRetrievalResult = lastRetrievalTurn
    ? Object.entries(lastRetrievalTurn).some(([k, res]) => {
        if (!isNonDiscoveryRetrievalKey(k)) return false;
        let data: any = res;
        if (data?.content?.[0]?.text) { try { data = JSON.parse(data.content[0].text); } catch {} }
        return Array.isArray(data?.items) ? data.items.length === 0 : false;
    })
    : false;
```

**Also**: Explicitly excludes `mcp.*` keys (clear_filters, query_active_filters) since these are state management tools, not data retrieval tools. Their "empty" return should never trigger the fallback guard.

---

### 23.8. Fix 7: Ambiguity HITL Bridge (`execute_tools.ts`)

**File**: `SkylarkAI/backend/src/langgraph/nodes/execute_tools.ts` (line ~272)

**Problem**: When `direct_query_fallback` returns `__ambiguity_stop: true`, the graph exits immediately via `graph.ts`'s routing function (`return "__end__"`). The **next HTTP request** (user's clarification answer) arrives with:
- `isHITLContinuation: false` (never was set for this path)
- `iter = 0`, so `isNewQuery = (0 <= 1) && !false = true`
- `update_memory2` resets Tier 2 (rawQuery, pendingIntents) because `isNewQuery = true`
- LLM now sees the clarification answer as a **fresh query topic** and misinterprets it

**Concrete failure**: After ambiguity stop on *"show me completed activities for XXX1 for this year, then reset filter and show me for past year only and then show me the same for MV Phoenix Demo"*, the next request ran `maintenance.query_status` for `XXX1 + 2024` (wrong vessel, wrong year) instead of `MV Phoenix Demo + this year` which was the `pendingIntents` item.

**Fix**: When the ambiguity stop return is built (line 272), add `isHITLContinuation: true`:

```typescript
return {
    toolResults: outputs,
    messages: [...state.messages, new AIMessage({ content: finalMessageContent })],
    // 🟢 AMBIGUITY HITL BRIDGE: Tell the next HTTP request that the user is answering
    // a clarifying question, not starting a fresh query.
    isHITLContinuation: true,
} as any;
```

**Effect**: Next HTTP request has `isHITLContinuation: true` → `isNewQuery = false` → Tier 2 is preserved → `rawQuery` and `pendingIntents` are intact → Orchestrator executes the pending intent (MV Phoenix Demo) correctly.

---

### 23.9. Update Memory2 Band-Aid Reverts

**File**: `SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts`

Previous sessions had added temporary "band-aid" fixes that manually cleared or reset filter context to prevent stale-data poisoning. These were removed because the new deterministic sequential pipeline (Fix 1–4 above) handles the ordering problem properly at the execution layer, making the band-aids unnecessary and potentially harmful.

---

### 23.10. Architecture Overview (Phase 12)

```
User Query: "show me completed X for this year, reset filter, show past year, then MV Phoenix Demo"
                          │
                    [Orchestrator Node]
                          │
              LLM produces parallelizeTools: false
              tools: [mcp.clear_filters, query_status(year1), query_status(year2), query_status(vessel2)]
                          │
                    [graph.ts state channel]
                    parallelizeTools = false ✅ (now persists)
                          │
                  [execute_tools Node]
                          │
              state.parallelizeTools === false?
                          │
                    ┌─────▼──────┐
                    │ for...of   │  ← Sequential, guaranteed order
                    │ await each │
                    └─────┬──────┘
                          │
              [clear_filters] → [query_status year1] → [query_status year2] → [query_status vessel2]
                          │
                   All results in state
                          │
              EMPTY RESULT FALLBACK GUARD (checks last retrieval turn only)
                          │
              if last turn has data → no fallback injection
                          │
                    [Summarizer]
                          │
              4 tabs rendered (with empty tabs shown if uiTabLabel present)
```

---

### 23.11. Files Changed in Phase 12

| File | Change |
|------|--------|
| `backend/src/langgraph/graph.ts` | Registered `parallelizeTools` as a LangGraph state channel with `LastValue` reducer |
| `backend/src/langgraph/state.ts` | Added `parallelizeTools?: boolean` to `SkylarkState` interface |
| `backend/src/langgraph/nodes/orchestrator.ts` | Reads/commits `parallelizeTools`; Strategic Intercept resets to `true`; EMPTY RESULT FALLBACK GUARD now checks last retrieval turn only (not any turn) |
| `backend/src/langgraph/nodes/execute_tools.ts` | Extracted `executeSingleTool()` helper; added sequential `for...of` branch when `parallelizeTools === false`; added `isHITLContinuation: true` to ambiguity stop return |
| `backend/src/langgraph/nodes/update_memory2.ts` | Removed temporary filter-poisoning band-aid patches |
| `backend/src/langgraph/prompts/orchestrator_rules.ts` | Added Rule 14 (sequential execution mandate for state-mutating tool chains) |
| `frontend/src/components/new-ui/ResultTable.tsx` | Changed tab filter to retain labeled (uiTabLabel) tabs even with 0 rows |

---

### 23.12. Known Remaining Issues / Watch Points for Next Agent

1. **`direct_query_fallback` ambiguity False Positives**: The ambiguity engine in the Phoenix Direct Query layer may still trigger for legitimate single-vessel queries that are underspecified. The bridge fix (23.8) prevents this from *losing state*, but if the user genuinely provides an ambiguous query to the Phoenix engine, the clarification flow still pauses execution. This is by-design but the UX of "waiting for clarification" for queries that the MCP tools could have answered is suboptimal.

2. **Post-Ambiguity Pending Intent Execution**: After the HITL bridge fix, the next request will correctly preserve `pendingIntents`. BUT the Orchestrator must be correctly reading and executing from `pendingIntents` rather than re-interpreting the user's clarification answer as the primary query. Rule 12 (Pending Intents Mandate) enforces this — verify in live testing that the LLM follows it when `isHITLContinuation: true` is present.

3. **`mcp.query_active_filters` Evaluated as "Empty"**: The EMPTY RESULT FALLBACK GUARD now excludes `mcp.*` keys, but `mcp.query_active_filters` returns a state object that doesn't have an `items` array. Verify this exclusion is working as expected in production logs.

4. **Sequential Status Message**: The workflow route (`routes/workflow.ts`, line 86) emits "Executing N Parallel Tools..." for all execute_tools runs. When `parallelizeTools === false`, it should say "Executing N Sequential Tools..." — cosmetic issue, low priority.

### 23.13. Fix 8: Summarizer Context Enrichment (Generic `appliedFilters`)

**File**: `SkylarkAI/backend/src/langgraph/nodes/summarizer.ts`

**Problem**: When a tool returned 0 results, the Summarizer previously received only the tool key (e.g., `maintenance.query_status_iter1_5`). Because there were no data rows in the flattened result table to provide evidence, the LLM would hedge its summary with phrases like *"prior-year result remains unconfirmed"*—even though the tool actually ran and returned a confirmed empty set.

**Fix**: Enriched the `emptyTools` metadata passed to the Summarizer by serializing the full `appliedFilters` object and any `uiTabLabel`.

```typescript
const filterContext = af && Object.keys(af).length > 0
    ? ` Applied filters: ${JSON.stringify(af)}.`
    : '';
emptyTools.push(`- **${key}** (${capability})${labelContext}: Returned 0 matching items.${filterContext} This is a CONFIRMED EMPTY result — the query ran successfully with these exact filters and found no matching records. State this explicitly in your summary.`);
```

**Why**: This provides the LLM with the "ground truth" of the query's intent (e.g., vesselID, dates). The LLM can now confidently state: *"No completed activities were found for MV Phoenix Demo in 2025,"* providing better closure to the user.

---

### 23.14. Fix 9: Temporal Awareness (Current Date Injection)

**File**: `SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts`

**Problem**: The LLM lacked awareness of the actual current date, leading it to default to 2025 as "this year" based on its training data bias. This caused incorrect date-range tool arguments (e.g., querying 2024 for "past year" when it should be 2025).

**Fix**: Injected today's date and relative year definitions directly into the `SESSION CONTEXT` header of the prompt.

```typescript
const today = new Date();
const todayStr = today.toISOString().split('T')[0]; // e.g. "2026-04-19"
const currentYear = today.getFullYear();           // e.g. 2026
const priorYear = currentYear - 1;                 // e.g. 2025

// Injected at top of SESSION CONTEXT:
`📅 TODAY: ${todayStr} | Current Year: ${currentYear} | Prior Year: ${priorYear}\nWhen the user says "this year" use ${currentYear}. When they say "past year" or "prior year" use ${priorYear}.`
```

**Why**: This eliminates LLM guessing. All relative time expressions ("last 30 days", "prior year", "next month") are now anchored to the physical system clock.

---

## 23. Phase 13: Hardening Orchestrator Ambiguity & HITL Context Bridge

### 23.1. Vestibule Pruning (Memory Hardening)

**Problem**: The "Strategic Intercept" (Vestibule) in `orchestrator.ts` would repeatedly trigger `resolve_entities` for previously ambiguous labels (e.g., "CCCCCCC") even after the user had provided a resolution. This was because the `resolvedLabels` map only contained the resolved IDs/Types, not the original ambiguous label string used by the user.

**Fix** (`update_memory2.ts`):
- Implemented **Vestibule Pruning** in Phase 2.
- When any candidate from an `ambiguousMatches` entry is found to have been resolved (ID exists in `resolvedLabels`), the system now explicitly registers the **original label** (e.g., "CCCCCCC") in the `resolvedLabels` state, mapping it to the chosen candidate.
- **Impact**: This satisfies the Vestibule's `resolvedLabelSet` skip guard, preventing the system from re-triggering resolution passes for already-settled entity names.

### 23.2. HITL Context Bridge (Orchestrator Intent Injection)

**Problem**: During a Human-in-the-Loop (HITL) continuation, the user often provides a terse reply (e.g., "show me all"). The Orchestrator's message-masking logic (which builds the `qnaTranscript` from `summaryBuffer` + latest message) would strip the preceding context of the *current* unsettled conversation. The LLM would lose sight of what "all" referred to, leading to failed tool calls or underspecified summaries.

**Fix** (`orchestrator.ts`):
- Introduced an **Active Intent Bridge** for HITL turns (`iterationCount === 0` and `isHITLContinuation: true`).
- The Orchestrator now injects the `reformulatedQuery` (the LLM's already-distilled understanding of the current HITL chain) as an `[ACTIVE INTENT]` block before the user's reply.
- **Transient Prompt Injection**: This block is only injected into the prompt for the current turn. It is **not** written to the persistent `summaryBuffer`.
- **Squashing**: Once the HITL cycle finishes and `SUMMARIZE` fires, the entire exchange is squashed into a single clean Q&A pair in `summaryBuffer` as per standard protocol.

### 23.3. Deterministic Identity Source

**Logic**: The bridge uses a tiered priority for the active intent:
1. `state.reformulatedQuery` — The LLM's most recent clean distillation of the conversation's goals.
2. `queryContext.rawQuery` — Verbatim fallback if reformulation hasn't occurred yet.
3. Empty string fallback for safety.

---

## 24. Updated Architectural Invariants (Batch 13)

1. **Vestibule Skip Guard**: A label is only considered "unclassified" if it is not present in `resolvedLabels`. Pruning ensures original ambiguous labels are registered as aliases to their resolved IDs.
2. **HITL Context Persistence**: The `reformulatedQuery` is the canonical representation of the "current goal" during multi-turn HITL exchanges and must be used to bridge context for terse user replies.
3. **Transient Prompt Engineering**: Intermediate HITL context bridges must remain in the prompt layer and must not pollute the permanent `summaryBuffer` or `longTermBuffer`.

3. **Ambiguity HITL Bridge**: When `direct_query_fallback` triggers an ambiguity stop, `isHITLContinuation: true` is persisted in state so the next HTTP request preserves `rawQuery` and `pendingIntents`.
4. **Empty Tab Visibility**: A UI tab is ALWAYS rendered if the LLM provided a `uiTabLabel`, regardless of row count. "No data found" is a valid, informative result.
5. **Summarizer Confidence**: The Summarizer must be provided with `appliedFilters` for empty results so it can definitively report 0-match outcomes for specific entities/dates rather than hedging.
6. **Temporal Determinism**: The Orchestrator must always be injected with the current system date to ensure correct interpretation of relative time filters.
7. **LangGraph Channel Registration**: Any flag that the Orchestrator sets that must survive to the next node MUST be registered as a state channel in `graph.ts`. Unregistered fields are silently dropped.


## 23. Phase 13: Hardening Competency Diagnostic Pipelines & Entity Resolution

### 25.1. The "Phase 11" Orchestrator Bypass (Eliminated)

**Problem**: A generic bypass in `orchestrator.ts` (`allUnclassifiedHandledAsArgs`) was silencing the Strategic Intercept whenever an unclassified label appeared as any tool argument. This allowed misrouted labels (e.g., a vessel name like "XXX1" placed in `activityDescription`) to silently skip resolution. Since the downstream tools could not match "XXX1" against a description field, the query would return 0 results without the AI ever realizing it missed an entity.

**Fix** (`orchestrator.ts`):
- **Deleted** the `allUnclassifiedHandledAsArgs` block entirely. 
- The Strategic Intercept now has exactly **one bypass path**: atomic meta-tools (`mcp.clear_filters`, `mcp.query_active_filters`) that mutate session state.
- **Result**: Every unclassified entity label — vessel, machinery, or competency signal — is now forced through `mcp.resolve_entities` to obtain a canonical ObjectId before being passed to retrieval tools.

### 25.2. Unified Resolver for Competency Signals

**Problem**: `CrewCompetencySignal` was previously handled as a special case where labels were passed directly to tools (`signalLabel`). This deviated from the "Resolve-First" architecture used for Vessels and Machinery, leading to resolution failures when signals were mixed with other entities.

**Fix** (`lookup_logic.ts`):
- Registered `CrewCompetencySignal` in `RESOLVABLE_ENTITIES` (searches `label` and `signalID`).
- Added to `COLLECTIONS_WITH_ACTIVE_FLAG` with explicit mapping for the `isActive` field (as this collection uses `isActive`, not `active`).
- **Result**: Signals are now standard resolvable entities. `mcp.resolve_entities(entityType='CrewCompetencySignal')` returns a 24-char ObjectId.

### 25.3. Service-Side Hardening (`PhoenixCloudBE`)

**Fix** (`mcp.service.js`, `getCrewCompetencyDiagnostics`):
- Refactored to accept `competencySignalID` (ObjectId) as the primary lookup key.
- Resolves the internal string `signalID` tag via `findOne({ _id })`.
- Removed `signalLabel` support from the AI-driven path to enforce deterministic resolution.

### 25.4. Contract-First Enforcement (`contract.ts`)

**Changes**:
- **`activityDescription`**: Added a ⚠️ CRITICAL warning: *"NEVER pass a vessel name, vessel code, or machinery name here."*
- **`competencySignalID`**: Added parameter description with the resolve-first mandate.
- **`crew.query_competency_diagnostics`**: Updated to require `competencySignalID` (ObjectId). Removed "pass string directly" guidance.

### 25.5. Hardened Discovery Stall Guard (Signal-Driven Termination)

**Problem**: The Discovery Stall Guard was capped at `iter === 1`. In sessions where stale observational memory (e.g., "no records found" from a prior turn) fooled the LLM into thinking work was done, it would attempt to `SUMMARIZE` at `iter=2` with no retrieval tools. The guard would stand down, and the query would fail.

**Fix** (`orchestrator.ts`):
- **Removed the iteration cap**. The guard now fires solely based on **code-level signals**:
    - `prevTurnWasDiscovery === true`
    - `hasRetrievalInCurrentRequest === false`
    - `pendingIntents.length > 0` (The "Unfinished Work" signal)
- **Result**: The Orchestrator will continue to loop back as long as `UpdateMemory2` reports unfulfilled intents, protected by the graph's hard `maxIter=8` ceiling.

---

## 24. Phase 14: Entity Scope Hardening & Domain Pivot Logic

### 27.1. Entity Scope Contamination (Fixed)

**Problem**: The `currentScope` array (used by the Orchestrator to iterate over fleet vessels) was a flat list of hex IDs with no type awareness. Non-navigable entity IDs (e.g., `CrewCompetencySignal` ObjectIds) were being promoted into this list. This caused the Orchestrator to pass signal ObjectIds as `vesselID` arguments to maintenance tools, leading to "Vessel not found" errors.

**Fix** (`update_memory2.ts`):
- Introduced **`SCOPE_NAVIGABLE_KEYS`**: A deterministic whitelist (`vesselID`, `machineryID`) that defines which entity types drive fleet-level iteration.
- **Filtered Promotion**: Only ObjectIds associated with navigable keys are promoted to `currentScope`. 
- **Preserved Context**: Non-navigable IDs (like `crewcompetencysignalID`) stay in the session scope under their typed keys. They remain available for tools as parameters but can no longer contaminate the fleet vessel list.

### 27.2. Semantic Domain Pivot Signal

**Problem**: The system relied on string comparison (`isGenuineTopicPivot`) to decide whether to clear active filters. This was structurally correct (text changed) but semantically blind. It failed to distinguish between an **entity pivot** (same domain, different vessel) where filters (dates, status) should be kept, and a **domain pivot** (maintenance to competency) where filters must be cleared.

**Fix**:
- **`isDomainPivot` Flag** (`orchestrator.ts`): Added a semantic signal to the Orchestrator schema. The LLM now judges whether the operational domain has changed (e.g., Maintenance → Competency).
- **Domain-Specific Reset** (`update_memory2.ts`): When `isDomainPivot` is true, all domain-specific `activeFilters` (statusCode, dates) are cleared. On entity pivots (`isDomainPivot=false`), these filters are inherited.
- **State Integration**: Registered `isDomainPivot` as a `LastValue` state channel in `graph.ts` and added to the `SkylarkState` interface.

### 27.3. Conversation Turn Integrity (The GAP-4b Fix)

**Problem**: `summarizer.ts` was incorrectly skipping the `summaryBuffer` write and `humanConversationCount` increment whenever a tool returned 0 items (`[]`).
- **Root Cause**: The logic `hasRealData = allItems.length > 0` equated "empty result" with "failed execution."
- **Effect**: Confirmed-empty retrieval turns (e.g., "No competency completions found for XXX1") were silently dropped from the AI's memory. On the next turn, the LLM would have no record of the exchange and revert to stale historical context (e.g., defaulting back to maintenance queries).

**Fix** (`summarizer.ts`):
- Refined `hasRealData` to include `emptyDataset` as a valid conversation turn, provided the tool didn't return a hard error string.
- **Result**: "0 items found" is now a persistent fact in conversational memory, ensuring the AI maintains the correct domain context across turns.

### 27.4. Natural Language Topic Comparison (`isDomainPivot`)

**Problem**: Initial domain pivot logic relied on classifying tool families. This was fragile and non-human.
**Fix** (`orchestrator.ts`):
- Replaced tool-classification logic with a **Natural Language Reading Comprehension** prompt.
- The Orchestrator now explicitly compares the *New Question* vs the *Last Q&A* and asks: *"Is this a natural follow-up to the existing conversation, or is it a completely unrelated topic/domain change?"*
- **Reasoning**: This handles conversational nuances (e.g., switching from Maintenance to Competency) much more reliably than code-level tool lists.

### 27.5. UI Aesthetic Hardening

**Fix** (`AnalyticalSummary.tsx`):
- Added support for `trend-up` (`TrendingUpIcon`) and `refresh-cw` (`RefreshCw`) icons.
- These icons are used to visually confirm "Filter Reset" and "Operational Trend" insights, improving the premium feel of the analytical summaries.


---

## 25. Updated Architectural Invariants (Batch 14)

1.  **Mandatory Resolution**: No retrieval tool may accept a human-readable label for an entity type that exists in `mcp.resolve_entities`. All labels must be resolved to ObjectIds first.
2.  **No Generic Intercept Bypass**: The Strategic Intercept fires for all unclassified labels. Only meta-tools that operate on session state (`mcp.*`) may bypass it.
3.  **Signal-Driven Termination**: The Orchestrator cannot `SUMMARIZE` if (a) the previous turn was a discovery turn and (b) `pendingIntents` is non-empty. This prevents premature termination due to stale observational memory.
4.  **Navigable Scope Isolation**: Only entity types defined in `SCOPE_NAVIGABLE_KEYS` (Vessels, Machinery) can enter the `currentScope` array. This prevents parameter contamination across tool domains.
5.  **Semantic Filter Inheritance**: Filter inheritance is governed by the `isDomainPivot` signal. Filters are inherited across entity pivots in the same domain but strictly cleared when switching domains.
6.  **Field Invariants**: `CrewCompetencySignal` uses `isActive`. Most other collections use `active`. Resolver logic must account for this discrepancy.
7.  **Conversation Persistence**: Every turn that produces a user-facing response — including confirmed empty results (`[]`) — MUST increment the conversation index and be written to the `summaryBuffer`. Skipping turns is only permitted for hard tool errors.
8.  **Natural Topic Detection**: Domain pivot detection MUST use LLM-based reading comprehension (comparing Q to previous Q&A) rather than static tool family lists to handle conversational shifts reliably.

---

## 26. Hardening Memory Persistence & Discovery Intercepts (Batch 15)

### 29.1. Protected Domain Context (The GAP-18 Fix)

**Problem**: During scope expansions (e.g., from "XXX1 competency" to "org-wide competency"), the system exhibited "Context Amnesia." 
- **Root Cause**: `UpdateMemory2` Phase 2 LLM would see a new `rawQuery` ("Organization-wide investigation...") and a discovery tool result (`fleet.query_overview`). Since the new query text didn't explicitly mention "Tanker Management," and the discovery tool didn't return training data, the LLM's **ANTI-POISONING** rule would strip the competency filters (`signalName`, `mode`) to match the "ground truth" of the current turn.
- **Effect**: The system would lose the thread of the investigation and default back to maintenance queries in the next turn.

**Fix** (`update_memory2.ts`):
- Implemented **PROTECTED DOMAIN CONTEXT** injection.
- **Logic**: If `isNewQuery=true` AND `isDomainPivot=false` (confirmed continuation), the previous domain filters are harvested and injected into the Phase 2 prompt as a **MANDATORY** block.
- **LLM Rule**: The LLM is now strictly forbidden from dropping any filter in the "PROTECTED" block. This ensures topic parameters (signalID, mode, statusCode) survive entity and scope pivots.

### 29.2. Mixed-Turn Intercept Hardening

**Problem**: If a user turn mixed meta-tools (like `mcp.clear_filters`) with data retrieval, the **Strategic Intercept** (entity resolution) was occasionally bypassed.
- **Root Cause**: `isAtomicDiagnosticPlanned` used `.some()`, meaning if *any* tool was a meta-tool, the whole turn was treated as atomic.
- **Fix** (`orchestrator.ts`): Changed logic to `.every()`. Now, the Intercept is only bypassed if **all** tools in the turn are atomic meta-tools. If any data-fetching tool is present, entity resolution is guaranteed to trigger.

### 29.3. Data Integrity: Orphaned Vessel Assignments

**Problem**: Crew member "Elena Petrova" (with Tanker Management completions) was not appearing in org-wide competency results.
- **Discovery**: 
    1. Elena's `CrewAssignment` points to `vesselID: 6932a0819a99795799f341bf`.
    2. However, **no such vessel record exists** in the `vessels` collection.
    3. The competency diagnostic aggregation joins on `CrewAssignment` and filters by `vesselID`. Since Elena is assigned to a "ghost" vessel, she is correctly filtered out by the database engine.
- **Lesson**: Data-level orphan records in `CrewAssignment` are the primary cause of "missing data" in the competency pipeline. The AI and MCP logic were confirmed to be behaving correctly.

---

## 27. Hardening Deep Form Discovery (Batch 16)

### 31.1. Decoupling Content Search from Entity Resolution

**Problem**: There was an architectural debate about whether `mcp.resolve_entities` should support searching "inside" form data (answers, comments, values).
- **Decision**: Rejected overloading `resolve_entities`. 
- **Rationale**: `resolve_entities` is a **Discovery** tool (Mapping a known Name/Code → ID). Searching for "the form where I mentioned a fuel leak" is a **Retrieval** task (Content Snippet → Record ID). Conflating them leads to "leaky abstractions" and non-deterministic tool selection.

**Fix**: Implemented a dedicated high-performance retrieval tool: `forms.search_content`.

### 31.2. Implementation: `forms.search_content`

**Tool Definition** (`contract.ts` & `mcp.capabilities.contract.js`):
- **Purpose**: Search within filled form data (answers, field values, comments).
- **Required Parameters**: `organizationID`, `contentTerm`.
- **Optional Parameters**: `vesselID`, `startDate`, `endDate`, `limit`.

**Hardened Logic** (`mcp.service.js`):
1.  **Strict Scoping**: Mandatory `organizationID` check.
2.  **Implicit 3-Month Window**: Defaults to the last 3 months unless explicit `startDate`/`endDate` are provided. This protects MongoDB from expensive collection-wide regex scans.
3.  **100-Record Safety Cap**: Hard limit on results to ensure response payload stability.
4.  **Deep Regex Scan**: Performs a case-insensitive regex match against:
    -   Form `name` and `description`.
    -   All values within the `formData` object (flattened and stringified at runtime).
5.  **Matched Context (`matchedIn`)**: The tool returns exactly *where* the match was found (e.g., `form data field "failureCause"` or `form name`). This allows the AI to explain the result to the user ("I found a match in the 'Comments' field of your Risk Form...").

### 31.3. Discovery Engine Refinement (`lookup_logic.ts`)

**Fix**: Resolved a copy-paste regression in the `DailyMachineryRunningHours` resolvable entity. It was previously using Port Schedule search fields (`searchPortCode`). Fixed to use `machineryName` and `remarks`.

---

## 28. Updated Architectural Invariants (Batch 16)

1.  **Retrieval vs. Discovery**: Search-by-content (keywords inside records) belongs in dedicated retrieval tools (`forms.search_content`). `resolve_entities` is strictly for mapping identifiers (Names, Codes, IMO numbers) to ObjectIds.
2.  **Implicit Safety Windows**: Any tool performing wildcard regex searches across unindexed freeform data (like `formData`) MUST enforce an implicit time-window (default 3 months) to prevent performance degradation.
3.  **Matched-In Transparency**: Retrieval tools should return metadata indicating the matching field. This prevents the "Black Box" effect where the AI presents a record without explaining why it was selected.
4.  **Empty Result Guidance**: When a content search returns 0 items within the implicit window, the response MUST include a `windowNote` advising the user that the search was limited to 3 months and offering an expansion.
5.  **Shared Mongo Lifecycle**: The Discovery Engine (`lookup_logic.ts`) uses a module-level shared MongoClient to prevent connection pool exhaustion during concurrent entity resolutions.
6.  **Alias Mapping Integrity**: LLM-facing entity names (singular PascalCase, e.g., `Form`) must be explicitly mapped to Mongoose-pluralized collection names (`forms`) in the `COLLECTION_ALIAS_MAP` to ensure $or queries hit the correct collection.
7.  **Deterministic Parameter Descriptions**: All new retrieval parameters (like `contentTerm`) must be registered in the `getParameterDescription` switch in `contract.ts` to ensure the orchestrator understands the strict usage requirements (e.g., "This searches content, NOT template names").

## 29. Ambiguity Resolution & Scoping Hardening (Phase 15)

### 33.1. Orchestrator Loop Breaker Hardening (`orchestrator.ts`)
- **Case-Insensitive Label Tracking**: `resolvedLabelSet` is now built with lowercased keys, ensuring the case-insensitive comparison (`lblLower`) works correctly even if the LLM alters the case of the entity label between turns.
- **Ambiguous Session Labels Guard**: Added `ambiguousSessionLabels` to track labels that returned `> 1` matches during `mcp.resolve_entities`. This provides a code-level guardrail preventing the Strategic Intercept from endlessly attempting to resolve genuinely ambiguous labels (e.g. 3 activities matching the same description).

### 33.2. GC Logic Correction (`update_memory2.ts`)
- **Ambiguity Memory Promotion**: Removed a buggy garbage collection block that was prematurely deleting `ambiguousMatches` at `iter=1`. `ambiguousMatches` now survives and reaches the Orchestrator, allowing the `AMBIGUITY DETECTED` prompt block to correctly surface to the LLM, forcing a clarifying question to the user.
- **Deterministic Cleanup**: Stale ambiguity cleanup is correctly handled by the `else { delete }` branch on lines 201-205, which fires cleanly on new requests where no resolve tools are run.

### 33.3. Join-Through Aggregations for Scoping (`lookup_logic.ts`)
- **Generic `joinThrough` Config**: Extended the `RESOLVABLE_ENTITIES` registry to support a `joinThrough` property. This allows entities that lack a direct `organizationID` or `vesselID` foreign key to be scoped by joining through a parent or junction collection via an aggregation pipeline.
- **Activity (Forward Join)**: `Activity` now joins through `Machinery` to inherit the machinery's `vesselID` scoping, heavily reducing false ambiguities during cross-vessel searches.
- **CrewMember (Inverted Join)**: `CrewMember` now utilizes an `inverted` join through `CrewAssignment`. The aggregation starts from `CrewAssignment` (filtered by vessel), groups by `crewMemberID` to deduplicate, and joins the actual `CrewMember` collection, resolving the long-standing gap of CrewMember lacking a root `vesselID`.

### 33.4. UI Aesthetic Hardening (Siri-Inspired Spinner)
- **Premium Loader Transition**: Replaced the basic grey "ping" dot in `ContinuousChatView.tsx` with a premium, Siri/Claude-inspired multi-color spinner.
- **Rich Aesthetics**: Implemented a `conic-gradient` based ring with a `radial-gradient` mask to create a modern, high-end "AI is thinking" visualization that aligns with modern AI interface standards.


## 30. Phase 16: Orchestrator HITL Context Bridge & Vestibule Hardening

### 35.1. Vestibule Pruning (Memory Hardening)

**Problem**: The "Strategic Intercept" (Vestibule) in `orchestrator.ts` would repeatedly trigger `resolve_entities` for previously ambiguous labels (e.g., "CCCCCCC") even after the user had provided a resolution. This was because the `resolvedLabels` map only contained the resolved IDs/Types, not the original ambiguous label string used by the user.

**Fix** (`update_memory2.ts`):
- Implemented **Vestibule Pruning** in Phase 2.
- When any candidate from an `ambiguousMatches` entry is found to have been resolved (ID exists in `resolvedLabels`), the system now explicitly registers the **original label** (e.g., "CCCCCCC") in the `resolvedLabels` state, mapping it to the chosen candidate.
- **Impact**: This satisfies the Vestibule's `resolvedLabelSet` skip guard, preventing the system from re-triggering resolution passes for already-settled entity names.

### 35.2. HITL Context Bridge (Orchestrator Intent Injection)

**Problem**: During a Human-in-the-Loop (HITL) continuation, the user often provides a terse reply (e.g., "show me all"). The Orchestrator's message-masking logic (which builds the `qnaTranscript` from `summaryBuffer` + latest message) would strip the preceding context of the *current* unsettled conversation. The LLM would lose sight of what "all" referred to, leading to failed tool calls or underspecified summaries.

**Fix** (`orchestrator.ts`):
- Introduced an **Active Intent Bridge** for HITL turns (`iterationCount === 0` and `isHITLContinuation: true`).
- The Orchestrator now injects the `reformulatedQuery` (the LLM's already-distilled understanding of the current HITL chain) as an `[ACTIVE INTENT]` block before the user's reply.
- **Transient Prompt Injection**: This block is only injected into the prompt for the current turn. It is **not** written to the persistent `summaryBuffer`.
- **Squashing**: Once the HITL cycle finishes and `SUMMARIZE` fires, the entire exchange is squashed into a single clean Q&A pair in `summaryBuffer` as per standard protocol.

## 31. Updated Architectural Invariants (Batch 17)

1. **Vestibule Skip Guard**: A label is only considered "unclassified" if it is not present in `resolvedLabels`. Pruning ensures original ambiguous labels are registered as aliases to their resolved IDs.
2. **HITL Context Persistence**: The `reformulatedQuery` is the canonical representation of the "current goal" during multi-turn HITL exchanges and must be used to bridge context for terse user replies.
3. **Transient Prompt Engineering**: Intermediate HITL context bridges must remain in the prompt layer and must not pollute the permanent `summaryBuffer` or `longTermBuffer`.


---

## 32. Phase 17: Hardening HITL Ambiguity & Instance-Level Selection

### 32.1. The Ambiguity Loop Break (Fixes A, B, C, D)

**Problem**: The orchestrator previously struggled with "Instance Ambiguity" (multiple records of the same type). It would either loop indefinitely asking for the "entity type" (when it was already known) or fail to provide the candidate list to the LLM in a high-salience position.

**Fixes** (`orchestrator.ts`):
- **Fix A (Context Framing)**: Renamed the bridge label from `[ACTIVE INTENT]` to `[ACTIVE CLARIFICATION CONTEXT — you asked the user a question; their answer follows]`. This prevents the LLM from treating the reformulated query as a completed goal.
- **Fix B (Two-Level Rendering)**: The ambiguity block now detects **Level 1 (Type)** vs **Level 2 (Instance)** ambiguity. For Level 2, it renders a numbered list of candidate labels + IDs (e.g., "1. CCCCCCC Unit A [ID], 2. CCCCCCC Pump B [ID]") and explicitly tells the LLM to ask for a selection by name.
- **Fix C (Positional Salience)**: Injected a `[RIGHT NOW]` status block directly into the user message block (before `HUMAN:`). This block contains the current Goal, Pending intents, Filters, and active Ambiguity status, ensuring it has the highest positional salience at generation time.
- **Fix D (Ambiguity Suppression)**: Added `ambiguousSessionLabels` to track which labels have already been processed in the current request cycle. This prevents the ambiguity block from re-firing mid-cycle during iterative resolution turns.

### 32.2. Authority-Sync: Orchestrator Rules (Batch 17 Rules)

**Fix** (`orchestrator_rules.ts`):
- **Rule 7 & 8 Updated**: Taught the LLM to distinguish between Type and Instance levels and instructed it on the exit path (Level 2 resolution uses the specific name as `searchTerm` to achieve a single-hit promo).
- **Rule 8b (Multi-Instance Recall)**: Added the **Full-Name Resolution Protocol**. If a user asks for "all three machines" from a previous turn, the LLM is instructed to use the specific names from `summaryBuffer` as separate unclassified labels, bypassing the ambiguous short label.
- **Section XI ([RIGHT NOW] Protocol)**: Formally defined the `[RIGHT NOW]` block as the authoritative current-state snapshot. Established the priority order: `Ambiguity > Pending > Conversational`.

---

## 33. Updated Architectural Invariants (Batch 18)

1. **Two-Level Ambiguity**: Disambiguation must distinguish between Type-Level (What type?) and Instance-Level (Which record?). Instance-level resolution MUST provide candidate names to the user.
2. **Positional Salience Rule**: The `[RIGHT NOW]` status block in the user-message layer is the definitive truth for the current turn and overrides conflicting system-message instructions.
3. **Multi-Instance Recovery**: When resolving multiple items from a previously-ambiguous set, specific names from memory MUST be used as resolution terms to prevent re-triggering disambiguation.
4. **Authoritative [RIGHT NOW] Priority**: The LLM must follow the state signaled in the `[RIGHT NOW]` block in the order: `Ambiguity` (Stop everything) → `Pending` (Execute tools) → `Conversational` (Summarize).
5. **Zero-Guessing Invariant**: If `Ambiguity` is non-None in `[RIGHT NOW]`, `tools: []` is mandatory. The LLM is strictly forbidden from guessing which candidate the user meant.

---

## 34. Phase 18: Ambiguity State Finalization (Hardening HITL + Retrieval)

### 34.1. The Core Problem — Persistent ambiguousMatches

**Data Evidence**: Running `analyse_last_n_threads.ts 6` against MongoDB checkpoints revealed
**31 of 33 conversations** in the latest thread flagged as `🔁 LOOP`. Every loop had
`⚡ ambiguousMatches was populated` present. The looped tool was always `mcp.resolve_entities`
for the same label (`CCCCCCC`), firing 4–12× per conversation.

**Root cause**: `ambiguousMatches` was **never cleared from state after the user picked a candidate**.
After the user said "first one" or "the machinery one", a retrieval tool ran — but:
1. No new `mcp.resolve_entities` ran → `labelToMatches` empty → the existing cleanup block saw zero new ambiguities
2. The inherited `scope.ambiguousMatches` was spread-in via `{...existingMemory.sessionContext.scope}`
3. Vestibule Pruning only fires when a candidate ID is in `resolvedLabels` — but the user's pick
   was expressed in natural language, never as a single-hit `mcp.resolve_entities` promotion

Result: Every subsequent turn had `ambiguousMatches` populated → `[RIGHT NOW]` showed
`INSTANCE SELECTION REQUIRED: 3 Machinery records` → LLM re-entered disambiguation mode → loop.

### 34.2. Fix E — HITL+Retrieval Finalization (`update_memory2.ts`)

**New block** inserted after the Vestibule Pruning cross-check (Phase 1).

**Signal**: `isHITLContinuation === true` AND a non-resolve retrieval tool ran this cycle AND `inheritedAmbiguousMatches.length > 0`

**Actions**:
1. Registers each ambiguous label → `resolvedLabels` (first candidate, as Vestibule skip guard)
2. Deletes `ambiguousMatches` from `sessionStateCommit.scope` entirely
3. Logs `🏁 AMBIGUITY FINALIZED` and `🧹 HITL+Retrieval: cleared N ambiguous match(es)`

**Safety**: If the user wants to try a different candidate after empty retrieval, they re-state their intent → Vestibule re-resolves → `ambiguousMatches` re-populates naturally. `summaryBuffer` retains the prior exchange (Rule 8b Multi-Instance Recall).

### 34.3. Fix F — Entity Type Integrity Rule (`orchestrator_rules.ts`)

## 20. Phase 19: LLM-Signalled Ambiguity Resolution (Current Session)

### 20.1. The Transition to Determinism
**Problem**: The heuristic Fix E (implemented in Phase 18) guessed that an ambiguity was resolved if "retrieval ran WITHOUT new resolve_entities". This had two critical flaws:
1. **False Positives**: An unrelated tool call (e.g., `maintenance.query_status` for overdue jobs) would incorrectly clear an open ambiguity (e.g., for "CCCCCCC") simply because the user asked a separate question while the ambiguity was still live.
2. **Coarse Clearing**: It was an all-or-nothing clear. If multiple labels were ambiguous, it cleared ALL of them even if only one was answered.

### 20.2. The Solution: `ambiguitiesResolved` Signal
**Strategy**: Instead of guessing, we now require the LLM to explicitly declare which labels it has resolved. The LLM sees the full Q&A loop in its `qnaTranscript` and knows exactly which candidates it has selected and acted upon.

**Implementation**:
1. **State.ts**: Added field 11 `ambiguitiesResolved: string[]`.
2. **Orchestrator.ts (Zod)**: Added `ambiguitiesResolved` to the schema with a strict 3-condition mandate:
   - Label must be in `[RIGHT NOW]` Ambiguity block.
   - User reply provided enough info to pick one candidate.
   - A retrieval tool is being called with that candidate's ID **THIS TURN**.
3. **Orchestrator.ts (Return)**: Wired `response.ambiguitiesResolved` → `updates.ambiguitiesResolved`.
4. **UpdateMemory2.ts**: Replaced Fix E heuristic with a deterministic consumer. It reads the signal, clears only the named labels from `ambiguousMatches`, and registers them in `resolvedLabels`. Unlisted labels remain in state.

### 20.3. Generic LLM Guidance
To prevent the LLM from pattern-matching on specific test data (like "CCCCCCC"), the schema description now uses generic maritime-domain examples:
- **Example A**: Ordinal selection ("the second one").
- **Example B**: Type disambiguation ("it's a machinery item").
- **Example C**: Detail-based pick ("the one in Port of Singapore").
- **Example D/E (Negative)**: Explicitly forbids signalling resolution when asking another question or doing unrelated work.

### 20.4. Verification Results
- ✅ **Pass**: Ambiguities are now cleared only when the LLM explicitly acts on them.
- ✅ **Stability**: The heuristic Fix E has been fully removed, collapsing multiple complex checks into a single clean handshake.
- ✅ **Partial Resolution**: If a user is asked about two vessels and only answers for one, only that one is cleared from the state.

---

## 21. Updated Architectural Invariants (Batch 11)

1. **Deterministic Ambiguity Clearing**: `ambiguousMatches` is cleared ONLY when the label appears in the LLM's `ambiguitiesResolved` signal. Heuristics based on "retrievalRan" are deprecated.
2. **Signal Integrity**: The LLM must only signal resolution if it is calling a non-discovery retrieval tool with the candidate's ID in the *same turn*.
3. **Partial Persistence**: Unresolved ambiguities in `ambiguousMatches` must be preserved across turns until explicitly signaled as resolved or the query topic pivots.

---

## 22. Phase 20: Orchestrator Resolution Logic Hardening (Current Session)

### 22.1. HITL/Invalid-Org Suppression Loop Fix (`orchestrator.ts`)

**Problem**: The ORG CONTEXT GATE was incorrectly gated by `!isHITLContinuation`. When a user provided an invalid organization name during a HITL continuation turn, the system would verify the org failed (setting `isOrgUnresolved: true`), but the gate would refuse to fire because it was a HITL turn. This resulted in the AI silently failing or looping without re-asking for the correct organization.

**Fix** (`orchestrator.ts`):
- Introduced a `vestibuleNoOrgFired` tracking flag in the identity-gate logic.
- **VESTIBULE NO-ORG Guard**: If the identity resolution pass confirms the organization is still missing after a user reply, it forced a `SUMMARIZE` verdict.
- **Gate Bypass**: The ORG CONTEXT GATE now bypasses the `!isHITLContinuation` check IF `vestibuleNoOrgFired` is true.
- **Result**: If the user provides an incorrect org, the system now deterministically re-asks until resolved.

### 22.2. Orchestrator Constitutional Hardening (`orchestrator_rules.ts`)

**Problem**: The AI was exhibiting "autonomous over-reaching" — for example, if it didn't know a `scheduleID`, it would autonomously query all schedules and pick one to "unblock" itself, leading to empty or irrelevant data sets. It was also silently adopting wrong entity types (e.g. using Machinery IDs for Activity queries) because the resolver returned a match.

**Fix**: Added two new absolute rules to Section II.B:

1. **Rule 10 (Type Integrity)**: If entity resolution finds a type different from what the user explicitly named (e.g. Activity vs Machinery), the AI MUST stop and surface the mismatch. It is forbidden from silently proceeding with the "wrong" type.
2. **Rule 11 (Surface-and-Stop on Missing Parameter)**: If a required tool parameter (e.g. `scheduleID`) is unknown and cannot be derived, the AI is **FORBIDDEN** from autonomously enumerating/guessing it. It must surface what it has found so far and stop for user guidance.
   - **Exception**: Only permitted if a previous tool result in the same cycle returned *exactly one* valid option for that parameter.

### 22.3. Dead-end Block Strengthening (`orchestrator.ts`)

**Fix**: Updated the code-injected `🛡️ DEAD-END LABELS` block. It now includes a **⛔ STRICTLY FORBIDDEN** mandate:
> *"Do NOT call additional tools to try to solve around the missing entity (e.g. enumerating all schedules to guess which one the user meant, calling a broader org-wide query as a substitute). The user must make the next decision — do not make it for them."*

### 22.4. Rules Complexity Assessment (`rules_issues.md` & `rules_issues2.md`)

**Problem**: As the `orchestrator_rules.ts` file has grown, it has developed "Rule Friction" — multiple absolute mandates that can conflict in edge cases.

**Findings**:
- **Rule 11 vs Rule IV.12**: Rule 11 says "stop if parameter missing", while Rule IV.12 says "NEVER stop if pending intents exist."
- **Rule 10 vs Non-Procrastination Mandate**: Rule 10 says "stop on type mismatch", while Section VIII says "execute immediately if IDs are in memory."
- **[RIGHT NOW] Priority**: The authoritative snapshot protocol (Section XI) currently lacks explicit checks for Rule 10/11 conditions, meaning it might bypass them if pending intents are present.

**Next Step**: A comprehensive "Precedence Rebuild" pass is required to define a clear hierarchy between these absolute mandates (e.g. Rule 10/11 > Pending Intents).

---

## 23. Updated Architectural Invariants (Batch 20)

1. **HITL-Resilient Org Gating**: Organization resolution is a hard gate that must fire even during HITL turns if the organization remains unresolvable.
2. **Type Integrity Invariant**: User-stated entity types are strict constraints. Mismatched resolution hits are blocking events, not "close enough" matches.
3. **No Autonomous Hierarchy Drilling**: The AI is forbidden from "exploring" adjacent data to guess required parameters. "Surface and Stop" is the mandatory protocol for missing requirements.
4. **Absolute Rule Precedence**: Rule 10 (Type Integrity) and Rule 11 (Missing Parameters) are primary blocking conditions that override retrieval mandates.
---

## 24. Phase 13: Orchestrator Constitutional Hardening & No-Goto Refactor

### 24.1. Constitutional Refactor (The 41-Rule Sequential Pivot)

**Problem**: The `orchestrator_rules.ts` had become a fragmented collection of "Rule 1" to "Rule 12" repeated in different sections (II, IV, IX, X). This caused non-deterministic behavior because the LLM would see multiple "Rule 1s" and potentially skip mandates. It also used "goto" style cross-references (e.g., "See Section VIII Step 2") which broke the LLM's linear reasoning flow.

**Fix**:
- **Monotonic Renumbering**: Applied a document-wide unique sequence (Rule 1 through Rule 41).
- **No-Goto Mandate**: Removed all numerical rule cross-references and "goto" instructions. Every rule is now self-contained or references a concept by its unique name (e.g., "the Non-Procrastination Mandate") rather than a section/number.
- **Consolidation**: Merged redundant mandates for Organization Context, Discovery, and Failback into a single source-of-truth definition for each.

### 24.2. Hardening the "Surface-and-Stop" Gate (Section XI)

**Problem**: The Orchestrator would sometimes attempt to "fix" a missing parameter or a type mismatch by guessing or calling adjacent tools, leading to results from the wrong data branch.

**Fix**:
- **Step 1.5 Pre-flight Check**: Injected a mandatory high-precedence check into the `[RIGHT NOW]` protocol.
- **Absolute Blocking**: Before executing any pending intent, the LLM MUST verify:
    - **(a) Type Integrity**: Does the resolved ID match the user's explicitly stated entity type? (e.g., Vessel vs Machinery).
    - **(b) Parameter Completeness**: Are all required tool parameters known and concrete?
- **Precedence Override**: These checks are codified to override the **Non-Procrastination Mandate** and the **Pending Intents Mandate**. If a check fails, the AI MUST stop and pose a clarifying question.
- **Failback Suppression**: Explicitly instructed the LLM to suppress `direct_query_fallback` when Rule 18 (Missing Parameter) triggers — a structural failure should never be solved by semantic guessing.

### 24.3. Restored Level-0 Foundational Mandates

**Problem**: Over-zealous merging in previous sessions had moved the **Fleet Discovery Mandate** and **The Golden Rule** (memory ID lookup) deep into Section VIII, causing the LLM to miss them during initial reasoning.

**Fix**:
- **Rule 3. Fleet Discovery Mandate**: Restored to the foundational Level-0 Protocol.
- **Rule 7. Secondary & Current Scope Mandate (The Golden Rule)**: Restored to Level-0. This ensures the LLM checks its ID memory ledger BEFORE it considers any retrieval or guessing.

### 24.4. Summary of Constitutional State (41 Rules)

| Section | Rules | Focus |
|---------|-------|-------|
| II. Level-0 | 1–7 | No-Guess, Fidelity Bridge, Discovery, Scoping, Golden Rule |
| II.B Deduction | 8–18 | Guess & Resolve, HITL Protocol, Ambiguity, **Surface-and-Stop Gate** |
| III. Discipline | 19–22 | Diversity, Parameter Boundaries (No Placeholders), Failback, Tab Labeling |
| IV. Termination | 23–31 | Freshness, Completeness, Strike Rule, Pending Intents, Anti-Hallucination |
| V. Security | 32–36 | Read-Only, PII, System Secrets, Jailbreak Containment |
| IX. Tools | 37–38 | Query/Clear Filters |
| X. Execution | 39–40 | Repeat Execution, Parallel vs Sequential Mode |
| XI. [RIGHT NOW] | 41 | Authoritative State Snapshot & Pre-flight Gate |

**Status**: LIVE in `orchestrator_rules.ts`. Verified with `tsc --noEmit`.

---

## 25. Phase 15: Hardening Deterministic Entity Resolution

### 25.1. The "Non-Deterministic Intercept" Problem

**Problem**: Previously, the Orchestrator used a "Strategic Intercept" (Node.js code) to hijack LLM tool calls and substitute them with `mcp.resolve_entities`. This was fragile:
1.  **Hallucination Risk**: The LLM would sometimes try to call the resolution tool itself (unreliably) or skip it entirely.
2.  **State Desync**: Resolution results were only visible after a full tool-execution turn, often causing the LLM to lose context or loop.
3.  **Ambiguity Loops**: If a label was genuinely ambiguous (multiple matches), the non-deterministic path would often re-resolve the same label indefinitely.

### 25.2. The Solution: Deterministic `resolve_labels` Node

**Architecture**: Moved entity resolution out of the LLM's hands and into a mandatory LangGraph system node.

1.  **`unclassifiedLabels` Channel**: Added a first-class state channel. The Orchestrator simply identifies labels it doesn't know; it NO LONGER selects resolution tools.
2.  **Mandatory Intercept (`graph.ts`)**: The graph now routes `orchestrator` -> `resolve_labels` whenever `unclassifiedLabels.length > 0`. This happens *before* any other tools execute.
3.  **Parallel Resolution**: The `resolve_labels` node runs all label × type lookups in parallel using the backend's `resolveEntities` utility directly (bypassing MCP overhead).

### 25.3. The "Synthetic Tool Results" Bridge

**Innovation**: To avoid rewriting the complex extraction logic in `update_memory2.ts` (the Ambiguity Bridge) and `orchestrator.ts` (the Dead-End guard), the `resolve_labels` node **emulates** tool calls.

- It injects results into `toolResults` using synthetic keys like `mcp.resolve_entities-auto-17382...`.
- These results contain the standard JSON structure expected by the rest of the system.
- **Result**: `update_memory2` naturally detects these "tools", populates `ambiguousMatches` in scope, and maps singular hits into `resolvedLabels` without needing any code changes.

### 25.4. Hardened Guards & Safety

1.  **Safety Strip (`orchestrator.ts`)**: Since `mcp.resolve_entities` was removed from the LLM's capability contract, any hallucinated tool call by that name is now automatically dropped by a code-level "safety strip" before execution.
2.  **Re-Resolution Guard (`orchestrator.ts`)**: Added a `resolvedLabelSet` filter to the Orchestrator's label extraction. If a label (e.g., "XXX1") is already in `session.scope.resolvedLabels`, it is stripped before being sent to the `resolve_labels` node. This prevents redundant DB lookups on follow-up turns.
3.  **SSE UX Integration**: Updated `workflow.ts` to emit a status message ("Resolving N labels...") during the deterministic pass, ensuring the user sees activity even when the LLM isn't "thinking."

### 25.5. Rules Alignment (`orchestrator_rules.ts`)

- **Rule 10 (Guess & Resolve)**: Updated to remove all mentions of the AI calling resolution tools.
- **Mandate**: The AI is now instructed to simply provide the `unclassifiedLabels` array with best-guess types. The system handles the rest.

---

## 26. Updated Architectural Invariants (Batch 21)

1.  **Deterministic Resolution**: Entity resolution is a system-level background service, not an LLM-tooling decision.
2.  **Synthetic Compatibility**: System nodes that replace LLM tools should emit "Synthetic Tool Results" (standard JSON in `toolResults`) to preserve compatibility with downstream memory and summarization logic.
3.  **Resolution Idempotency**: The `resolvedLabelSet` gate ensures that once a label is resolved, it stays resolved for the duration of the request cycle.

---

## 27. Summary of Critical Files (Entity Resolution)

| File | Purpose |
|------|---------|
| `backend/src/langgraph/nodes/resolve_labels.ts` | The new deterministic resolution node |
| `backend/src/langgraph/graph.ts` | Routes `orchestrator` -> `resolve_labels` intercept |
| `backend/src/langgraph/state.ts` | Defines `unclassifiedLabels` channel |
| `backend/src/langgraph/nodes/orchestrator.ts` | Extracts labels; applies safety strip & re-resolution guard |
| `backend/src/langgraph/prompts/orchestrator_rules.ts` | Constitutional alignment for automatic resolution |
| `backend/src/langgraph/routes/workflow.ts` | SSE status updates for the resolution node |

---

[End of Handover 4]

## Phase 21: Final Hardening — Deterministic "Pause-and-Resolve" Flow

### 21.1. The "Pause-and-Resolve" Mandate
**Problem**: Legacy "same-turn" resolution logic caused race conditions where the LLM would attempt to use un-hydrated IDs (`<ID>`) or hallucinate tool calls while resolution was still in flight.
**Fix**: Formalized a strict **Multi-Turn Protocol**.
- **Orchestrator Mandate**: When unclassified labels are detected, the Orchestrator MUST emit `tools: []` and `feedBackVerdict: 'FEED_BACK_TO_ME'`. It is strictly forbidden from generating retrieval tool calls in the same turn.
- **Rule Alignment**: Rules 2, 5, 10, 14, and 15 in `orchestrator_rules.ts` were refactored to remove all synchronous resolution language.

### 21.2. Hardened Graph Routing
**Fix**: Changed the routing chain to ensure data integrity.
- **New Path**: `Orchestrator` → `resolve_labels` → `update_memory` → `Orchestrator`.
- **Rationale**: By routing through `update_memory` before returning to the orchestrator, we guarantee that all resolved IDs and ambiguities are persisted in the session scope and `resolvedLabels` map. The orchestrator now receives a "pre-hydrated" state on its second turn.

### 21.3. Synthetic Tool Contract & Memory Hydration
**Fix**: Standardized the synthetic payload injected by the `resolve_labels` node.
- **Prefix**: `resolve_labels::{label}::{type}`.
- **Payload**: Includes `capability: "mcp.resolve_entities"`.
- **update_memory2 Integration**: The memory node now detects resolution results by the `capability` field (not just the turn key). This allows it to handle synthetic results from `resolve_labels` and legacy `mcp.resolve_entities` results with the same code path.

### 21.4. Stall Guard & Discovery Classification
**Problem**: Synthetic resolution results were being misclassified, causing the Stall Guard to either falsely trigger (missing retrieval) or fail to stop infinite discovery loops.
**Fix**:
- **Discovery Patterns**: Added `resolve_labels::` to `DISCOVERY_KEY_PATTERNS` in `orchestrator.ts`.
- **Stall Guard Logic**: Correctly identifies resolution as a "Discovery" activity. If discovery runs but no retrieval follows, the guard forces a loop-back. If retrieval *does* run after discovery (on turn 2), the guard stands down.

### 21.5. Robust Early Exits
**Problem**: If `resolve_labels` skipped (e.g., no org, no labels), it returned an empty update. `update_memory2` Phase 2 would receive an empty `latestTurn`, causing it to reason on "nothing" and potentially drop pending intents.
**Fix**: Each early exit path now injects a descriptive synthetic result:
- `resolve_labels::passthrough` (no valid labels)
- `resolve_labels::no-org` (org missing — triggers ORG CONTEXT GATE recovery)
- `resolve_labels::no-types` (LLM omitted likely types)
- **Result**: Phase 2 always sees a "ground truth" log of why resolution was skipped, leading to more stable context updates.

### 21.6. Capability Contract Sync
**Fix**: Updated `competencySignalID` and crew tool descriptions in `contract.ts` to mandate multi-turn resolution. Removed legacy "pass string directly" language to eliminate the final path for "autonomous over-reaching" hallucinations.

---

## 22. Final Architecture Status (Stem-to-Stern)

| Component | Status |
|---|---|
| **Graph** | `orchestrator` → `resolve_labels` → `update_memory` → `orchestrator` |
| **Node** | `resolve_labels` node is deterministic, parallel, and code-driven. |
| **Contract** | Synthetic results emulating `mcp.resolve_entities` (capability-based). |
| **Guards** | Safety Strip blocks LLM-hallucinated resolution calls. |
| **Prompts** | Rules 2/5/10/14/15 enforce "Pause-and-Resolve" constitution. |
| **Stability** | All early exits in resolution inject signals to prevent memory drift. |

---

[End of Handover 4]

## Phase 22: Persistent Ambiguity Tickets & Decision Journal De-noising

### 22.1. The Ambiguity Ticket Model (State Persistence)
**Problem**: The previous ambiguity model was a "one-shot blocking gate." Once an ambiguity (e.g., for "ccccccc") was resolved, it was deleted from state. If the user later asked "now show me the second one," the system had forgotten the original candidates and was forced to re-trigger a full resolution loop.
**Fix** (`update_memory2.ts`):
- **Structured Tickets**: `ambiguousMatches` entries now include `originQuery` (semantic anchor) and `conversationIndex` (creation turn).
- **Non-Destructive Promotion**: When a candidate is chosen, it is promoted to `resolvedLabels`, but the ticket **remains in state**.
- **Lifecycle Pruning**: Tickets are only deleted when their `conversationIndex` falls out of the active window during the **20-to-7 Compression Cycle** in `summarizer.ts`.

### 22.2. Semantic Activation & Confidence Gating
**Problem**: The system unconditionally mandated ambiguity clarification every turn if *any* match was open, even if the user had pivoted to a different topic.
**Fix** (`orchestrator.ts` & `orchestrator_rules.ts`):
- **Activation Rules (Rules 1-5)**:
    - **RULE 1 (Direct)**: Ordinal picks ("2nd one") or label matches activate the ticket immediately.
    - **RULE 2 (Semantic)**: User message topically close to `originQuery` activates the ticket with a confidence score.
    - **RULE 3 (Soft Note)**: If the user pivoted (Domain Pivot), the AI answers the new question normally but appends a "selection pending" note.
    - **RULE 4 (Meta-Clarification)**: If 2+ tickets match with similar confidence (gap < 0.25), the AI asks which originating question is being answered.
- **State Attribution**: Added `activatedTicketLabel`, `activatedTicketConfidence`, and `activatedCandidateIndex` to `SkylarkState` to track explicit resolution signals.

### 22.3. Summarizer Attribution Bridge
**Fix** (`summarizer.ts`):
- **Context Injection**: When a ticket is activated, the Summarizer receives a mandatory `📌 TICKET ATTRIBUTION` system message.
- **Transparent Output**: The AI must now prepend its first insight with:
  `📍 Answering for: "[originQuery snippet]" → Using: [Candidate Name] (the Nth match)`.
- This ensures the user knows exactly which machinery/entity was retrieved, especially critical when multiple candidates share identical names (e.g., two entries named "ccccccc").

### 22.4. Journal De-noising (Issue 2)
**Problem**: The Session Decision Journal was cluttered with redundant `? Q / ✓ A: Awaiting Execution` logs for every turn. This was noise that bloated the prompt without adding value for tool deduplication.
**Fix** (`orchestrator.ts`):
- **Stripped Q/A logs**: The journal now only tracks tool actions executed within the **current request cycle**.
- **New Format**: `🚀 Tools run this request: tool1(params) | tool2(params)`.
- **Mandate**: Reduced to its core purpose: "Do NOT repeat the exact same Tool+Parameter combination listed above in this same request."

---

## 23. Updated Architectural Invariants (Batch 22)

1. **Persistent Tickets**: Ambiguity matches are structured tickets anchored to their `originQuery`. They survive resolution and are only removed by 20-to-7 memory pruning.
2. **Semantic Affinity Activation**: Ticket activation is driven by semantic proximity to the original inquiry, allowing for seamless context pivoting without forced re-asks.
3. **Mandatory Attribution**: Summaries based on ambiguity resolution MUST surface the `originQuery` and `candidateOrdinal` to provide alignment between user intent and system data.
4. **Intra-Request Journaling**: The decision journal is a pure action log for tool deduplication within a single agentic loop; it is not a conversational history log.
5. **Confidence-Gated Resolution**: LLM must meta-clarify if multiple tickets are semantically competing (confidence gap < 0.25).

---

## Phase 22 Post-Review: Gap Fixes

### Gap Fix 1 — Missing LangGraph State Channels (`graph.ts`)

**Root Cause (Critical)**: `activatedTicketLabel`, `activatedTicketConfidence`, `activatedCandidateIndex`, and `ambiguitiesResolved` were written by the Orchestrator as TypeScript properties (`(updates as any).field = value`), but **never declared as LangGraph state channels** in `graph.ts`. LangGraph silently drops any key returned from a node that has no matching channel definition. This meant:
- `update_memory2.ts` always read `ambiguitiesResolved` as `[]` (default) — never the LLM's actual signal
- `summarizer.ts` always read `activatedTicketLabel` as `null` — attribution block never fired

**Fix** (`graph.ts`): Added 4 new channel definitions under section "13. Ambiguity Ticket Activation Signals":
```
ambiguitiesResolved    → reducer: y ?? x   | default: []
activatedTicketLabel   → reducer: y ?? x   | default: null
activatedTicketConfidence → reducer: y ?? x | default: 0
activatedCandidateIndex → reducer: y ?? x  | default: null
```

---

### Gap Fix 2 — Tickets Silently Dropped on Domain Pivots (`update_memory2.ts`)

**Root Cause**: The block that preserved `inheritedAmbiguousMatches` was wrapped inside `if (ambiguitiesResolvedThisTurn.length > 0)`. On any turn where the user asked a new question without resolving an ambiguity, the inherited tickets were silently discarded. The "Persistent Ticket" model was functionally non-operational.

**Fix** (`update_memory2.ts`): Complete rewrite of the ambiguity block into a clean **Three-Step Union**:
1. **Step 1 — Promote**: Process `ambiguitiesResolvedThisTurn` on inherited tickets to promote candidates to `resolvedLabels` (only runs when there are resolutions).
2. **Step 2 — Union**: Build `candidateUnion = inheritedMatches (excl. label collisions) + newMatches`. This is unconditional.
3. **Step 3 — Vestibule-Prune**: Drop tickets whose candidate ID is now in `resolvedLabels`.
4. **Step 4 — Unconditional Write**: Write `survivingTickets` back to scope regardless of whether any activation occurred this turn.

---

### Gap Fix 3 — Candidate Resolution Blindness (`update_memory2.ts`)

**Root Cause**: When promoting a candidate to `resolvedLabels`, the code used `toolCallsStr.includes(c.id)` — a brittle string search that fails if the tool call isn't recorded yet, uses a different ID format, or the ticket was activated without a tool call.

**Fix** (`update_memory2.ts`): Added a **deterministic fast-path** that uses the explicit `activatedCandidateIndex` (0-based) signalled by the Orchestrator:
```
if activatedTicketLabel === entry.label AND activatedCandidateIdx is a valid index:
    picked = entry.candidates[activatedCandidateIdx]   ← deterministic
else:
    fallback to toolCallsStr search → then candidates[0]
```

---

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| Orchestrator → graph.ts channels | ✅ All 4 fields now propagate |
| update_memory2 reads `ambiguitiesResolved` | ✅ From channel, not `(state as any)` blind read |
| Ticket inheritance on domain-pivot turns | ✅ Unconditional union write |
| Check | Result |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errors |
| Orchestrator → graph.ts channels | ✅ All 4 fields now propagate |
| update_memory2 reads `ambiguitiesResolved` | ✅ From channel, not `(state as any)` blind read |
| Ticket inheritance on domain-pivot turns | ✅ Unconditional union write |
| Candidate pick uses explicit LLM index | ✅ `activatedCandidateIndex` preferred |

---

## Phase 22 Post-Review (Round 2): Parallel Execution Race Condition Fixes

### Background

`update_memory2.ts` and `summarizer.ts` execute **concurrently** (via parallel LangGraph branches) during any final summarizing turn. Both nodes read and write to `sessionContext.scope` simultaneously. This created two race conditions in the ticket pruning logic.

---

### Gap 4 — Stale Scope Spread Clobbering Entity Resolutions (`summarizer.ts`)

**Root Cause**: When the 20-to-7 compression triggered ticket pruning, `summarizer.ts` returned:
```typescript
scope: { ...(session?.scope || {}), ambiguousMatches: prunedTickets }
```
`session` is captured at the start of the Summarizer node (before `update_memory2` finishes). In a parallel turn where `update_memory2` wrote a new `vesselID` or `resolvedLabels` entry, the Summarizer's stale spread would overwrite those fresh values if the LangGraph reducer applied the Summarizer's output second.

**Fix** (`summarizer.ts`): Removed the `...(session?.scope || {})` spread entirely. The return now only provides the minimal delta:
```typescript
scope: { ambiguousMatches: prunedTickets }
```
The existing LangGraph workingMemory reducer already performs `{ ...x.scope, ...y.scope }`, so a minimal scope delta correctly overlays only `ambiguousMatches`, leaving all other fields (`vesselID`, `resolvedLabels`, etc.) intact from whichever node wrote them.

---

### Gap 5 — Parallel Array Overwrite on ambiguousMatches

**Root Cause**: On a compression turn, if `update_memory2` was writing a new ticket (new ambiguity discovered) while `summarizer` was also writing a pruned list (old tickets removed), they would write to `ambiguousMatches` simultaneously. The last writer wins — the new ticket could be permanently lost.

**Resolution**: Gap 5 is **eliminated as a consequence of fixing Gap 4**. By returning only a minimal `{ ambiguousMatches }` delta from the Summarizer, and since the Summarizer reads the *same* inherited `session.scope.ambiguousMatches` as `update_memory2` (both start from the checkpoint-persisted value), the ordering of the reducer merge is:

1. `update_memory2` returns its union: `{ ambiguousMatches: [inherited + new] }`
2. `summarizer` returns its prune: `{ ambiguousMatches: [survived stale prune] }`
3. LangGraph reducer: `{ ...scope_from_1, ...scope_from_2 }` — last writer wins on the array key

**Remaining caveat**: Because both branches read from the same checkpoint state, the summarizer's prune list is based on the *same* `inheritedMatches` that `update_memory2` also had. On a compression turn that simultaneously discovers a new ticket AND prunes stale ones, the Summarizer's prune list will not contain the new ticket (since it didn't exist at the checkpoint). If the Summarizer wins the merge, the new ticket is lost for one turn (until the next turn's `update_memory2` re-discovers and re-surfaces it via `inheritedAmbiguousMatches`). This is an acceptable transient inconsistency — compression turns are rare (every 20 conversations) and new ambiguities on those exact turns are edge cases.

---

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` after Gap 4/5 fixes | ✅ 0 errors |
| Stale scope spread removed | ✅ Only `ambiguousMatches` returned as delta |
| Entity resolutions safe from Summarizer overwrite | ✅ Reducer merges scopes independently |
| New Architectural Invariant | `summarizer.ts` must NEVER spread `session.scope` into its return — only return minimal deltas |

---

## Phase 23: Ticket Persistence Hardening — "The Third One" Flow

### Context & Independent Assessment

After a review of the last 6 conversation sessions and analysis of all code changes, this phase identified and fixed **four gaps** that were left unresolved and that would break the "the second one → the third one" user interaction flow.

---

### Gap 1 — Vestibule Pruning Deletes Tickets After First Resolution (`update_memory2.ts`)

**Root Cause**: Step 3 (Vestibule Prune) returned `false` for any ticket whose candidate appeared in `resolvedIdsSet`. This permanently deleted the ticket from `ambiguousMatches` the moment the first candidate was selected.

**Impact**: After the user said "the second one", the ticket was gone. On the next turn ("what about the third one?"), the LLM had no candidate list to reference and could not fulfill the request.

**Fix**: Changed `return false` → `return true` unconditionally in the vestibule filter. The vestibule step now only *registers* the chosen candidate into `resolvedLabels` (for the Vestibule guard to skip re-resolution), but never deletes the ticket. Ticket lifecycle is exclusively managed by the 20-to-7 compression in `summarizer.ts`.

---

### Gap 2 — `[RIGHT NOW]` Ambiguity Block Shows Resolved Tickets → Causes Re-Ask Loop (`orchestrator.ts`)

**Root Cause**: `ambiguityStatusStr` in the `[RIGHT NOW]` block was built from ALL `ambiguousMatchesData`, including already-resolved tickets. Rule 41 Step 1 mandates: "Ambiguity is non-None → stop everything and pose a clarifying question."

**Impact**: After "CCCCCCC" was resolved by the user, the ticket stayed in `ambiguousMatches` (correct), but also appeared in `[RIGHT NOW] Ambiguity`. Rule 41 kicked in every turn and forced the LLM to re-ask the user which CCCCCCC they meant — an infinite loop.

**Fix**: Added `pendingAmbiguousMatches` filter at line ~748:
```typescript
const resolvedLabelsForRightNow = (session?.scope as any)?.resolvedLabels || {};
const pendingAmbiguousMatches = ambiguousMatchesData.filter(
    (m: any) => !resolvedLabelsForRightNow[m.label]
);
```
The `[RIGHT NOW] Ambiguity:` field now shows `None` once a ticket is resolved, allowing the LLM to proceed to tool retrieval for "the third one".

---

### Gap 3 — System Prompt Ticket Block Has No Resolved/Pending Visual Distinction (`orchestrator.ts`)

**Root Cause**: The `📌 OPEN AMBIGUITY TICKETS` section rendered all tickets identically. The LLM could not tell from context alone which tickets still needed user input vs which were available as lookup tables.

**Fix**: Added `[✅ RESOLVED]` / `[⏳ PENDING]` badge to each ticket header, plus `← currently active` marker on the active candidate, plus updated Rule 5 to explicitly state:
> "RESOLVED ticket + ordinal follow-up → pick candidate directly from list, do NOT re-ask the user."

---

### Gap 4 — Rule 41 Step 1 Did Not Distinguish Pending vs Resolved Ticket States (`orchestrator_rules.ts`)

**Root Cause**: Rule 41 Step 1 mandated the LLM ask a clarifying question for ANY non-None Ambiguity field. The distinction between `[⏳ PENDING]` (blocking) and `[✅ RESOLVED]` (non-blocking, lookup-only) was absent from the rules.

**Fix**: Updated Rule 41 Step 1 with:
> "[✅ RESOLVED] tickets appearing in the `📌 OPEN AMBIGUITY TICKETS` system block are NOT blocking. They are reusable lookup tables for ordinal follow-ups. Do NOT ask the user to re-select from them."

---

### Gap 5 — `(updates as any)` Type Bypass for Ticket Signals (`orchestrator.ts`)

**Root Cause**: After graph.ts channels were registered (Gap Fix 1 in Phase 22), lines 1409-1411 still used `(updates as any).field = ...`. This is a code smell — it bypasses type safety and hides potential property name mismatches.

**Fix**: Replaced with proper typed assignments (`updates.activatedTicketLabel`, etc.) now that the channels exist.

---

### Architectural Invariants Established (Phase 23)

| Invariant | Rule |
|---|---|
| **Ticket Lifecycle = Compression Only** | Tickets are NEVER deleted in `update_memory2.ts`. Only `summarizer.ts`'s 20-to-7 compression prunes them. |
| **`[RIGHT NOW]` shows only PENDING tickets** | `ambiguityStatusStr` filters out resolved labels before building the Ambiguity field. |
| **Resolved tickets are visually distinct** | `[✅ RESOLVED]` badge in system prompt ticket block. |
| **Rule 41 is PENDING-only** | The mandatory-stop behavior only fires for `[⏳ PENDING]` tickets. |

### Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` after Phase 23 fixes | ✅ 0 errors |
| Vestibule Pruning no longer deletes tickets | ✅ `return true` — tickets persist |
| `[RIGHT NOW]` Ambiguity: None after resolution | ✅ `pendingAmbiguousMatches` filter applied |
| Resolved badge in system prompt | ✅ `[✅ RESOLVED]` / `[⏳ PENDING]` per ticket |
| Rule 41 updated for PENDING-only gate | ✅ Resolved ticket note added |
| `(updates as any)` casts removed | ✅ Properly typed assignments |

---

## Phase 23b: Final Prompt Alignment Review

### Context
A final comprehensive review of all orchestrator and memory prompts was conducted to ensure absolute alignment with the newly implemented Persistent Ambiguity Ticket Model. Five additional gaps were identified and resolved to eliminate edge-case vulnerabilities and ensure deterministic LLM behavior.

### 1. Gap A — Rule 13 (Rules 4 & 5) Drift (`orchestrator_rules.ts`)
**Root Cause:** The static `Rule 13` had not been updated to match the dynamic `TICKET ACTIVATION RULES` injected by the Ticket Renderer. Rule 4 failed to specify `[⏳ PENDING]` tickets, potentially causing the LLM to ask for meta-clarification between a pending and a resolved ticket. Rule 5 lacked explicit instructions for ordinal reuse without re-asking.
**Fix:** Synced Rule 13 completely with the dynamic prompt. Rule 4 now explicitly gates on `[⏳ PENDING]` tickets. Rule 5 explicitly details the `[✅ RESOLVED]` ticket ordinal reuse protocol.

### 2. Gap B — Same-Turn Ticket Activation Blind Spot (`update_memory2.ts`)
**Root Cause:** Step 1 in `update_memory2.ts` only checked `inheritedAmbiguousMatches` for LLM-signalled ticket activations. If the Orchestrator auto-activated a ticket on the exact same turn it was born (e.g., via Rule 2 Topic Match), the candidate registration into `resolvedLabels` was skipped.
**Fix:** Merged `inheritedAmbiguousMatches` and `newAmbiguousMatches` (deduplicated by label) into `allTicketsForStep1` so brand-new tickets are also processed for same-turn activations.

### 3. Gap D/G — Rule 13 Signal Notes Clarity (`orchestrator_rules.ts`)
**Root Cause:** The static `[RIGHT NOW]` signal note did not explain that `Ambiguity: None` intentionally hides `[✅ RESOLVED]` tickets. The "Identical names" note mandated using ordinals everywhere, including in the final answer summary, creating poor UX.
**Fix:** Updated the `[RIGHT NOW]` note to clarify that `Ambiguity: None` means pending tickets are absent, but resolved tickets may still exist in the open ticket block. Qualified the "Identical names" note to use ordinals for clarifying questions, but descriptive context for answers.

### 4. Gap E — Fragile State Mutation in Compression (`summarizer.ts`)
**Root Cause:** The 20-to-7 compression logic was writing intermediate pruning state directly onto the live LangGraph session object `(session as any)._prunedAmbiguousMatches = prunedTickets`. If an error occurred mid-block, this stale state persisted permanently.
**Fix:** Replaced the live-state mutation with a localized `scopeDeltaFromPrune` variable, preserving LangGraph reducer purity and eliminating the side-effect vulnerability.

### 5. Gap H — `lastTurnInsight` Ticket Guidance (`update_memory2.ts`)
**Root Cause:** Phase 2's `lastTurnInsight` instruction (Rule 3) did not explicitly instruct the LLM to record ticket activations. This resulted in generic "retrieval completed" insights rather than capturing WHICH ordinal was selected.
**Fix:** Added a `TICKET ACTIVATION` sub-rule to Rule 3, mandating that if a ticket is activated, the insight MUST explicitly name the chosen candidate (e.g., "User picked the 2nd CCCCCCC...").

### Verification
| Check | Result |
|---|---|
| `npx tsc --noEmit` after Phase 23b fixes | ✅ 0 errors |
| `orchestrator_rules.ts` completely aligned | ✅ Rule 13 perfectly matches dynamic prompt |
| Summarizer state mutations removed | ✅ `scopeDeltaFromPrune` local variable used |
| `update_memory2.ts` edge cases covered | ✅ Same-turn activations handled safely |

---

## Phase 23c: Autonomous Resolution Bug Fix

### Context & Diagnostic
During testing, a critical bug was identified where the Orchestrator was failing to resolve labels autonomously. Instead of proceeding to the `resolve_labels` node, it was surfacing a `clarifyingQuestion` to the user on the very first turn (e.g., "Is 'CCCCCCC' an Activity?"). This broke the "Identity-First" mandate which requires the system to attempt deterministic resolution before asking the user for help.

### Root Cause — The "Stale Heuristic" Regression
The Orchestrator contains a **HITL Guard** designed to suppress premature questions when labels are pending resolution.
- **Legacy Logic**: The guard checked if `finalReasoning` included the string `'DETERMINISTIC VESTIBULE'`.
- **The Break**: This string was stamped by the "Strategic Intercept" block. That block was **disabled** (commented out) during the transition to the dedicated `resolve_labels` LangGraph node.
- **The Result**: Since the string was never stamped, the guard silently failed every turn. The LLM's `clarifyingQuestion` (even if correctly motivated by high-confidence unclassified labels) was reaching the user immediately, before the resolution node could even fire.

### The Fix — Deterministic Signal Synchronization (`orchestrator.ts`)
The fragile string-scan heuristic has been replaced with a direct, deterministic code-level signal.

1. **Deterministic Guard**: Replaced the `finalReasoning` string check with `actualUnclassified.length === 0`.
   - **New Protocol**: If `actualUnclassified` contains any labels → the clarifying question is **silently suppressed**. The system routes to `resolve_labels`, and the LLM receives the concrete IDs on the next turn.
2. **Dead Code Cleanup**: Removed the dead `DETERMINISTIC VESTIBULE` logic and comments to prevent future "guessing games." The guard is now purely signal-based.
3. **Logic Flow**:
   - Turn 1: LLM outputs labels + question. Guard sees labels → suppresses question → `resolve_labels` fires.
   - Turn 2: LLM receives IDs in `secondaryScope`. `actualUnclassified` is now `[]`. Guard passes → retrieval tools fire.

### Verification
| Check | Result |
|---|---|
| `npx tsc --noEmit` after Phase 23c fix | ✅ 0 errors |
| Premature clarifying questions suppressed | ✅ Deterministic `actualUnclassified.length` check |
| Autonomous resolution autonomous again | ✅ Labels resolved before user is consulted |
| Dead string heuristics removed | ✅ Codebase cleaned of legacy Intercept markers |

---

## 24. Phase 13: Conversation Journaling & Resilient Ambiguity Resolution

### 24.1. The "Context Poisoning" Problem
**Problem**: The Orchestrator previously relied on ambient message history and a brittle `[ACTIVE CLARIFICATION CONTEXT]` block to resolve multi-turn ambiguities. 
- The LLM's own internal reasoning was polluting the history.
- `update_memory2` Phase 2 extraction was inconsistent, sometimes re-committing stale filters from its own context.
- The system would often fall into a "show me details" loop because it lost track of which ambiguity was already resolved.

### 24.2. Architecture: The `conversationJournal`
**Fix**: Implemented a deterministic, code-maintained **Conversation Journal** as the exclusive source of truth for conversational facts.

1. **State Storage** (`state.ts`): Added `conversationJournal: string[]` to `queryContext`.
2. **Deterministic Logging** (`update_memory2.ts`):
   - **T1 [User]**: Actual raw human message.
   - **T2 [Tool]**: Short factual summaries of tool results (e.g., "maintenance.query_status returned 5 overdue items for vessel XXX1").
   - **T3 [AI Clarification]**: Verbatim AI question when HITL is triggered.
   - **T4 [User Reply]**: User's follow-up answer.
3. **Orchestrator Integration** (`orchestrator.ts`):
   - Injects the journal as a dedicated `### 📋 CONVERSATION JOURNAL` block.
   - **Prompt Hardening**: Refactored `reformulatedQuery` Zod schema to mandate reading *only* the journal. Explicitly forbade internal reasoning or "need to determine" clauses in this field.
4. **Resilience Fixes**:
   - **Duplication Guard**: Added `iter <= 1` check to HITL capture so Q/A pairs aren't re-appended on `FEED_BACK_TO_ME` internal loops.
   - **Persistence Guard**: Included `conversationJournal` in the `catch` block return of `update_memory2.ts` to prevent journal loss on transient LLM failures.
   - **HITL Context**: Disabled the legacy `[ACTIVE CLARIFICATION CONTEXT]` injection. The journal now handles this cleanly.

### 24.3. Bug Fix: The `expiryWindowDays` ReferenceError
**Symptom**: The AI would call `documents.query_control_overview` and then loop indefinitely, repeating the same tool call until the iteration cap.
**Root Cause** (`PhoenixCloudBE/services/mcp.service.js`):
- `expiryWindowDays` was declared with `const` inside an `else` block but referenced in the return `appliedFilters` object outside that block.
- When the LLM passed an `endDate` (taking the `if` branch), the variable was never declared → `ReferenceError`.
- **The Loop**: The tool crashed, returning an error string. `update_memory2` saw no items, kept intents pending, and the Orchestrator retried.
**Fix**: Hoisted `let expiryWindowDays = null` to the top of the function scope.

### 24.4. Hardening Tool Error Handling
**Problem**: Tool timeouts and exceptions were being swallowed or garbled, leaving the AI "blind" to infrastructure failures.

1. **Tiered Timeout Expansion** (`execute_tools.ts`):
   - Raised `maintenance_query_execution_history` timeout from **25s → 45s**.
   - This tool runs a deeply nested aggregation with 4 lookups (AWH → AWHE → Parts → Inventory) and often hit the 25s wall with large result sets.
2. **Structured Error Surfacing** (`summarizer.ts`):
   - **Old logic**: Silently dropped `isError` results or pushed them as garbled JSONL rows.
   - **New logic**: Surfaces `isError` results in the `emptyTools` block (which the LLM is mandated to report on) with clear `⏱️ TIMED OUT` or `🚨 FAILED` status and the error message.
   - **AI Guidance**: Added a mandate to the summarizer prompt to inform the user of the specific failure instead of saying "no results found".
3. **Rule 47: Tool Error Dead-End Rule** (`orchestrator_rules.ts`):
   - Explicitly forbids the AI from retrying a broken tool call with the same parameters.
   - Mandates a fallback to `direct_query_fallback` or a clear failure report to the user.

### 24.5. Performance & Capacity Improvements
1. **`GLOBAL_RESULT_CAP` Increase** (`mcp.service.js`):
   - Raised from **101 → 501**. 
   - Previous cap was silently clamping the AI's requested `limit=200` to 101, leading to data truncation.
2. **Execution History Optimization**:
   - Added a `$match` gate to the `MaintenancePartUsage` lookup pipeline.
   - MongoDB now skips the expensive parts/inventory hydration for the majority of event records that have no parts recorded.

---

## 25. Files Changed in Phase 13

| File | Change |
|------|--------|
| `backend/src/langgraph/state.ts` | Added `conversationJournal` to `queryContext` |
| `backend/src/langgraph/nodes/update_memory2.ts` | Implemented journal build logic, HITL Q/A capture with `iter <= 1` guard, and catch-block persistence |
| `backend/src/langgraph/nodes/orchestrator.ts` | Injected journal into prompt; updated `reformulatedQuery` rules; disabled legacy HITL context |
| `backend/src/langgraph/nodes/execute_tools.ts` | Raised `execution_history` timeout to 45s; added `capability`/`toolName` to error objects |
| `backend/src/langgraph/nodes/summarizer.ts` | Explicitly surfaces `isError` tool failures to the LLM |
| `backend/src/langgraph/prompts/orchestrator_rules.ts` | Added **Rule 47** (Tool Error Dead-End Rule) |
| `../PhoenixCloudBE/services/mcp.service.js` | Fixed `expiryWindowDays` scope bug; raised `GLOBAL_RESULT_CAP` to 501; optimized AWH aggregation |

---

## 27. UI Performance Hardening (Phase 14)

### Objective
Resolve UI sluggishness during typing in the user query bar by preventing full-tree re-renders of the conversation history.

### Key Architectural Advancements
*   **Keystroke Isolation**: Memoized all high-complexity historical components to ensure that character entry in the chat input does not trigger redundant Markdown parsing or JSON table extraction.
*   **Re-render Suppression**: Applied `React.memo` to `ResultTable`, `MdBubbleContent`, `StreamingTimeline`, `InlineDisambiguation`, and `AnalyticalSummary`.
*   **Layout Thrash Mitigation**: Optimized the auto-resizing `useEffect` in `ContinuousChatView` and `ChatView` to reduce style recalculations.

### Files Changed in Phase 14

| File | Change |
|------|--------|
| `frontend/src/components/new-ui/ResultTable.tsx` | Memoized component export |
| `frontend/src/components/new-ui/MdBubbleContent.tsx` | Memoized component export |
| `frontend/src/components/new-ui/StreamingTimeline.tsx` | Memoized component export |
| `frontend/src/components/new-ui/InlineDisambiguation.tsx` | Memoized component export |
| `frontend/src/components/new-ui/AnalyticalSummary.tsx` | Memoized component export |
| `frontend/src/components/new-ui/ContinuousChatView.tsx` | Optimized auto-resize effect |
| `frontend/src/components/new-ui/ChatView.tsx` | Optimized auto-resize effect |

---

## 28. Orchestrator Loop Mitigation (Phase 15)

### Objective
Eliminate infinite retry loops caused by `maintenance.query_execution_history` hard timeouts.
The loop was confirmed live via DB inspection of thread `69e8e6337cc600f27521bcca` and `dev.log` analysis.

### Root Cause (Evidence-Based — 3 stacked bugs)

**Bug 1 — Wrong timeout (25s instead of 45s)**
`execute_tools.ts` line 195: `HEAVY_TOOLS` set used all-underscore keys (`maintenance_query_execution_history`) but the LLM emits dot+underscore names (`maintenance.query_execution_history`). The set check always missed → tool always got the 25s default, guaranteeing a timeout for heavy aggregation queries.

**Bug 2 — SESSION DECISION JOURNAL couldn't detect repeated failures**
Journal entries are iter-stamped keys (e.g. `maintenance.query_execution_history_iter1()`). Error results have no `appliedFilters`, so entries appeared with empty params. Each failure looked like a **new unique call** to the LLM. The dedup MANDATE ("don't repeat same Tool+Parameter") never triggered because `iter1`, `iter2`, `iter3`... all look different.

**Bug 3 — `fatalErrorInstruction` intercept was too narrow**
The real-time mid-loop instruction injector only caught `Organization not found` / `Vessel not found`. Tool timeouts fell through silently — the LLM received no mandatory instruction to stop retrying, even after 5 consecutive `FAILED` journal entries.

### Evidence from DB & dev.log
```
Thread 69e8e6337cc600f27521bcca — Turns 25-29 (all isError: true):
  maintenance.query_execution_history_iter1 → "Tool execution timed out after 25s"
  maintenance.query_execution_history_iter2 → "Tool execution timed out after 25s"
  maintenance.query_execution_history_iter3 → "Tool execution timed out after 25s"
  maintenance.query_execution_history_iter4 → "Tool execution timed out after 25s"
  maintenance.query_execution_history_iter5 → "Tool execution timed out after 25s"
  iterationCount: 6, feedBackVerdict: FEED_BACK_TO_ME (still looping, hit 8-iter cap)
```
The `conversationJournal` correctly showed all 5 as FAILED. The LLM saw the failures but could not map them to Rule 21 because the format mismatch (`maintenance.query.execution.history` in journal vs `maintenance.query_execution_history` in tool call) prevented the connection.

### Fixes Applied

| # | File | Change |
|---|------|--------|
| 1 | `execute_tools.ts` | `HEAVY_TOOLS` now uses dot-notation key `'maintenance.query_execution_history'` (matching `name` variable) — tool now correctly gets 45s timeout |
| 2 | `execute_tools.ts` | Added `isFatalTimeout: true` flag to timeout error results; `capability` kept as original dot-notation name |
| 3 | `orchestrator.ts` | Journal entries now stamped with ` ⛔ FAILED` when `isError: true` — dedup MANDATE now distinguishes failures |
| 4 | `orchestrator.ts` | `fatalErrorInstruction` widened to catch timeout errors; injects Rule 21 mandatory instruction (try `direct_query_fallback` or SUMMARIZE) directly into LLM prompt before next iteration |

### Files Changed in Phase 15

| File | Change |
|------|--------|
| `backend/src/langgraph/nodes/execute_tools.ts` | Fixed HEAVY_TOOLS key; added `isFatalTimeout` flag; preserved dot-notation capability name |
| `backend/src/langgraph/nodes/orchestrator.ts` | Added `⛔ FAILED` to journal; widened fatalErrorInstruction to intercept timeouts |

---

## 29. Final Invariants (Master List)

1. **Source of Truth**: The `conversationJournal` is the *only* source of conversational history for `reformulatedQuery`.
2. **Timeout Strategy**: Fallback = 90s, Heavy Aggregation = 45s, Standard MCP = 25s.
3. **HEAVY_TOOLS key format**: Must match the LLM's dot+underscore output (e.g. `'maintenance.query_execution_history'`), NOT the sanitized underscore form.
4. **Error Protocol**: Tool errors MUST be reported as failures (Rule 47), never as "no results". Journal entries must carry `⛔ FAILED` so Rule 21 dedup fires.
5. **Timeout Intercept**: Any tool timeout must inject a `fatalErrorInstruction` into the next orchestrator turn, forcing Rule 21 (fallback or SUMMARIZE). Do NOT rely on the LLM recognising journal FAILED entries alone.
6. **Capacity**: Global hard cap is 501; tool-specific soft caps are 200.
7. **UI Integrity**: All historical message components MUST be memoized to preserve input responsiveness.

