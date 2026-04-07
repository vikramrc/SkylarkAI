# SkylarkAI Handover Document - Part 3
*(Continued from handover2.md)*

---

## 🛠️ 80. Cleanup: Proper rawQuery Anchoring & Full activeFilters Wipe on Conversation Boundary

### Overview
This update supersedes the intermediate Bug 2 & 3 fixes from the previous handover, replacing fragile string-matching with direct state resolution, and fully isolating conversation boundaries.

### Fix 1: Robust `rawQuery` Anchoring on New Conversations (Replaces Bug 2 Fix)
The previous approach tried to locate the conversation boundary by reverse-scanning the LLM summary messages for an `[INSIGHT]` string. This was fragile and ultimately failed because of formatting variations in the summary tags (e.g., `[INSIGHT title=...]`).

**The Refactored Approach:**
Instead of scanning message content, we leverage the guaranteed structure of LangGraph state execution:
- At `isNewQuery=true` (which means `iter <= 1` and `isHITLContinuation == false`), we are algorithmically guaranteed to be processing the very first tool turn of a brand-new user query.
- Therefore, the **last `HumanMessage`** in `state.messages` is unambiguously the new query. 
- The boundary-scan and complex index arithmetic (~40 lines) was completely removed and replaced with a single deterministic lookup:

```ts
const lastHumanMsg = [...allMessages].reverse().find(m => type === 'human');
rawQuery = lastHumanMsg?.content || existingRawQuery || "";
```

### Fix 2: Full `activeFilters` Wipe on Conversation Boundary (Replaces Bug 3 Fix)
Initially, on a new conversation boundary (`isNewQuery=true`), we only cleared "entity-scope" keys (like `vesselID`) from the inherited `activeFilters` but preserved "attribute" filters (like `statusCode`, `startDate`, `endDate`) to serve as "soft context" for the Phase 2 LLM.

**Why this was flawed:**
Stale attribute filters from a previous conversation (e.g., last conversation was about 2024, new conversation is about 2025) are just as disruptive as stale entity IDs.

**The Refactored Approach:**
When a brand-new conversation starts (`isNewQuery=true`), we now perform a **full wipe** by initializing `activeFilters: {}` in the `previousQueryContext`. 

```ts
let previousQueryContext = isNewQuery
    ? { ...existingMemory.queryContext, rawQuery, pendingIntents: [], lastTurnInsight: "", currentScope: [], activeFilters: {} }
    : { ...existingMemory.queryContext, rawQuery };
```

**Why this is safe and correct:**
1. At `isNewQuery=true`, at least one tool (`iter=1`) has already executed (e.g., `fleet.query_overview`).
2. The Phase 2 LLM can read the applied filters directly from the tool's result data.
3. It uses the tool's applied filters + the new `rawQuery` to re-derive the correct, fresh `activeFilters` state from scratch.

### The Broad Scope Override is Now Complete
With these fixes, the Broad Scope Override logic is airtight:
1. **At a conversation boundary:** If the user asks for "org wide", `isNewQuery=true` handles it by wiping everything, and the Orchestrator fetches org-wide data naturally.
2. **Mid-conversation:** If a user pivots an ongoing investigation to "org wide", `isNewQuery=false` (soft-carries filters), but `isBroadScopeTriggered=true` fires. This surgically deletes the old `vesselID` from both the session scope and the soft-carried `activeFilters`, while preserving the ongoing attribute context.

### Files Modified
- `backend/src/langgraph/nodes/update_memory2.ts` — Final rawQuery anchor (lastHumanMsg) + `activeFilters: {}` wipe + removed dead defense-in-depth block

---

## 🛠️ 81. Validation & Log Analysis — Broad Scope in Action

### Scenario A: Mid-Turn Descoping (Internal Pivot)
**Proof of Correctness:**
- Orchestrator output: `"isBroadScopeRequest": true`
- UpdateMemory2 log: `🌐 Broad Scope TRIGGERED — cleared entity-scope filters (vesselID, machineryID, searchTerm, etc.) from session scope.`
- Outcome: The agent correctly moved from a 7-record vessel-specific set to a 29-record org-wide set without losing the `statusCode="cancelled"` intent.

### Scenario B: Fresh Conversation Boundary (Topic Pivot)
**Proof of Correctness:**
- UpdateMemory2 log: `iter <= 1 = true → isNewQuery = true (🔄 TIER 2 WILL RESET)`
- UpdateMemory log: `⚓ NEW CONVERSATION DETECTED — TOPIC PIVOT: To: "now show for 2026 but only completed ones and vessel wise"`
- Outcome: The new anchoring logic (using `lastHumanMsg` instead of string-scanned `[INSIGHT]`) correctly identified the new topic. `activeFilters` were reset and re-populated fresh for 2026/completed.

### Key Takeaway
The "shitty string detection" was successfully replaced with high-fidelity state checks (`iter`, `isHITLContinuation`) and a deterministic message-type lookup. The system is now significantly more stable for multi-turnorg-wide investigations.

---

## 🛠️ 82. Bug Fix: Summarizer Silently Ignored Re-Surface Requests (No-New-Tools Turn)

