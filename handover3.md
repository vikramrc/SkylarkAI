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
