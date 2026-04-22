# SkylarkContext.md
## Master Agent Reference Document — SkylarkAI Orchestrator

> **This document is the single source of truth for all agents and contributors working on the
> SkylarkAI orchestrator.** Read this before making any changes to `orchestrator.ts`,
> `orchestrator_rules.ts`, `update_memory2.ts`, or `summarizer.ts`.
> It supersedes and extends `handover4.md`.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Memory Tier Model](#2-memory-tier-model)
3. [The Orchestration Loop](#3-the-orchestration-loop)
4. [HITL — Human-in-the-Loop Clarification Flow](#4-hitl--human-in-the-loop-clarification-flow)
5. [Ambiguity Resolution Protocol](#5-ambiguity-resolution-protocol)
6. [Context Assembly — How the Prompt Is Built](#6-context-assembly--how-the-prompt-is-built)
7. [Known Issues and Planned Fixes](#7-known-issues-and-planned-fixes)
8. [Code-Level Guards Reference](#8-code-level-guards-reference)
9. [Debug Tooling](#9-debug-tooling)
10. [Architectural Invariants — Do Not Break](#10-architectural-invariants--do-not-break)

---

## 1. System Architecture Overview

SkylarkAI is a **LangGraph-based diagnostic orchestrator** for maritime Planned Maintenance
Systems (PMS). It bridges natural-language questions from human operators to structured MCP tool
calls against a MongoDB-backed fleet management database.

### Node Graph

```
[User HTTP Request]
       │
       ▼
  ┌─────────────┐
  │ orchestrator │  ← Plans tool calls, reformulates query, detects ambiguity
  └──────┬──────┘
         │  feedBackVerdict:
         │    FEED_BACK_TO_ME  → execute_tools → update_memory2 → [loop back]
         │    SUMMARIZE        → summarizer
         │    SUMMARIZE + hitl_required=true → summarizer → checkpoint + await HITL
         ▼
  ┌──────────────┐
  │ execute_tools │  ← Runs MCP tool calls (parallel or sequential per parallelizeTools flag)
  └──────┬───────┘
         ▼
  ┌───────────────┐
  │ update_memory2│  ← Phase 1 (code): extract IDs, scope, ambiguities deterministically
  └──────┬────────┘     Phase 2 (LLM):  update pendingIntents, activeFilters, lastTurnInsight
         │
         ▼
  ┌───────────────┐
  │   summarizer  │  ← Produces human-facing response + squashes summaryBuffer entry
  └───────────────┘
         │
         ▼
  [Response to User]  OR  [Checkpoint — await HITL reply]
```

### Key Files

| File | Role |
|------|------|
| `src/langgraph/nodes/orchestrator.ts` | Core prompt assembly, LLM invocation, all code-level guards |
| `src/langgraph/prompts/orchestrator_rules.ts` | LLM behavioural constitution (rules, mandates, anti-hallucination) |
| `src/langgraph/nodes/update_memory2.ts` | Two-phase memory update (Phase 1 code + Phase 2 LLM) |
| `src/langgraph/nodes/summarizer.ts` | User-facing response generation + summaryBuffer squash |
| `src/langgraph/state.ts` | LangGraph state schema — all channels defined here |
| `src/langgraph/graph.ts` | Node wiring, conditional edges, hard maxIter ceiling |

---

## 2. Memory Tier Model

The orchestrator has **four distinct memory tiers** with different scopes and lifetimes.

### Tier 1 — Session Context (`workingMemory.sessionContext`)

**Lifetime:** Entire conversation session (across ALL user questions). Never reset.

```typescript
sessionContext: {
  scope: {
    organizationID: string,           // Captured from first tool result
    organizationShortName: string,
    resolvedLabels: {                 // label → {id, type} — permanent lookup table
      "XXX1": { id: "683b0257...", type: "Vessel" },
      "CCCCCCC": { id: "abc123...", type: "Machinery" }  // set after disambiguation
    },
    ambiguousMatches: [               // TRANSIENT — set/cleared by update_memory2 Phase 1
      // ⚠️  CLEARED automatically when HITL+retrieval signal fires (see I9)
      { label: "CCCCCCC", candidates: [{ label, id, type }, ...] }
    ],
    vesselID: string,                 // Currently active vessel scope pointer
    machineryID: string,              // Currently active machinery scope pointer
    // ...other typed entity IDs (activityID, scheduleID, crewcompetencysignalID, etc.)
  },
  secondaryScope: [                   // Rolling 7-conversation entity ledger (summarizer-managed)
    { id, name, modelType, conversationIndex }
  ]
}
```

### Tier 2 — Query Context (`workingMemory.queryContext`)

**Lifetime:** Single user question. Reset on `isNewQuery=true`.
**Reset condition:** `(iter <= 1) && !isHITLContinuation`

```typescript
queryContext: {
  rawQuery: string,         // Anchored to original human message; preserved across HITL turns
  pendingIntents: string[], // What is still unanswered this query (max 5; updated by update_memory2)
  activeFilters: {},        // Current filter set (statusCode, dates, limits, signals, etc.)
  lastTurnInsight: string,  // One-sentence summary of what last tool turn found or resolved
  currentScope: string[],   // Entity IDs organically discovered THIS query (cleared on SUMMARIZE)
  isBroadScope: boolean,    // True when user requested org/fleet-wide (not vessel-specific)
}
```

### Tier 3 — Summary Buffer (`summaryBuffer`)

**Lifetime:** Full session. Rolling window, managed by summarizer.
**Written by:** Summarizer node on every successful `SUMMARIZE` turn.

```typescript
summaryBuffer: [
  { q: string, a: string }
  // q = reformulatedQuery — the AI's full distillation of the task intent, not the raw message
  // a = AI's factual data summary for that conversation turn
]
```

> **Design Intent (by design, do not change):** `q` is the `reformulatedQuery`, intentionally
> the AI's complete understanding of the task. It carries domain context (org, vessel, signal,
> mode) forward across turns. `a` is the factual result. This is deliberately coarse — NOT a
> HITL dialogue transcript. Too much granularity pollutes context.

### Tier 4 — Long-Term Buffer (`longTermBuffer`)

**Lifetime:** Full session. Compressed by LLM when summaryBuffer grows large.
**Injected as:** `📚 LONG TERM HISTORY` at the top of the memory context block.

---

## 3. The Orchestration Loop

### Verdict Types

| Verdict | Effect | Next Node |
|---------|--------|-----------|
| `FEED_BACK_TO_ME` | Run planned tools, loop back to orchestrator | `execute_tools → update_memory2 → orchestrator` |
| `SUMMARIZE` | Done — generate user response | `summarizer` |
| `SUMMARIZE + hitl_required=true` | Pose clarifying question to user | `summarizer` → checkpoint |

### Key State Counters

- **`iterationCount`:** Incremented every time orchestrator runs within one HTTP request.
- **`startTurnIndex`:** Absolute index into `toolResults[]` marking the start of THIS request's tool calls. Distinguishes "current request" tools from "prior request" history.
- **Hard cap:** `maxIter=8` in `graph.ts` — graph terminates at 8 iterations to prevent runaway loops.

### isNewQuery (update_memory2.ts L260)

```typescript
const isNewQuery = (iter <= 1) && !state.isHITLContinuation;
```

- `iter <= 1` = first tool turn of a new HTTP request (not an internal loop-back).
- `!isHITLContinuation` = user is not replying to a clarifying question.
- NOT based on `startTurnIndex` (deprecated approach, caused bugs — see fix §55 in history).
- NOT based on rawQuery text change (that is `isGenuineTopicPivot`, a separate check).

### Topic Pivot vs. HITL Continuation

```typescript
// A genuine topic pivot: new HTTP request AND query text actually changed
const isGenuineTopicPivot = isNewQuery && !!existingRawQuery
    && rawQuery.trim() !== existingRawQuery.trim();
```

On topic pivot: entity-scope keys (`vesselID`, `machineryID`, etc.) are cleared from
`sessionContext.scope`. `resolvedLabels` and `secondaryScope` are preserved — the user can
still reference "XXX1" by name in future turns.

---

## 4. HITL — Human-in-the-Loop Clarification Flow

### What Triggers HITL

1. `ambiguousMatches` is non-empty and the orchestrator emits a `clarifyingQuestion`
2. Missing critical context (org name, unresolvable label) where the LLM decides to ask

### State Flags

```typescript
hitl_required: boolean       // true → graph checkpoints and waits for user reply
isHITLContinuation: boolean  // true → this HTTP request is the user's reply to a prior question
```

### Full Lifecycle

```
── Turn N: AI asks clarifying question ──────────────────────────────────────────
orchestrator outputs:
  clarifyingQuestion: "I found 3 Machinery items named CCCCCCC. Which did you mean?"
  tools: []
  feedBackVerdict: SUMMARIZE
  hitl_required: true
  isHITLContinuation: true
→ summarizer renders the clarifying question to the user
→ graph checkpoints (LangGraph persists state to MongoDB)
→ [WAITING FOR USER]

── Turn N+1: User replies — new HTTP request ────────────────────────────────────
State loaded from checkpoint: isHITLContinuation=true

  [orchestrator.ts L347]  ambiguityStr = ""   ← suppressed because isHITLContinuation=true
  [orchestrator.ts L649]  HITL Context Bridge: injects priorReformulated into QnA transcript
  [orchestrator.ts L1193] isHITLContinuation = false (reset for next iteration)

→ LLM reads context + user reply → plans mcp.resolve_entities call
→ execute_tools runs
→ update_memory2 runs:
    Phase 1: aggregates resolve results → determines if still ambiguous or resolved
    Phase 2: HITL Q→A pair injected into memory update prompt
    isHITLContinuation = false written to state (update_memory2 L672)
→ If resolution succeeded → SUMMARIZE path → response to user
→ If still ambiguous → new HITL cycle begins
```

### The HITL Context Bridge (orchestrator.ts L645–657)

```typescript
const isHITLIter0 = !!state.isHITLContinuation && iterationCount === 0;
const priorReformulated = state.reformulatedQuery || rawQuery;

if (isHITLIter0 && priorReformulated && currentQuery !== priorReformulated) {
    qnaTranscript += `[ACTIVE INTENT — current conversation, not yet in history above]\n`;
    qnaTranscript += `${priorReformulated}\n\n[USER REPLY to the above]\n`;
}
// followed by: qnaTranscript += `HUMAN: ${currentQuery}`;
```

**Why `reformulatedQuery` is the right carrier:** The LLM updates `reformulatedQuery` each
turn with its running best-understanding of the task. By the time a HITL question fires,
`reformulatedQuery` contains the ambiguity context: e.g., "Resolve CCCCCCC which matched
Machinery/Component/Activity — awaiting user disambiguation." This is the correct context
for the LLM to map the user's reply "Machinery" to a concrete resolution action.

**Known label issue → Fix A in §7:** The label `[ACTIVE INTENT]` frames this as a goal, not
as a clarifying-question context. It should be `[ACTIVE CLARIFICATION CONTEXT]` during HITL
turns to signal to the LLM that this is a Q→A bridge, not just a task description.

### update_memory2 HITL Q→A Injection (L339–384)

`update_memory2` independently injects the HITL exchange into its Phase 2 LLM prompt:

```typescript
// Walks messages backward, finds last HumanMessage
// Checks if preceding AIMessage looks like a clarifying question (len < 300)
// Injects:
`CONTEXT REFINEMENT (user answered a clarifying question):
  Original question: "${rawQuery}"
  AI asked: "${clarifyingQuestion}"
  User replied: "${lastHumanContent}"`
```

This ensures `pendingIntents` and `activeFilters` are updated to reflect the user's scoping
answer, not mistakenly treated as a brand new query topic.

---

## 5. Ambiguity Resolution Protocol

### Stage 1 — Detection (update_memory2.ts Phase 1)

All `mcp.resolve_entities` results in the current turn are aggregated by search term:

```typescript
// labelToMatches: { "CCCCCCC": [candidate1, candidate2, candidate3, ...] }
for each [label, matches]:
  if matches.length === 1 → PROMOTE: resolvedLabels[label] = {id, type}; sessionScope[typeID] = id
  if matches.length  >  1 → AMBIGUOUS: push to ambiguousMatches[]
```

### Stage 2 — Resolution Gate (update_memory2.ts Phase 1): VESTIBULE PRUNING

Before setting `ambiguousMatches` in state, a cross-check runs against `resolvedLabels`:

```typescript
const resolvedIdsSet = Set of all IDs already in resolvedLabels

const unresolvedAmbiguousMatches = ambiguousMatches.filter(entry => {
    const chosenCandidate = entry.candidates.find(c => resolvedIdsSet.has(c.id));
    if (chosenCandidate) {
        // The user already picked this specific ID in a prior turn
        resolvedLabels[entry.label] = { id: chosenCandidate.id, type: chosenCandidate.type };
        return false; // drop from ambiguousMatches — resolved
    }
    return true; // still genuinely unresolved — keep
});
```

**Exit gate:** For an ambiguity to be pruned, a specific candidate ID must already be in
`resolvedLabels`. This happens either through single-hit resolution promotion or via the
Phase 19 `ambiguitiesResolved` signal.

### Stage 4 — Deterministic Finalization (update_memory2.ts Phase 1)

This is the definitive "end" of an ambiguity cycle. It relies on an explicit signal from the LLM:

1. **The Signal**: LLM sets `ambiguitiesResolved: ["LABEL"]` in its response.
2. **The Logic**: `update_memory2` Phase 1 reads `state.ambiguitiesResolved`.
3. **The Action**:
   - For each signaled label, it finds the candidate that matches the ID being used in the current tool calls.
   - It promotes that candidate to `resolvedLabels`.
   - It deletes the label from `ambiguousMatches`.
4. **Result**: The ambiguity is cleared with zero heuristics and zero false-positives.

---

### Stage 3 — Prompt Injection (orchestrator.ts L347–354)

```typescript
const ambiguityStr = (state.isHITLContinuation)
    ? ""   // ← suppressed on user-reply turn (correct)
    : session?.scope?.ambiguousMatches?.length
        ? `⚠️ AMBIGUITY DETECTED ⚠️
The following labels matched MULTIPLE distinct entity types. You MUST ask the user for
clarification before attempting any retrieval.
${candidates rendered as: "LABEL" matched: CandidateA (TypeA), CandidateB (TypeB), ...}
⚠️ MANDATORY ACTION: Set clarifyingQuestion telling the user exactly which entity types
were found and ask which one they meant. Set tools=[] and feedBackVerdict=SUMMARIZE.`
        : "";
```

---

### The Two Levels of Ambiguity — Critical Distinction

The system currently only handles **Level 1** (type ambiguity). There are actually two levels:

```
LEVEL 1 — TYPE AMBIGUITY (candidates span multiple entity types):
  "CCCCCCC" matched: Machinery (3 hits), Component (2 hits), Activity (0 hits)
  Correct question: "Did you mean a Machinery item, a Component, or an Activity?"

LEVEL 2 — INSTANCE AMBIGUITY (all candidates share the same type):
  User replied "Machinery" → resolve_entities(entityType=Machinery) → 3 Machinery records
  ambiguousMatches = [{ label: "CCCCCCC", candidates: [MachineryA, MachineryB, MachineryC] }]
  Correct question: "I found 3 Machinery items named CCCCCCC:
    1. CCCCCCC Unit A (ID: 68ab...)
    2. CCCCCCC Pump B (ID: 68cd...)
    3. CCCCCCC Motor C (ID: 68ef...)
  Which one did you mean?"
```

**The current MANDATORY ACTION wording is hardwired for Level 1 only.** When Level 2
triggers, the prompt still says "ask which entity TYPES were found" — factually wrong.
The user answers "Machinery" again. System resolves Machinery again. Gets 3 hits again.
ambiguousMatches repopulated again. MANDATORY ACTION fires again. Infinite loop.

✅ **RESOLVED (Phase 17/18):** Two-level detection and rendering now implemented in
`orchestrator.ts`. Level 2 renders a numbered list of candidate labels + IDs and instructs
the LLM to ask the user to pick by name. The `[RIGHT NOW]` Ambiguity field also reflects
the instance-level state. The HITL+Retrieval Finalization (Fix I9) ensures `ambiguousMatches`
is cleared once the user picks and retrieval runs, permanently ending the loop.

See Fix B in §7.

---

## 6. Context Assembly — How the Prompt Is Built

### System Message Structure (assembled in orchestrator.ts)

```
━━━ SESSION CONTEXT ━━━
[Date/Time | Organization: fleetships | Vessels: 7]
[Fatal Error Instruction — injected if prior turn crashed]
[System Intercept Reasoning — guard override explanation if applicable]

━━━ GROUNDING BLOCKS ━━━
[🌐 Broad Scope Mode — if isBroadScope=true]
[🏢 Org Context — orgID, orgShortName, isHITLContinuation label]

━━━ HISTORICAL MEMORY ━━━
[📚 Long Term History — compressed conversations beyond rolling window]
[🛰️  Recent Observational Memory — last 7 summaryBuffer {q,a} pairs, oldest first]

━━━ ENTITY SCOPE ━━━
[🗃️  Secondary Scope — rolling 7-conv entity ledger with name, type, ID, conv index]
[🆔 Resolved Entities — resolvedLabels mapping for this entire session]

━━━ CURRENT STATE ━━━
[⚠️ Ambiguity Detected — if ambiguousMatches non-empty AND !isHITLContinuation]
[🔎 Current Query Context — rawQuery, pendingIntents, activeFilters, currentScope]
[🛑 Dead-End Labels — failedSessionLabels + ambiguousSessionLabels for THIS request cycle]

━━━ DECISION LOG ━━━
[📓 Session Decision Journal — per-iteration: tool calls + verdicts for THIS request]

[orchestrator_rules.ts content appended here as additional system instructions]
```

### User Message Structure (QnA Transcript, assembled in orchestrator.ts L620–668)

```
🎯 CURRENT INVESTIGATION CONTEXT
Review the conversation history below to understand the final unified goal.

--- CONVERSATION HISTORY ---
HUMAN: <summaryBuffer[0].q>

ASSISTANT: <summaryBuffer[0].a>

...

[only during HITL turns — injected by bridge code]
[ACTIVE CLARIFICATION CONTEXT — you asked the user a question; their reply is below]
<priorReformulated>

[USER'S ANSWER]
HUMAN: <latestHumanContent>
--- END HISTORY ---

Instruction: Proceed with your investigation based on the complete context provided above.
```

**Key design point:** The user message is the last thing the LLM reads before generating.
This means it has the highest positional salience. The QnA transcript is the primary action
driver. The system message blocks (AMBIGUITY, pendingIntents, etc.) are reference material.
Fix C in §7 exploits this by moving the "right now" state summary into the user message,
immediately before the current human turn.

---

## 7. Known Issues and Planned Fixes

Identified from live session analysis (thread `69e50bc197c986d57ecaaab4`, 228 turns,
stuck on CCCCCCC disambiguation). All four fixes are planned. Implement in order A→B→C→D.

---

### Fix A — HITL Bridge Label Misleads the LLM
✅ **RESOLVED.** Label changed from `[ACTIVE INTENT]` to
`[ACTIVE CLARIFICATION CONTEXT — you asked the user a question; their reply follows]`
in `orchestrator.ts`. The LLM now correctly frames the HITL exchange as a clarifying Q→A
rather than a task goal.

---

### Fix B — MANDATORY ACTION Hardwired for Type-Disambiguation Only (Primary Loop Driver)
✅ **RESOLVED.** Two-level ambiguity detection and rendering implemented in `orchestrator.ts`.
- **Level 1 (type ambiguity):** `distinctTypes.size > 1` → "Did you mean Machinery, Component, or Activity?"
- **Level 2 (instance ambiguity):** `distinctTypes.size === 1` → Numbered list of candidate labels + IDs
  (`⚠️ INSTANCE SELECTION REQUIRED: 3 Machinery records: 1. ccccccccccccc [ID], 2. ccccccc [ID], 3. ccccccc [ID]`)
The LLM is instructed to ask the user to pick by name, not by type.

---

### Fix C — Action-Critical State Too Far from Generation Point
✅ **RESOLVED.** A `[RIGHT NOW]` status block is injected at the end of the QnA transcript,
immediately before `HUMAN: <currentQuery>`. It contains Goal, Pending, Filters, and Ambiguity
in the highest-salience position. `orchestrator_rules.ts` Section XI defines the reading
protocol: Ambiguity > Pending > Conversational.

---

### Fix D — Ambiguity Block Re-fires Within the Same HITL Reply Request
✅ **RESOLVED.** `shouldSuppressAmbiguity` now checks `isHITLContinuation === true` only.
`ambiguousSessionLabels` tracks labels processed this request cycle, preventing re-fires
mid-iteration. Implemented in `orchestrator.ts`.

---

### Fix E — ambiguousMatches Never Cleared After User Picks (NEW — Phase 18)
✅ **RESOLVED.** Root cause of 31/33 `🔁 LOOP` conversations in production thread analysis.

**Problem:** When the user selects a candidate from the disambiguation list and retrieval
runs, `ambiguousMatches` is never cleared. It persists in every checkpoint because:
- No new `mcp.resolve_entities` runs → `labelToMatches` is empty → the existing block
  only deletes `ambiguousMatches` when there are "no new" ambiguities — but it's inherited
  from the previous checkpoint via the scope spread (`{...existingMemory.sessionContext.scope}`)
- The Vestibule Pruning cross-check only fires when a candidate ID is in `resolvedLabels` —
  but the user's pick is expressed via natural language ("first one"), never written as a
  single-hit `mcp.resolve_entities` promotion → `resolvedLabels` never gets that ID

**Fix (update_memory2.ts — HITL+Retrieval Finalization block):**
After Vestibule Pruning, a new block fires when:
```
isHITLContinuation === true AND any non-resolve retrieval tool ran this cycle AND inheritedAmbiguousMatches.length > 0
```
Actions:
1. Registers each ambiguous label → `resolvedLabels` with the first candidate (Vestibule skip)
2. Deletes `ambiguousMatches` from scope entirely
3. Logs `🏁 AMBIGUITY FINALIZED` + `🧹 HITL+Retrieval: cleared N ambiguous match(es)`

---

### Fix F — scheduleID ≠ machineryID (NEW — Phase 18)
✅ **RESOLVED.** Added `⛔ ENTITY TYPE INTEGRITY` rule to `orchestrator_rules.ts` Section III.2.
Explicitly forbids passing a `machineryID` as `scheduleID`. The LLM must call
`maintenance.query_schedules(machineryID=...)` to discover the actual schedule ID first.
Confirmed by MongoDB data: Conv 31 showed same ID passed to both params, looped 5×.

---

### Fix G — [Clarification] prefix sticks in summaryBuffer (NEW — Phase 18)
✅ **RESOLVED.** Added Rule 4 to the Phase 2 system prompt in `update_memory2.ts`:
If a retrieval tool ran this turn AND `rawQuery` starts with `[Clarification]`, the LLM
must rewrite it as a clean concrete statement of the resolved intent. Prevents the LLM from
re-entering disambiguation reasoning on subsequent turns by reading stale `[Clarification]`
entries in `summaryBuffer`.

---

## 8. Code-Level Guards Reference

All guards live in `orchestrator.ts` and fire AFTER the LLM responds, potentially overriding it.

| Guard | Lines | Fires When | Effect |
|-------|-------|------------|--------|
| Loop Breaker | ~L812 | Anti-Placeholder stripped ALL tools, verdict=FEED_BACK_TO_ME | Force SUMMARIZE |
| Fallback Search Intercept | ~L823 | AI set `useFallbackSearch=true`, tools=[], no clarifying Q | Inject `direct_query_fallback` |
| Discovery Stall Guard | ~L902 | Prev turn=discovery, no retrieval this cycle, SUMMARIZE, pendingIntents>0, no ambiguity | Override to FEED_BACK_TO_ME |
| Fallback Dedup Guard | ~L948 | `direct_query_fallback` already ran this cycle AND AI requests it again | Strip redundant call |
| Empty Result Fallback Guard | ~L991 | tools=[], SUMMARIZE, last retrieval returned 0 items, fallback not run | Auto-inject `direct_query_fallback` |
| Strategic Intercept | ~L1099 | AI has `unclassifiedLabels` not yet in `resolvedLabels` | Replace plan with `mcp.resolve_entities`, loop back |
| HITL Precedence Guard | ~L1308 | `clarifyingQuestion` emitted BUT a code guard already overrode verdict | Suppress clarifying question |

### Anti-Placeholder Guard

Strips any tool call argument containing placeholder text (`<vesselID>`, `PLACEHOLDER`, etc.).
If ALL tools are stripped, the Loop Breaker fires to prevent an empty-tool FEED_BACK_TO_ME loop.

### VESTIBULE PRUNING (update_memory2.ts L201–224)

The exit gate for ambiguity HITL cycles. If any candidate ID from `ambiguousMatches` is
already in `resolvedLabels`, that entry is dropped and the label registered as resolved.
This fires automatically when a single-hit `mcp.resolve_entities` result promotes a
candidate ID via the `matches.length === 1` path.

---

## 9. Debug Tooling

All scripts are in `backend/scripts/`. Run from the `backend/` directory.

### find_latest_thread.ts
```bash
npx tsx scripts/find_latest_thread.ts 2>/dev/null
# Prints: <thread_id>
```

### debug_chat_analysis.ts
```bash
npx tsx scripts/debug_chat_analysis.ts <thread_id> 2>/dev/null
# Per-conversation summary: PASS / HITL / WARN / FAIL + health score
```

### debug_session_history.ts
```bash
npx tsx scripts/debug_session_history.ts <thread_id> 2>/dev/null
# Per-turn: rawQuery, activeFilters, tools run with item counts, lastTurnInsight
```

### analyse_last_n_threads.ts (NEW — Phase 18)
```bash
npx tsx scripts/analyse_last_n_threads.ts [N]
# Default N=6. Fetches the last N distinct thread_ids from MongoDB and runs
# conversation health analysis on each. Shows per-conversation PASS/HITL/WARN/LOOP/FAIL
# verdicts, ambiguousMatches presence, failedSessionLabels, HITL questions, and tool summaries.
# Use this to audit the health of recent sessions before making architectural changes.
```

### Canonical one-liner (latest thread, full analysis)
```bash
THREAD=$(npx tsx scripts/find_latest_thread.ts 2>/dev/null)
npx tsx scripts/debug_chat_analysis.ts $THREAD 2>/dev/null
npx tsx scripts/debug_session_history.ts $THREAD 2>/dev/null | head -200
```

### Reading debug output — key signals

| Signal | Meaning | Action |
|--------|---------|--------|
| `🔶 HITL` on a single conversation | AI asked a clarifying question | Expected — check if next conv resolves it |
| `🔶 HITL` repeating 5+ times on same query | HITL loop — Fix E likely needed | Check if `ambiguousMatches` shows same label |
| `(none — memory re-surface)` in tools | Orchestrator answered from memory with no tools | Check if this was correct or a stall |
| `⚡ ambiguousMatches was populated` | Inherited ambiguity present in this conversation | Check if HITL+Retrieval Finalization fired |
| `💀 failedSessionLabels detected` | Dead-end label (0 hits) | System should ask user to clarify |
| `🔁 LOOP` same resolve tool 3+ times | Vestibule re-firing — check resolvedLabels | Likely ambiguousMatches not cleared |
| `⚠ iter=6` | Approaching hard cap | Investigate why so many iterations needed |
| Same `rawQuery` across 10+ turns | summaryBuffer staleness or stall | Check activeFilters and pendingIntents |
| `Health Score: 94%` | Most convs PASS or expected HITL | Normal — HITL convs count as healthy |

---

## 10. Architectural Invariants — Do Not Break

These invariants were established through multiple debugging cycles. Breaking them reintroduces
previously fixed bugs documented in `handover4.md`.

### I1 — `rawQuery` is NEVER overwritten with the HITL user reply
The user's terse HITL answer must NOT become the new `rawQuery`. It stays anchored to the
original human question. Violations cause Phase 2 to strip domain context and stall.
**Fixed by:** §55 in `update_memory2.ts` `rawQuery` resolution logic.

### I2 — `isNewQuery` is determined ONLY by `(iter <= 1) && !isHITLContinuation`
Do NOT add `startTurnIndex`, `existingRawQuery`, or text-match conditions.
**Reason:** `startTurnIndex` is a lifetime offset that is always >0 for follow-up questions,
which would permanently lock them to the first query's topic.

### I3 — `ambiguousMatches` lifecycle is strictly deterministic
`ambiguousMatches` is set/cleared ONLY by `update_memory2` Phase 1 via three paths:
1. **New ambiguity found** (this turn's `mcp.resolve_entities` returned >1 hits) → set
2. **All ambiguities cross-checked against resolvedLabels** (Vestibule Pruning) → delete if all resolved
3. **LLM Signal Finalization** (Phase 19 — I9): LLM explicitly lists labels in `ambiguitiesResolved[]`
   while calling a retrieval tool with a specific candidate ID → force-clear and register in `resolvedLabels`.

The orchestrator reads `ambiguousMatches`; it never writes it directly.

### I4 — The Strategic Intercept is bypassed ONLY for atomic meta-tools
Only `mcp.clear_filters` and `mcp.query_active_filters` may bypass the intercept. All other
tool types must go through resolution if `unclassifiedLabels` exist. Generic bypasses
(checking if label appears in any arg) were removed — they allowed entity names in wrong args
to silently skip resolution.

### I9 — `ambiguitiesResolved` is the ONLY signal for clearing ambiguities
Heuristic-based clearing (e.g. "retrieval ran without resolve calls") is forbidden. An ambiguity is only cleared from state when the LLM explicitly includes the label in the `ambiguitiesResolved` array of its response. This signal MUST only be sent when the LLM has identified the correct candidate and is calling a data-retrieval tool with its ID in the same turn.

### I10 — machineryID MUST NOT be passed as scheduleID
These are different entity types with separate ObjectId namespaces. To find the schedule for
a known machinery, `maintenance.query_schedules(machineryID=<id>)` must be called first.
This rule is encoded in `orchestrator_rules.ts` Section III.2 (⛔ ENTITY TYPE INTEGRITY).

### I5 — `secondaryScope` is written ONLY by the summarizer
The summarizer promotes `currentScope → secondaryScope` with conversation indexing and
7-conv pruning. Neither orchestrator nor `update_memory2` writes it. Violations create
duplicate entries and break rolling-window pruning.

### I6 — `resolvedLabels` lookups are always lowercase-normalised
```typescript
const resolvedLabelSet = new Set(Object.keys(resolvedLabels).map(k => k.toLowerCase()));
```
The LLM can capitalise entity names differently ("XXX1" vs "xxx1"). Lowercase normalisation
prevents redundant resolution turns.

### I7 — Use `updates.feedBackVerdict`, not `response.feedBackVerdict` in guard logic
Multiple code guards can override the LLM's raw verdict. `updates.feedBackVerdict` is the
authoritative post-guard value. `response.feedBackVerdict` is the raw LLM value that may
have already been overridden earlier in the same orchestrator turn.

### I8 — Boolean flags must be set EXPLICITLY (never `undefined`)
The LangGraph LastValue reducer treats `undefined` as "no write" and keeps the old value.
`isHITLContinuation: false`, `isBroadScopeRequest: false`, `isDomainPivot: false` must all
be explicitly set. Setting them to `undefined` preserves the prior checkpoint value.

---

## Appendix: State Channel Reference

| Channel | Type | Reducer | Notes |
|---------|------|---------|-------|
| `messages` | BaseMessage[] | Append | All user/AI messages, grows unbounded |
| `workingMemory` | object | LastValue | Full memory object replaced each update |
| `summaryBuffer` | array | LastValue | Managed entirely by summarizer |
| `toolResults` | array | LastValue | Capped at 30 entries in graph.ts |
| `toolCalls` | array | LastValue | Set by orchestrator, consumed by execute_tools |
| `feedBackVerdict` | string | LastValue | FEED_BACK_TO_ME / SUMMARIZE |
| `hitl_required` | boolean | LastValue | Must be explicit `false` to clear |
| `isHITLContinuation` | boolean | LastValue | Must be explicit `false` to clear |
| `isBroadScopeRequest` | boolean | LastValue | Must be explicit `false` to clear |
| `isDomainPivot` | boolean | LastValue | Must be explicit `false` to clear |
| `iterationCount` | number | LastValue | Reset to 0 by graph on new request |
| `startTurnIndex` | number | LastValue | Set to `toolResults.length` at request start |
| `reformulatedQuery` | string | LastValue | Carries forward until next SUMMARIZE |
| `parallelizeTools` | boolean | LastValue | Orchestrator declares; execute_tools honours |
| `ambiguitiesResolved`| string[] | LastValue | Explicit LLM signal to finalize resolution |

---

*Last updated: 2026-04-21 | Phase 19 (Deterministic Ambiguity Resolution) | ceb75660 | Supersedes handover4.md*