### The Symptom
User asked: *"show for MV Phoenix Demo now"*
The Orchestrator correctly identified that MV Phoenix Demo's data (`maintenance.query_execution_history_iter1`, 10 rows) was already fetched in a prior turn. It returned `tools: []` and `selectedResultKeys: ["maintenance.query_execution_history_iter1"]`. However, the summarizer responded with **"No Current Result Set for MV Phoenix Demo"**.

### Root Cause: `if (toolEntries.length > 0)` Gate Blocked the History Lookup

The logic in `summarizer.ts` was:
1. `currentTurns = history.slice(startTurnIndex=6)` → new request had no tool calls → `currentTurns = []`
2. `toolEntries = []` (from iterating `currentTurns`)
3. **`if (toolEntries.length > 0)` on line 61 → `false`** → the ENTIRE conductor + history lookup block was skipped.
4. `allItems` stayed empty, `noToolsCalled = true` → System prompt changed to "Dataset is EMPTY" → Summarizer output "No Current Result Set".

The `CONDUCTOR HISTORY LOOKUP` (which walks all history to find prior results) was inside this guarded block and was unreachable for zero-tool turns.

### The Fix (3 changes to `summarizer.ts`)

**1. Pre-check re-surface path BEFORE the `toolEntries` guard:**
When `toolEntries.length === 0` AND `selectedResultKeys` is non-empty, the summarizer now walks all history to find the named prior results and injects them into `allItems` immediately.

**2. Guard the empty-dataset system prompt:**
Added a `hasReSurfacedData` flag. If the re-surface path found data, we do NOT override the system prompt with the "Dataset is EMPTY" version, even if `noToolsCalled` is true.

**3. Guard the message injection:**
In re-surface mode, the summarizer now receives the full message history (not just the last message) so the LLM has context about what it's re-summarizing.

### Expected Log After Fix
```
[LangGraph Summarizer] 🗂️ RE-SURFACE MODE: No new tools this turn. Running history lookup.
[LangGraph Summarizer] 🗂️ Re-Surface: Found 1 valid prior result(s). Injecting into summarizer dataset.
[LangGraph Summarizer] 📐 Re-Surface: Flattened 10 rows from 1 prior tool result(s).
```

### File Modified
- `backend/src/langgraph/nodes/summarizer.ts`

---

## 🛠️ 83. Bug Fix: Orchestrator Ledger Pollution in Broad-Scope Requests

### The Symptom
User asked: *"okay show me org wide but restrict it to 2024 and 2025 only"* (following a vessel-specific XXX1 investigation).
The Orchestrator correctly ran `fleet.query_overview` on turn 1 of the request (iter=0), but on turn 2 (iter=1) it returned `tools: []` and `selectedResultKeys: ["fleet.query_overview_iter1", "maintenance.query_execution_history_iter2"]`.

The vessel-specific `maintenance.query_execution_history_iter2` (7 cancelled jobs for XXX1 from the **prior** conversation) was re-selected as if it satisfied the org-wide request. No fresh org-wide retrieval was called.

### Root Cause: `ledgerTurns = history.slice(-5)` Crossed Conversation Boundaries

The context builder for `PREVIOUS TOOL RESULTS IN THIS REQUEST` used `history.slice(-5)` — the last 5 turns across the entire thread history. Since the new org-wide request started at `startTurnIndex=2`, turns 0 and 1 (from the previous vessel-specific conversation) were still in the ledger window. 

The LLM saw `maintenance.query_execution_history_iter2` (vessel-scoped), recognized it was "cancelled jobs data", and decided it was sufficient to satisfy the request — effectively ignoring the scope change.

### The Fix: Broad-Scope Ledger Isolation in `orchestrator.ts`

In broad-scope mode (`queryContext.isBroadScope === true`), the `ledgerTurns` passed to the context builder is now restricted to `requestCycleTurns` (i.e., `history.slice(startTurnIndex)`) instead of the default `history.slice(-5)`. 

This ensures the LLM **physically cannot see** tool results fetched for prior conversations. It only sees results fetched for the current request, forcing it to correctly plan the next required retrieval step for the broad scope.

```typescript
// Normal Mode: Last 5 turns for visibility + token diet.
// Broad Scope Mode: Current request only (startTurnIndex onwards).
const ledgerTurns = isBroadScopeActive ? requestCycleTurns : history.slice(-5);
```

### Expected Behavior After Fix
On turn 2 of a broad-scope request, the Orchestrator's `PREVIOUS TOOL RESULTS` will ONLY show the results of the current request (e.g., discovery). Without the stale vessel-specific result as a temptation, the LLM will call the correct org-wide retrieval tool with the confirmed date filters.

### File Modified
- `backend/src/langgraph/nodes/orchestrator.ts`

---

## 🛠️ 84. Bug Fix: Summarizer Partial History Drop (Mixed New/Old Data)

### The Symptom
If the Orchestrator ran a new tool (e.g., `fleet.query_overview`) but *also* requested to re-use an old historical tool in the same turn (e.g., pulling `cancelled_jobs` from memory to compare), the Summarizer would completely ignore the historical data request and only output the new tool's data. 

### Root Cause: `if (finalEntries.length === 0)` Gate
In `summarizer.ts`, the logic for digging into conversational history was gated behind `if (finalEntries.length === 0)` (meaning "only look at history if there are absolutely zero matching NEW tools"). 

If the Orchestrator successfully matched even 1 new tool, `finalEntries` was not empty. The history lookup was bypassed entirely, and any historical keys the Orchestrator asked for were silently dropped.

### The Fix: Missing Keys Detection
Changed the logic to actively check for **missing keys**.
Instead of checking if we have *zero* tools, the Summarizer now checks: "Did the Orchestrator ask for any keys that aren't in my pile of new tools?"

```typescript
const missingKeys = state.selectedResultKeys.filter(k => !finalEntries.some(e => e.key === k));

if (missingKeys.length > 0) {
    // Dig into history to find these missing keys and merge them in!
}
```

Now, the Summarizer flawlessly merges newly executed tools and historically fetched data into a single, unified view for the LLM to analyze.

### File Modified
- `backend/src/langgraph/nodes/summarizer.ts`

---

## 🛠️ 85. Hardening: Vessel Gravity Suppression & Discovery Stall Guard

### Overview
This update addresses two critical failure modes in broad-scope (org-wide) investigations where the Orchestrator would either "snap back" to a previously discussed vessel or "stall" after discovering the fleet list without fetching actual data.

### Fix 1: Vessel Gravity Suppression (Vessel ID Shield)
**The Problem:**
Even when `isBroadScope=true` was active and entity filters were cleared from `activeFilters`, the `### 🆔 RESOLVED ENTITIES` block in the Orchestrator prompt still displayed previously resolved vessel IDs (e.g., `XXX1 → 683b...`). This acted as a "magnet" for the LLM, often causing it to ignore the broad-scope warning and anchor its next tool call to that specific vessel ID.

**The Fix:**
In `orchestrator.ts`, the prompt builder now **completely suppresses** the `RESOLVED ENTITIES` block when `isBroadScope` is active.
- The IDs remain in the session state (so the user can pivot back to a vessel at any time).
- The LLM simply **does not see them** during org-wide turns, removing the temptation to use them.

### Fix 2: Discovery Stall Guard (Mandatory Retrieval Pivot)
**The Problem:**
Following the "Discovery-First" mandate (Rule 9), the Orchestrator would run `fleet.query_overview` to identify vessels. However, on the very next iteration (`iter=1`), the LLM would occasionally "stall"—reasoning that it had already provided an "org-wide overview" and thus didn't need to call any more tools. It would summarize the discovery result instead of fetching the detailed data the user actually asked for (e.g., cancelled failure jobs).

**The Fix:**
Implemented a deterministic **Discovery Stall Guard** in `orchestrator.ts`:
- **Trigger:** If `iterationCount === 1` AND the previous turn was a discovery tool (`fleet.query_overview` or `resolve_entities`) AND the current turn proposes `tools: []` + `SUMMARIZE`.
- **Action:** Overrides the verdict to `FEED_BACK_TO_ME`, forcing the graph to loop back for another planning turn.
- **Limit:** Fires exactly once. If the LLM still fails to plan a retrieval on the subsequent turn, it is allowed to summarize to prevent infinite loops.

### Key Takeaway
Both fixes are **code-level enforcement** that override or hide information from the LLM based on the investigation state. This ensures that the "Discovery-First" protocol is not just a suggestion, but a mandatory two-step sequence (Discovery → Retrieval).

### File Modified
- `backend/src/langgraph/nodes/orchestrator.ts`

---

## 🛠️ 86. Precision Fixes: System Intercept, Ledger ID Sniffing & Broad-Scope Exit

### Overview
This final set of hardening fixes ensures that the deterministic guards (Stall Guard & Identity Intercept) are fully visible to the LLM and that the system correctly transitions back to scoped mode after an org-wide investigation.

### Fix 1: System Intercept Injection (Feedback Loop Visibility)
**The Problem:**
When the Discovery Stall Guard or Deterministic Vestibule (Identity Intercept) fired, they would force a "loop-back" (`FEED_BACK_TO_ME`). However, on the next turn, the LLM had no visibility into *why* it was intercepted. It would wake up with the same prompt and potentially fall into the same "lazy" pattern again.

**The Fix:**
In `orchestrator.ts`, the `🛑 SYSTEM INTERCEPT` string is now injected into the prompt whenever `iterationCount > 0` and the previous turn was a discovery turn.
- It displays the exact `state.reasoning` from the previous turn (e.g., "[DISCOVERY STALL GUARD] ... Looping back to execute the retrieval step.").
- The `> 0` gate ensures the message sticks throughout the intercepted loop but is cleanly hidden on the very first turn of any *new* query, preventing stale reasoning from leaking across investigations.

### Fix 2: Ledger ID Sniffing — Wide-Scope Correction
**The Problem:**
When Ledger Isolation was active (broad-scope mode), the index check `tIdx === history.length - 1` for identifying the "latest turn" was mathematically impossible (since `tIdx` is indexed against the isolated subset, not the full history). Consequently, "Extracted Keys" were never displayed for the latest discovery results during org-wide queries.

**The Fix:**
Corrected the index to `tIdx === ledgerTurns.length - 1`. ID harvesting now correctly fires on the latest turn regardless of whether the ledger is in isolated (broad-scope) or diet (5-turn) mode.

### Fix 3: Deterministic Broad-Scope Exit
**The Problem:**
The `isBroadScope` flag was persistent—once a user triggered an org-wide search, the system stayed in "Vessel ID Shield" mode forever. Subsequent searches for specific vessels would fail because the vessel IDs were permanently suppressed from the prompt.

**The Fix:**
In `update_memory2.ts`, implemented a clear exit condition:
- If a `isNewQuery` starts AND it is not explicitly a broad-scope request, `isBroadScope` is reset to `false`.
- This allows the user to naturally "re-scope" to a specific vessel (e.g., "now show me XXX1 specifically") after completing an org-wide audit.

### Files Modified
- `backend/src/langgraph/nodes/orchestrator.ts` — `systemInterceptStr` visibility, `isLatestTurn` index fix.
- `backend/src/langgraph/nodes/update_memory2.ts` — `isBroadScope` exit logic.

---

---

---

## 🛠️ 88. Hardening the Discovery-First Protocol (April 4th)
**Target:** Elimination of "Stall" conditions and context memory pollution.

### 1. Discovery Stall Guard 2.0 (Orchestrator)
**The Fix:** Replaced the unreliable LLM-based `hasPendingIntents` signal with a deterministic code-level check: `hasRetrievalInCurrentRequest`. 
- **The "Running Hours" Correction:** Initial versions used a broad `fleet.query_` wildcard which accidentally flagged retrieval tools (like `running-hours`) as discovery tools. This has been corrected to a strict inclusion list: `fleet.query_overview`, `mcp.resolve_entities`, `fleet.query_structures`, `maintenance.query_schedules`, `mcp.health`, `mcp.capabilities`.
- **Result:** The system is now physically incapable of terminating a turn if ONLY discovery tools ran in the current request cycle.

### 2. Context Memory Cleanup (Summarizer & State)
**The Problem:** Storing the `rawQuery` (fragmented across turns) in the `summaryBuffer` was polluting the LLM's long-term context with noisy and misleading instructions.
**The Fix:** 
- Added `reformulatedQuery` to `SkylarkState`. 
- Orchestrator now persists the clean, distilled intent to the state on every turn.
- Summarizer uses this clean intent for the `q:` field in the `summaryBuffer` roll-up.
- **Log Visibility:** Added cyan color logs `\x1b[36m` to the Summarizer to confirm when `reformulatedQuery` is successfully utilized.

### 3. Broad-Scope Logic Hardening
- **System Intercept Gating:** The `🛑 SYSTEM INTERCEPT` reasoning is now gated to `iterationCount > 0`. This ensures it stickies during active re-run loops (Stall Guard/Identity Intercept) but is cleanly suppressed on brand-new queries to avoid stale reasoning pollution.
- **Ledger Index Fix:** Corrected `isLatestTurn` logic to use `ledgerTurns.length - 1`. This ensures ID sniffing (Harvesting) works correctly even when ledger isolation is active in Broad Scope mode.
- **Deterministic Exit:** Implemented an explicit reset in `update_memory2.ts` so that starting a new non-broad-scope query correctly clears the `isBroadScope` flag, allowing the user to return to vessel-specific investigations.

### 4. Contract Parity (`SkylarkAI` & `PhoenixCloudBE`)
- **Fleet Discovery:** Updated `fleet.query_overview` in both repositories to explicitly declare it a **DISCOVERY TOOL**. 
- **Guidance Enforcement:** Added `whenNotToUse` and `interpretationGuidance` to warn the LLM that KPI counts are Navigational Signals only, and that it **MUST** extract vessel IDs and call retrieval tools (history/status) to fulfill detailed user requests.

**Files Modified:**
- `SkylarkAI`: `orchestrator.ts`, `summarizer.ts`, `state.ts`, `update_memory2.ts`, `contract.ts`.
- `PhoenixCloudBE`: `mcp.capabilities.contract.js`.

**Status:** Hardened. TSC Check: **Zero Errors**.

---

## 🛠️ 91. Intent-First Enforcement & Logic Hardening (April 4th)
**Target:** Eliminate raw/noisy user queries from the loop and harden the query-to-result tracking.

**Issues Addressed:**
1. **Orchestrator Context Leak:** The Orchestrator was appending a list of raw human message objects to its prompt, causing the LLM to get distracted by fragmented chat logs instead of focused on the distilled intent.
2. **Context Stagnation:** `UpdateMemory2` (Phase 2) was repeatedly anchoring its `queryContext.rawQuery` to the last human message, effectively ignore the clean reformulation logic.
3. **Implicit Nullability:** `reformulatedQuery` was optional in the schema, allowing the LLM to occasionally skip the synthesis step.
4. **Noisy Insights:** `lastTurnInsight` lacked a strict structure, sometimes losing focus on what the user actually asked.

**Comprehensive Fixes:**
- **Strict Intent Mandate (Orchestrator):** Removed `.nullable()` from the `reformulatedQuery` Zod schema. The LLM is now physically forced to generate a synthesized intent on every turn or the tool call fails validation.
- **Graph Persistence (CRITICAL):** Registered `reformulatedQuery` as a state channel in `graph.ts`. Without this, LangGraph was correctly producing the value but silently dropping it before it could reach other nodes.
- **Prompt Unification:** Rewrote the `qnaTranscript` construction in `orchestrator.ts`. It now strictly uses the `summaryBuffer` (past Q&A) + the `reformulatedQuery` (current intent). Raw message objects are now hidden from the LLM after Turn 0.
- **UpdateMemory2 Handoff:** Modified `update_memory2.ts` to prioritize `state.reformulatedQuery` as its primary `rawQuery` anchor. It now logs: `🎯 Adopted Orchestrator's Reformulated intent`.
- **Insight Hardening:** Updated Phase 2 system rules to enforce `lastTurnInsight` as **EXACTLY ONE sentence** that MUST combine the user's request with the actual data retrieved.

**Impact:** Every component in the LangGraph loop now speaks a unified, distilled technical language. We have physically eliminated the "raw chat leak" that was causing scope drift and noisy context.

**Status:** Hardened. Persistence Verified.

## 🛠️ 92. HITL Context Isolation & Journal Semantics (April 4th)
**Target:** Fix the "one-turn-behind" journal lag and eliminate raw context leakage on new HITL turns.

**Issues Addressed:**
1. **Phase-0 Context Leak:** On new HITL turns (where `iterationCount` resets to 0), the orchestrator was bypassing the QnA masking logic and dumping ALL raw chat history into the prompt. This caused old context (e.g., "cancelled 2025") to flood the LLM's vision even when the user had pivoted to a new topic (e.g., "completed 2026").
2. **Journal Inversion Bug:** The Session Decision Journal was incorrectly pairing AI messages as "questions" and human follow-ups as "answers." This caused new user investigative pivots to be logged as a resolved answer (`✓ A:`) to the previous AI response, rather than as a new, unanswered question (`? Q:`).

**Targeted Fixes:**
- **Adaptive Masking Activation (Orchestrator):** Updated the masking condition to trigger whenever `summaryBuffer.length > 0` (existing conversation history) OR `iterationCount > 0` (intermediate looping). This guarantees the LLM *always* sees a clean, distilled transcript regardless of turn type.
- **Fresh Intent Injection:** For `iter=0` turns where the new query isn't in the `summaryBuffer` yet, the orchestrator now explicitly extracts the latest `HumanMessage` and injects it as the final `HUMAN:` line in the masked prompt.
- **Investigative Journal Semantics:** Corrected the message-pairing loop in `orchestrator.ts`. It now strictly treats `HumanMessage` as the investigation intent (`? Q:`) and `AIMessage` as the data delivery (`✓ A:`).

**Impact:** Complete context isolation. The LLM is now physically unable to see raw, noisy chat objects once a conversation has started, and the journal provides a perfectly synchronized "investigational status report" that correctly reflects the user's latest pivot.

**Status:** Verified. Intent synchronization complete.

---

## 🛠️ 93. Fleet Maintenance Analytics Expansion (April 5th)
**Target:** Accurate fleet-wide reporting of cancelled, missed, and completed work.

### 1. Metric Expansion (`getFleetOverview`)
**The Enhancement:** Updated the aggregation pipeline in `PhoenixCloudBE/services/mcp.service.js` to include three new counters within the specified date range:
- `cancelledInRange`: Counts records where `latestEventStatus === 'cancelled'`.
- `missedInRange`: Counts records where `latestEventStatus === 'missed'`.
- `rescheduledInRange`: Counts records where `latestEventStatus === 'rescheduled'`.

**Fleet Summary Sync:**
The top-level `summary` object now includes `totalCompleted`, `totalCancelled`, and `totalMissed`, derived from the aggregated vessel stats. This ensures the dashboard's "Fleet Snapshot" is mathematically consistent with the individual vessel drill-downs.

### 2. Projection & AWH Integration
Projected these new metrics into the `awhStats` object to ensure they are available for frontend rendering and vessel-wise comparisons. This resolves the reporting gap where "cancelled" and "missed" jobs were invisible in higher-level summary views.

---

## 🛠️ 94. Fix: Orchestrator Context Persistence Sticky Pivot (April 5th)
**Target:** Ensure the Orchestrator respects entity pivots (e.g., from vessel XXX1 to MV Phoenix Demo) during re-surface turns.

### The Symptom
After investigating `XXX1` and then asking to "show for MV Phoenix Demo", the next follow-up question ("none in 2025?") would cause the Orchestrator to respond with data for `XXX1` again.

### Root Cause: Stale `activeFilters` in Graph Memory
- On "Re-surface" turns (where data is reused without calling new tools), the LangGraph routes directly from `orchestrator` to `summarizer`, bypassing the `update_memory` node.
- Consequently, `update_memory2` never clears the stale `activeFilters` (containing the old `vesselID`) even though a new query started.
- On the subsequent turn, the Orchestrator reads the state and sees the stale `vesselID` in its grounding context, which overrides the natural conversational flow and "drifts" back to the old vessel.

### The Fix: Deterministic Filter Cleanup in `orchestrator.ts`
Implemented a surgical cleanup block in the Orchestrator's state update logic:
- **Condition:** Fires if `finalToolCalls.length === 0` AND the verdict is `SUMMARIZE`.
- **Action:** Deterministically clears `vesselID` and `label` from `activeFilters`.

### Impact
Eliminates the "One-Turn Behind" memory lag and ensures that entity-identity filters are strictly cleared whenever the conversation transitions to a new subject without a retrieval step.

**Files Modified:**
- `PhoenixCloudBE`: `mcp.service.js`.
- `SkylarkAI`: `orchestrator.ts`, `handover3.md`.

**Status:** Hardened. Context switching verified.
---

## 🛠️ 95. Frontend Analytical UX: Nested Tables & Expanded Themes (April 5th)
**Target:** Support for high-density analytical summaries and visually rich insights.

### 1. Nested [TABLE] Support (`MdBubbleContent.tsx`)
**The Problem:** The regex used to split the summarizer output into segments was too aggressive. It treated the closing `[/INSIGHT]` and `[TABLE]` tags as mutually exclusive, causing nested tables inside insight blocks to either truncate the insight or fail to render the table correctly.
**The Fix:** Updated the splitting regex to use a non-capturing lookahead/lookbehind approach that respects nested structures. The frontend now correctly renders `[TABLE]` components even when they are fully wrapped inside an `[INSIGHT]` block.

### 2. Expanded Color Palette & Emojis (`AnalyticalSummary.tsx`)
**The Enhancement:**
- **Themes:** Added support for `orange`, `purple`, and `teal` color tokens in the `AnalyticalSummary` component to match the new themes introduced in the backend summarizer.
- **Icons:** Updated the icon resolver to allow raw emoji strings. If the `icon` field contains a standard emoji, the component renders it directly as text instead of trying to map it to a Lucide icon. This allows for more expressive and varied insight headers.

---

## 🛠️ 96. Refined Pivot Gate: deterministic iter=0 Gating (April 5th)
**Target:** Eliminate loop-back regressions that broke org-wide fleet queries.

### The Regression
The initial "Pivot Gate" fix (Section 94) included a `FEED_BACK_TO_ME` override. While intended to force a fresh fetch for a new vessel, it caused a critical failure for fleet-wide queries:
1. User asks for "org-wide 2026 data".
2. Orchestrator finds 0 results, votes `SUMMARIZE`.
3. Pivot Gate detect a `vesselID` in memory (from a prior turn), overrides to `FEED_BACK_TO_ME`.
4. `update_memory2` wakes up, re-narrowed the query to a **single vessel** based on its internal Phase 2 logic.
5. The original fleet-wide intent was effectively "lost" in the loop.

### The Final Resolution
**1. Removed `FEED_BACK_TO_ME`:** The loop-back was overengineered. Clearing the `vesselID` and `label` from `activeFilters` is sufficient.
**2. Deterministic `iterationCount === 0` Gating:** The cleanup now ONLY fires at the start of a new request (`iter === 0`).
- If the LLM legitmately concludes after running tools mid-request (`iter > 0`), the gate stays closed.
- If the user pivots to a new entity (Turn 0), the gate opens, wipes the stale identity filters, and lets the Orchestrator re-plan with a clean slate.

**Impact:** Restored high-fidelity org-wide querying while maintaining the surgical cleanup of stale entity context between turns.

**Files Modified:**
- `SkylarkAI`: `MdBubbleContent.tsx`, `AnalyticalSummary.tsx`, `orchestrator.ts`.
- `handover3.md`: Updated documentation.

**Status:** Hardened. Fleet-wide vs. Vessel-Pivot conflict resolved.

---

## 🛠️ 97. Architectural Pivot: Always-Execute & The Death of `selectedResultKeys` (April 6th)

**Target:** Eliminate fragile short-circuiting and context-reuse hallucinations for 100% deterministic execution.

### 1. The Core Objective
The previous `selectedResultKeys` mechanism was a high-maintenance "short-circuit" that allowed the LLM to skip tool execution if it thought a prior result was sufficient. This led to "stale data" hallucinations during entity pivots (e.g., showing XXX1's jobs when asked for Phoenix Demo) and required a complex, brittle "Hiding Algorithm" (~250 lines of code) to prevent context pollution.

**The Solution:** The entire pipeline has been refactored to an **"Executor-First"** model. The agent is now physically incapable of "selecting" old results. Every turn REQUIRES explicit tool calls with full parameters.

### 2. Physical Deletions (Removing the Debt)
- **State & Graph:** Deleted the `selectedResultKeys` field from `SkylarkState` and its corresponding channel in `graph.ts`.
- **Orchestrator Schema:** Removed the field from the Zod output schema. The LLM can no longer even attempt to use it.
- **The Hiding Algorithm:** Excised the ~240-line "Ledger Hiding" block that calculated entity-status mismatches.
- **Smart Promotion:** Removed the "Promotion Bridge" that injected historical keys into the state.
- **Summarizer Re-Surface:** Deleted the entire 60-line `RE-SURFACE PATH` that handled zero-tool turns.

### 3. New Deterministic Patterns
- **Always-Execute Mandate:** Updated `orchestrator_rules.ts` (Section IV) with a hard mandate: "You ALWAYS call tools fresh. You MUST NEVER attempt to reuse prior result data."
- **Discovery Isolation (Summarizer):** Replaced the 90-line conductor filter with a clean 8-line name-pattern match. The summarizer now receives ALL current-turn results but suppresses internal discovery tools (`resolve_entities`, `fleet.query_overview`, etc.) from the final prose report based on their tool names.
- **Request Isolation (Workflow):** Simplified SSE emission and MongoDB persistence (`workflow.ts`). The system now strictly slices `allTurns.slice(startTurnIndex)`. Only tools run in the ACTIVE HTTP request are shown in the UI tabs or saved to the message history.

### 4. Impact & Performance
- **Zero Hallucination Switch:** Entity pivots (e.g., "now for Vessel B") are now 100% reliable because the agent MUST call the tool with Vessel B's ID to get any data.
- **Leaner Logic:** Reduced total codebase size by ~400 lines of complex conditional logic.
- **Unified Memory:** `summaryBuffer` (analytical Q&A) is now the SOLE source of conversational context, while `toolResults` are treated as ephemeral current-request data.

**Files Modified:**
- `SkylarkAI`: `orchestrator.ts`, `summarizer.ts`, `state.ts`, `graph.ts`, `orchestrator_rules.ts`, `workflow.ts`.

**Status:** Architecture Stabilized. Protocol: **Always-Execute**.

---

## 🛠️ 98. Bug Fix: Discovery Isolation — Overly Broad Prefix (April 6th)

**Target:** Prevent legitimate retrieval tools from being silenced in the summarizer's final prose report.

### The Bug
The `DISCOVERY_PREFIXES` list in `summarizer.ts` contained the entry `'fleet.query'`. Because the isolation check is a substring match (`key.includes(p)`), this would match **all** fleet tools — including user-facing retrieval tools like `fleet.query_running_hours` and `fleet.query_machinery_status`. If either of these ran alongside a discovery tool in the same turn, their results would be silently suppressed from the prose summary even though the user explicitly asked for them.

The edge-case fallback (line 95 — "if ALL entries are discovery, pass through all") only rescues the case where 100% of tools are discovery tools. It does **not** protect a mixed turn where one tool is real data and another happens to match the too-broad prefix.

### The Fix
Removed the catch-all `'fleet.query'` from the list and replaced with precise, semantically unambiguous entries. The final `DISCOVERY_TOOLS` list is:

```typescript
const DISCOVERY_TOOLS = [
    'resolve_entities',  // Label-to-ID mapping — always intermediate
    'query_overview',    // fleet.query_overview — vessel ID discovery step
    '.health',           // MCP health check — never user-facing
    '.capabilities',     // Cap listing — never user-facing
];
```

### Why These Four
Every entry in this list is a tool that is **never** the final deliverable — there is no user request for which seeing raw `fleet.query_overview` or `mcp.resolve_entities` output in the summary prose would be correct. All other tools (including `fleet.query_running_hours`, `fleet.query_machinery_status`, `maintenance.query_schedules`, etc.) have legitimate user-facing scenarios and are therefore intentionally excluded from suppression.

### File Modified
- `SkylarkAI/backend/src/langgraph/nodes/summarizer.ts`

**Status:** Discovery Isolation hardened. No retrieval tool data can be silently suppressed.

---

## 🛠️ 99. Fleet Overview UI Redesign: Compact KPI Cards (April 6th)

**Target:** Replace the generic table view for fleet discoveries with a "cute and cosy" high-density KPI layout.

### 1. New Component: `FleetOverviewCards`
**The Enhancement:** Implemented a new card-based renderer in `ResultTable.tsx` specifically for the `fleet.query_overview` tool.
*   **Design:** Compact, tight formation with minimal whitespace.
*   **Metrics:** Displays Vessel Name, Machinery Count, and the expanded `awhStats` (Completed, Cancelled, Missed, Rescheduled) in a badge-based grid.
*   **Integration:** `ResultTable` now detects the `fleet.query_overview` tab and conditionally renders the cards instead of the standard `ToolTable`.

### 2. Analytical Icon Expansion
**The Enhancement:** Expanded the `ICON_MAP` in `AnalyticalSummary.tsx` to support a wider range of Lucide icons commonly used in the fleet dashboard, including:
*   `trending-up`, `warning`, `info`, `file`, `shield`, `search`, `cancel`, `user-x`.
*   This ensures that the summary insights always display professional iconography rather than falling back to blank space.

---

## 🛠️ 100. Orchestrator Hardening: Topic Pivot Guards (April 6th)

**Target:** Prevent "Stale Scope Bleed" where new queries (e.g., a broad 2026 search) incorrectly anchor to vessels from the previous query (e.g., XXX1).

### 1. `TOPIC PIVOT SCOPE GUARD` (Prompt-Level)
**The Problem:** On the very first turn of a new investigation (`iter=0`), the `currentScope` (Organic Discoveries) in the prompt still contained the ID of the vessel from the *previous* request. Rule VIII.2 (Specificity) forced the LLM to skip discovery and stick to that vessel.
**The Fix:** Added a textual pivot check (`anchoredRawQuery !== query.rawQuery`). If a pivot is detected at `iter=0`, the `displayCurrentScope` is forced to `[]` in the prompt, regardless of the underlying state.

### 2. `TOPIC PIVOT ACCUM GUARD` (State-Level)
**The Problem:** Even if the LLM output `currentScope: []`, the orchestrator would merge that with the `previouslyAccumulated` scope from memory, re-inserting the old vessel ID into the state for the next turn.
**The Fix:** The accumulation logic now uses the same pivot check to discard the prior scope from the final merge on Turn 0.

---

## 🛠️ 101. Memory Management: Scope Boundary Isolation & Stale ID Deletion (April 6th)

**Target:** Fix the "Ghost Entity Resurrection" where stale IDs would reappear on turn 2 of a new query.

### 1. `isGenuineTopicPivot` Alignment (Gap 2 Fix)
**The Problem:** `update_memory2` was clearing scope based purely on `iter <= 1`, while the Orchestrator used textual comparison. This caused "Split-Brain" behavior on query retries or exact-match queries.
**The Fix:** Aligned `update_memory2.ts` to use identical textual comparison (`rawQuery.trim() !== existingRawQuery.trim()`) to define a genuine topic pivot.

### 2. Mandatory Stale ID Deletion (Gap 1 Fix)
**The Problem:** Masking IDs from `currentScope` wasn't enough; the key (e.g., `vesselID`) remained in `sessionContext.scope`. On Turn 2 (`iter=2`), when the pivot guards were no longer active, the code would re-extract the stale ID and "resurrect" it into the investigation.
**The Fix:** 
*   **Snapshotting:** Before Phase 1 runs, we capture a `Map<key, value>` of inherited entity pointers (`inheritedEntityScopeSnapshot`).
*   **Surgical Deletion:** During deterministic scope extraction, if we are on a `isGenuineTopicPivot` boundary, we now **explicitly `delete`** any key from the session scope that matches both the key and the specific value in the snapshot.
*   **Selective Promotion:** If Phase 1 freshly resolves a *new* ID (different value) for the same key (e.g., a different vessel), the value mismatch ensures it is **not** deleted and is promoted to `currentScope` correctly.

### Impact
The "Executor-First" model is now airtight. The Organic Discovery scope is strictly isolated to the active investigation, while the "Ambiguity Bridge" (`resolvedLabels`) and the 7-turn ledger (`secondaryScope`) maintain the system's long-term intelligence.

**Files Modified:**
- `SkylarkAI`: `orchestrator.ts`, `update_memory2.ts`, `ResultTable.tsx`, `AnalyticalSummary.tsx`.

**Status:** Hardened. Ghost entities eliminated. Context isolation complete.

---

## 🛠️ 102. Memory Management: The "Blind LLM" Loop Fix (April 6th)

**Target:** Prevent infinite discovery loops by ensuring array-based entity results (e.g., from `fleet.query_overview`) are correctly ingested into `currentScope`.

### 1. The Symptom: The Infinite Discovery Loop
With the GAP-30 "Ghost Entity" patch, `update_memory2.ts` became the strict dictator of `currentScope`, overwriting whatever the Orchestrator LLM thought the scope should be based on deterministic Phase 1 extraction.
However, Phase 1 only had logic to extract *singular* `vesselID` strings from the `mcp.resolve_entities` tool.
When an array-based discovery tool like `fleet.query_overview` ran and returned 7 vessels, Phase 1 ignored the array, built an empty `deterministicScope`, and wiped `currentScope` to `[]`.
The Orchestrator would wake up, see an empty `currentScope`, assume discovery failed or hadn't happened, and re-run `fleet.query_overview` infinitely until the LangGraph 8-iteration hard limit was hit.

### 2. The Fix: Universal Organic ID Harvesting
Added an "Organic Harvester" to Phase 1 of `update_memory2.ts` that dynamically scans the results of *any* tool that ran during the current request loop.

**Logic:**
*   It creates an `organicallyDiscoveredIds` Set before looping over the `latestTurn` tool results.
*   If any tool returns an array in `data.items`, it iterates through the payloads.
*   If it finds a valid 24-character hexadecimal `_id` or `id`, it automatically adds it to the `organicallyDiscoveredIds` Set.
*   Finally, `organicallyDiscoveredIds` is used to seed `deterministicScope`, merging seamlessly with any singular `vesselID`s bound in `sessionStateCommit.scope`.

### Impact
The Orchestrator's "Discovery-First" mandate (Rule 9) now functions perfectly. 
1. The Orchestrator runs `fleet.query_overview`.
2. The tool returns N vessels.
3. `update_memory2.ts` harvests all N hex IDs deterministically and populates `currentScope`.
4. The Orchestrator wakes up, sees the IDs securely seated in `currentScope`, and proceeds directly to the data retrieval phase (e.g., calling `maintenance.query_execution_history`).

**Files Modified:**
- `SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts`

**Status:** Hardened. Array-based ID harvesting natively supported. Pipeline stall fully resolved.
