# 🛂 Agentic Handover (Volume 2)

> [!NOTE]
> This document is a continuation of the primary [handover.md](file:///home/phantom/testcodes/SkylarkAI/handover.md). Please refer to the original document for early-phase architectural context and security baseline.

---

## 🛠️ 47. Constitution-Based Architecture (The Maritime Constitution)
In this phase, we successfully decoupled the agentic reasoning protocols from the brittle TypeScript node runtimes. The system now operates under a "Constitution-Based" model.

### Key Implementation Details:
- **Modular Rules**: All behavioral instructions for the **Orchestrator** and **Summarizer** now reside in standalone Markdown files:
  - [orchestrator_rules.md](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.md)
  - [summarizer_rules.md](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/summarizer_rules.md)
- **Prompt Hydration**: Implemented [prompt_loader.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/utils/prompt_loader.ts) to dynamically inject Maritime Knowledge and Schema Context at runtime, ensuring clean separation of concerns.

---

## 🛠️ 48. structural Entity Resolution (ID Collision Remediation)
We resolved a high-fidelity "ID Collision" bug where the AI confused **Budget IDs** with **Cost Center IDs** during context turnover.

### 🟢 Structural Fixes:
- **Code-Level Resolution**: Updated [lookup_logic.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/lookup_logic.ts) to provide first-class support for `entityType: "cost_center"`. The resolution engine is now structurally wired to distinguish between parent IDs (`_id`) and canonical foreign keys (`costCenterID`).
- **Generic Memory Guard**: Added a new **Section VII (The Context Rule)** to [summarizer_rules.md](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/summarizer_rules.md). This mandates explicit ID labeling (e.g., `budgetID=...`) and strict isolation between human-readable labels and non-canonical database IDs.
- **Prompt Hygiene**: Stripped all specific database examples (e.g., specific cost center codes) from the reasoning anchors, ensuring the constitutions remain data-agnostic and focused on architectural patterns.

---

## 🛠️ 49. Orchestration & Discovery Hardening (Parallel Chaining Remediation)
We identified and resolved a critical "Parallel Chaining" hallucination where the Orchestrator attempted to use placeholders (e.g., `"<resolved_id>"`) in parallel tool calls instead of executing discovery and retrieval in sequential turns.

### 🟢 Implementation Hardening:
- **Sequential Turn Mandate**: Added **Section II.5 (The Dependency Gate)** to [orchestrator_rules.md](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.md). This strictly forbids placeholder chaining and mandates a 2-turn cycle for Discovery-to-Retrieval transitions.
- **Nested Field Resolution**: Patched [lookup_logic.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/lookup_logic.ts) with a new `getNestedValue` helper. This allows the discovery engine to correctly resolve dot-notation paths like `costCenter.code` and `costCenter.name` from nested tool responses, preventing silent "No Match" failures.
- **Contract Fidelity**: Updated [contract.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/contract.ts) with an explicit definition for the `searchTerm` parameter to prevent key-name hallucinations (e.g., using `query` instead of `searchTerm`).
- **Reasoning Anchors**: Added a new `❌ BAD — Parallel Chain (Dependency Violation)` example to the Orchestrator's reasoning examples (Section VII) to reinforce correct turn-based behavior.

- **Discovery-Local Execution**: Identified and patched a 404 proxy error by routing `mcp.resolve_entities` to a local execution bridge in [mastra/tools.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mastra/tools.ts). This ensures discovery tools are truly isolated and data-agnostic while executing on the backend rather than hitting non-existent external endpoints.
- **Proxy Metadata Alignment**: Resolved a critical "Invalid URL" bug in [lookup_logic.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/lookup_logic.ts) by mapping contract `path` to `_originalPath`. This ensures internal discovery calls to core retrieval tools (like `budget.query_overview`) construct valid URLs for the backend proxy.

---

## 📑 Final Session Checklist:
- [x] **Discovery Local Routing**: Confirmed `mcp.resolve_entities` executes locally, bypassing the 404 proxy error.
- [x] **Proxy Metadata Alignment**: Verified `_originalPath` mapping in `lookup_logic.ts` fixes the `Invalid URL` sub-call error.
- [x] **Cost Center Resolution**: Verified that `cost_center` discovery correctly extracts the foreign key `6985d4bb4f228fba6deacfdf` (33 transactions).
- [x] **Nested Path Support**: Confirmed `getNestedValue` in `lookup_logic.ts` correctly traverses `costCenter.code` and `costCenter.name`.
- [x] **Sequential Logic**: Verified the Orchestrator (Rule II.5) and the ExecuteTools node (Dependency Gate) enforce a Resolve -> Query turn cycle.
- [x] **Build Integrity**: Verified the system remains compilable (`npx tsc --noEmit`) after all structural logic updates.

---

## 🛠️ 50. Two-Tier Agent Memory & Discovery Consistency
We completely re-architected the agent's memory system to eliminate hallucination and context bloat, alongside fixing a critical "Measurement Gap" in the discovery engine.

### 🟢 Memory Architecture (State Hardening):
- **Two-Tier Schema (`AgentMemory`)**: Replaced redundant and conflicting memory fields (`summaryBuffer`, `extractedEntities`, `activeTopics`) with a structured schema in [state.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/state.ts).
  - **Tier 1 (Session Context)**: Persists conversation-wide. Contains a deterministic **Entity Ledger** (`resolvedEntities`) strictly populated by code logic, nullifying LLM hallucination risks for IDs.
  - **Tier 2 (Query Context)**: Resets per user question. Restricts the LLM context to `rawQuery`, `pendingIntents`, `activeFilters`, and a single `lastTurnInsight` sentence.
- **Code-Driven vs LLM-Driven (`update_memory2.ts`)**: Built a bifurcated memory update node ([update_memory2.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts)). Phase 1 extracts canonical Entity IDs cleanly into Tier 1 via pure code extraction. Phase 2 leverages Zod's structured output for strict, concise Tier 2 intent parsing. 
- **HITL Continuation Logic**: Implemented an explicit `isHITLContinuation` flag to flawlessly bypass the Tier 2 memory reset when a user answers a clarifying question, safeguarding conversational flow.

### 🟢 Orchestration & Prompt Hardening:
- **Entity Ledger Mandate**: Enforced **Rule II.7** in the [orchestrator_rules.md](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.md) constitution. The Orchestrator is expressly mandated to draw resolved IDs instantly from its injected Tier 1 Ledger without querying `mcp.resolve_entities` again.
- **Structured Context Injection**: Dropped unstructured prose injection (~1,500 tokens) in [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts) in favor of a synthesized ledger layout (~150 tokens) containing strictly valid schema context for optimal token utility and reasoning focus.
- **Discovery Engine Parity**: Standardized [lookup_logic.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/lookup_logic.ts) to adhere strictly to LangGraph’s array counting standards by returning an `items` envelope instead of `matches`, solving upstream "0 items found" downstream hallucination loop failures. Aligned this signature cleanly in [contract.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/contract.ts).

### 📑 Two-Tier Verification:
- [x] **Discovery Array Integrity**: Confirmed `<entity_type>` lookups produce the `items` array properly mapped within the standard MCP `capability` envelope.
- [x] **Update Memory 2**: Validated deterministic code extraction successfully persists hex IDs to the `.sessionContext.resolvedEntities` state ledger natively.
- [x] **Zod Model Compliance**: Verified LLM query context executes purely against `queryContextSchema` and populates the `activeFilters`/`pendingIntents`.
- [x] **Orchestrator Injection**: Confirmed the payload strictly strips down to the localized `SESSION CONTEXT` schema rather than bloating with summary paragraphs.

---

## 🛠️ 51. Zod Runtime Hardening & Entity Resolution Refinement
We resolved a critical runtime crash in the `update_memory2` node caused by schema incompatibilities and refined the discovery engine to prevent ID type conflation.

### 🟢 Zod Crash Mitigation (Google GenAI Compatibility):
- **Schema Transformation**: Replaced `z.record(z.string())` for `activeFilters` with a more robust `z.array(z.object({ key: z.string(), value: z.string() }))`. This bypasses a known limitation in the `google-genai` provider's ability to generate valid JSON schemas for recursive record types.
- **Node-Level Resilience**: Moved the `withStructuredOutput` instantiation and model invocation inside a `try-catch` block in [update_memory2.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/update_memory2.ts). This ensures that schema parsing failures gracefully degrade (preserving current memory) rather than crashing the entire LangGraph orchestration loop.
- **Filter Re-mapping**: Implemented a post-parsing loop to map the array of filter objects back into the standard `Record<string, string>` structure expected by the backend, maintaining 100% downstream compatibility.

### 🟢 Cost Center Resolution Fidelity:
- **ID Field Alignment**: Updated [lookup_logic.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/lookup_logic.ts) to explicitly map the `cost_center` entity type to the `costCenterID` field.
- **Collision Prevention**: Previously, the engine defaulted to the parent `_id` (Budget ID) when the nested `costCenter._id` was missing. By targeting the canonical scalar `costCenterID` returned by `budget_query_overview`, we eliminated a collision where one cost center was incorrectly resolving to multiple distinct Budget IDs.

### 📑 Final Session Checklist:
- [x] **Zod Schema Hardening**: Confirmed `update_memory2` no longer crashes when using the Google GenAI provider.
- [x] **Memory Resilience**: Verified that memory state is preserved even if the LLM returns slightly malformed structured output.
- [x] **Cost Center Fidelity**: Validated that `cost_center` resolution now returns unique hex IDs targeting the Cost Center entity, not the Budget container.
- [x] **Build Integrity**: Confirmed the system remains compilable (`npx tsc --noEmit`) after schema updates.

---

## 🛠️ 52. Orchestration Hardening (Defensive JSON Parsing & Prompt Structure)
We identified and resolved a critical graph-crashing bug where the Orchestrator would fail to return a valid plan when outputting double-JSON payloads (a known hallucination pattern in strict schema modes).

### 🟢 Structural Prompt Fixes:
- **System Message Merge**: During the MD migration, the system prompt was split into two separate `{"role": "system"}` messages (one for rules, one for memory). This structural boundary caused the `jsonSchema` structured output mode to re-bind and double-emit its JSON output (`"JSON\nJSON"`).
- **Inlined Memory Context**: Modified [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts) to inline the `OBSERVATIONAL MEMORY CONTEXT` directly into the singular `system` string. This restores the pre-migration prompt structure, eliminating the double-emit trigger entirely while keeping the `orchestrator_rules.md` constitution lean.
- **Native Array Mapping Restored**: We verified that advanced LLMs natively map "per entity" requests to parallel tool calls (due to the `tools` array schema) without needing bloated, explicit "Parallel-Per-Entity" examples spoon-fed into their constitution. Reverted unnecessary prompt bloat to preserve token efficiency.

### 🟢 Defensive JSON Recovery:
- **Array-Wrap Fallback Parsing**: Implemented a rock-solid, defensive JSON parser in the null-response guard of [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts). If the model ever double-emits its schema, the parser safely wraps the raw text boundaries (`}\\s*{` to `},{`) in an array bracket `[]` and extracts the first valid Zod-compliant object via `safeParse`.
- **Brace-Counting Resilience**: Added a secondary fallback that uses pure brace-counting to extract JSON objects if the LLM returns pretty-printed payloads that break standard regex splits, guaranteeing the orchestrator never crashes on formatting quirks.

### 📑 Final Session Checklist:
- [x] **Prompt Hygiene**: Reverted explicit "Parallel-Per-Entity" anchoring from `orchestrator_rules.md` to rely on the LLM's native array schema capabilities.
- [x] **System Message Consolidation**: Verified that `orchestrator.ts` injects the memory block identically using a single `system` boundary.
- [x] **Defensive Extraction**: Confirmed the fallback parser uses array-wrapping and brace-counting to safely recover from `null` structured outputs.
- [x] **HITL Integrity Check**: Audited `graph.ts` state flow to confirm `isHITLContinuation` inherently persists across the turn boundary without requiring `workflow.ts` modification.

---

## 🛠️ 53. Post-Review Gap Closure (HITL Org Guard & Log Fidelity)
Three gaps identified and closed during a post-implementation review of Section 52's changes.

### 🔴 Gap 1 — `✅ Org confirmed: undefined` (Critical LLM Confusion)
- **Root Cause**: When `isHITLContinuation = true` but `sessionContext.scope` is still empty (tools haven't run yet on the continuation turn), the `orgContextBlock` template evaluated `session?.scope?.organizationShortName` to `undefined`. The LLM saw `✅ Org confirmed: undefined` — a green tick next to the literal word "undefined" — and would hallucinate `organizationShortName: "undefined"` into tool args, causing all tool calls to silently fail with a scope miss.
- **Fix**: Split the ternary into a three-way branch in [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts):
  1. `shouldShowOrgWarning = true` → show the ⚠️ mandatory check block.
  2. `shouldShowOrgWarning = false` AND `hasOrgContext = true` → show `✅ Org confirmed: <name>`.
  3. `shouldShowOrgWarning = false` AND `hasOrgContext = false` (HITL continuation with empty scope) → show `✅ HITL Continuation Active: ...extract the organization from their latest message`.

### 🟡 Gap 2 — Redundant Memory Context Header (Minor Structural Noise)
- **Root Cause**: `memoryBlock` was assembled as `### OBSERVATIONAL MEMORY CONTEXT\n[Context from Previous Moves]: ${memoryContext}`, but `memoryContext` itself already begins with `\n### 🗂️ SESSION CONTEXT`. The `[Context from Previous Moves]:` label appeared directly before that section header, creating a confusing double-header structure.
- **Fix**: Removed the redundant `[Context from Previous Moves]:` prefix from `memoryBlock`. The block now reads cleanly as `### OBSERVATIONAL MEMORY CONTEXT\n${memoryContext}`.

### 🟢 Gap 3 — Console Coloring Regex No Longer Matched (Cosmetic)
- **Root Cause**: The previous coloring regex looked for `"### OBSERVATIONAL MEMORY CONTEXT\n"` as a standalone quoted JSON value — the format when memory was a separate second system message. After inlining, the string is embedded inside a larger `content` value, so the exact quoted-string regex never matched.
- **Fix**: Updated all three coloring `.replace()` calls in [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts) to match the substrings directly within the content body (no surrounding quotes). Also added `### 🗂️ SESSION CONTEXT` coloring and updated `### 🔄 SYSTEM FLAG: ITERATIVE TURN` to match the renamed header.

### 📑 Gap Closure Checklist:
- [x] **HITL Org Guard**: Three-way `orgContextBlock` branch prevents `undefined` from ever appearing as a confirmed org value.
- [x] **Memory Header**: `[Context from Previous Moves]:` prefix removed — memory block now structurally clean.
- [x] **Console Coloring**: All regex patterns updated to match inlined content — `### OBSERVATIONAL MEMORY CONTEXT`, `### 🗂️ SESSION CONTEXT`, and `### 🔄 SYSTEM FLAG: ITERATIVE TURN` now colour correctly in logs.

---

## 🛠️ 54. Constitution Re-Anchoring: Entity Distribution & Org Strictness

### 1. Removing Org Name LLM Hallucinations
- **Problem**: In the `⚠️ ORG CONTEXT MISSING` warning, the prompt literally told the Orchestrator `- IF the user DID NOT provide an organization name... You MUST set clarifyingQuestion to ask for their organization name`, driving the LLM to use the invalid DB schema key `organizationName`.
- **Fix**: Replaced all instances of "organization name" in the guard fallback text with strictly `"organization short name"`. Also scrubbed `"for <OrgName>"` examples to prevent the LLM from trying to populate the wrong JSON parameter key.
- **Result**: The LLM securely asks solely for the short name, and `mcp.service.js` validation natively routes the correct query mapping.

### 2. Restoring the 'Parallel-Per-Entity' Anchor (Lightweight)
- **Problem**: Earlier, we stripped the heavy `Parallel-Per-Entity Pattern` block under the assumption it was prompt bloat. Without it, when the user asked for `"fleetships, show me top 5 per vessel"`, the LLM noticed `maintenance.query_status` accepted an `organizationShortName` with a `limit` and assumed the backend supported an SQL-like "Group By" execution. It skipped discovery and fired a single org-level call in an attempt to pull grouped items efficiently.
- **Fix**: Injected a lightweight one-line rule under `III. OPERATIONAL DISCIPLINE -> 1. Diversity Allocation`: 
  > *** Entity Distribution**: If the user asks for data across multiple specific entities (e.g., "for Vessel A and Vessel B") or uses a distribution phrase (e.g., "Top 5 per vessel"), you MUST execute **separate parallel tool calls** for EACH target entity. If you do not know the entities (e.g., "per vessel"), call `fleet.query_overview` ONLY in this turn (no other data retrieval tools) to get vessel IDs. In the NEXT turn, use those IDs to make parallel per-vessel data retrieval calls.
- **Result**: Restores the structural awareness that MCP REST endpoints are "flat," forcing the LLM back to executing parallel API calls and honoring the Discovery-First mandate.

### 3. Closing the 'Sequential Flow' Loophole
- **Problem**: In the previous test, the LLM reasoned that because `maintenance.query_status` strictly allowed an `organizationShortName` without a `vesselID`, it didn't *depend* on the `fleet.query_overview` discovery call. Therefore, it decided it was "legal" to call `fleet.query_overview` AND `maintenance.query_status` at the exact same time in Turn 1, completely defeating the purpose of discovering vessels to make parallel calls.
- **Fix**: Extended `II.5 The Sequential Turn Mandate` with a specific `Fleet Discovery Exception (CRITICAL)` rule: when calling `fleet.query_overview` to fulfill a per-entity discovery mandate, the LLM is **FORBIDDEN** from making any data retrieval tool calls in that exact same turn.
- **Result**: Forces the LLM to yield the floor after extracting Fleet IDs, so that on Turn 2, it actually iterates over them in parallel.

### 4. Enforcing 'FEED_BACK_TO_ME' on Discovery
- **Problem**: Even with the prompt fixing the sequence (discover first, fetch later), the LLM was emitting the tools and setting `feedBackVerdict: "SUMMARIZE"` because it didn't intuitively map "fetch later" to the backend LangGraph multi-turn router mechanism. Because it outputted `SUMMARIZE`, the backend immediately killed the thread and sent the output to the UI, effectively preventing the "Next Turn" from ever happening.
- **Fix**: Added `"FEED_BACK_TO_ME" Required` anchor in the constitution. Any time a discovery tool is used to prepare for a "Next Turn", the LLM MUST set the verdict to `FEED_BACK_TO_ME`.
- **Result**: LangGraph now successfully orbits back to the Orchestrator on Turn 2 allowing the LLM to execute the parallel loop.

### 5. Unified Memory Ledger Extraction
- **Problem**: Once `FEED_BACK_TO_ME` was fixed, the orchestrator successfully looped to Turn 2, but it got stuck in an infinite loop redundantly calling `fleet.query_overview` over and over again. Why? Because `UpdateMemory2` only extracted entity IDs from `mcp.resolve_entities`. It was completely ignoring the results from `fleet.query_overview`. Since the raw JSON is hollowed out of the memory block (to save tokens), the LLM essentially saw "I ran the query, it returned 7 items, but I still have NO vessel IDs in memory".
- **Fix**: Upgraded `update_memory2.ts` to automatically populate `sessionContext.resolvedEntities` directly from the payloads of all 4 foundational discovery tools:
  - `mcp.resolve_entities` (Fuzzy Search Base)
  - `fleet.query_overview` (Extracts Vessel IDs and Names)
  - `fleet.query_machinery_status` (Extracts Machinery IDs and Names)
  - `crew.query_members` (Extracts Crew IDs and Designations)
  - `budget.query_overview` (Extracts Budget IDs and Names)
- **Result**: The LLM will now instantly see distinct Canonical Entity IDs sitting directly in its `Resolved Entities` ledger after calling any top-level discovery tool, and can seamlessly orchestrate parallel downstream operations without blindspot loops.

### 6. Strict Two-Step Entity Distribution Mandate
- **Problem**: Even after the Vessel IDs appeared flawlessly in the `Resolved Entities:` ledger in Turn 2, the LLM *still* decided to re-run `fleet.query_overview`. Its reasoning log stated: *"The user requested a per-vessel distribution ('top 5 per vessel')... so I must first use fleet overview to discover the vessel IDs"*. It hit the algorithmic trigger "per vessel" leading strictly to the action "call fleet.query_overview" and completely bypassed the fact that the actual IDs were already sitting in the memory ledger above.
- **Fix**: Rewrote the `Entity Distribution` ruleset in `orchestrator_rules.md` to break the behavior into a rigid **Step 1 (Check Memory)** and **Step 2 (Discover)** loop. The LLM is now explicitly mandated to check the "Resolved Entities" ledger *first*, and only if the subset is missing should it fall back to Step 2 (Discovery).
- **Result**: The LLM will now properly map the phrase "per vessel" to the 5 distinct vessel IDs listed in its prompt and fire off the required parallel `maintenance.query_status` requests.

---

## 🛠️ 55. HITL Context Collapse Remediation

We identified and fixed a critical bug where the `UpdateMemory2` node was discarding the original query topic whenever a HITL (clarifying question) exchange occurred, causing the Orchestrator to enter an infinite `fleet.query_overview` discovery loop.

### Root Cause Analysis

The bug was **entirely deterministic code** — not an LLM failure. Three compounding issues in `update_memory2.ts`:

1. **`rawQuery` was always set to `lastHumanMessage`** — After a HITL exchange, the last human message is the user's *reply* (e.g. `"fleetships, show me top 5 per vessel"`). The original topic (`"Show me all overdue maintenance activities"`) was silently discarded.

2. **`isNewQuery` guard was too broad** — `isNewQuery = (startTurnIndex===0) && !isHITLContinuation`. Once `isHITLContinuation` reset to `false` after iteration 1, subsequent iterations (iter=2, 3...) within the *same* request all evaluated to `isNewQuery=true`, nuking Tier 2 each time with the wrong rawQuery.

3. **Phase 2 LLM context was incomplete** — The HITL reply was invisible to Phase 2. It saw `rawQuery="fleetships, show me top 5 per vessel"` in isolation and correctly (but fatally) generated `pendingIntents: ["Clarify what metric defines 'top'"]` — which the Orchestrator then treated as an unresolved blocking ambiguity.

### 🟢 Three Fixes Applied (`update_memory2.ts`)

**Fix 1 — `rawQuery` Preservation:**
- `rawQuery` is now only sourced from `lastHumanMessage` on a genuinely new request (`isNewQuery=true`)
- On ALL continuation turns (HITL or iterative), `rawQuery` is preserved from `existingMemory.queryContext.rawQuery`
- The HITL reply's scoping refinements ("top 5 per vessel") are captured as `activeFilters` by Phase 2 — not as topic replacement

**Fix 2 — `isNewQuery` Guard Hardening (Revised & Validated):**
- **Amendment 55.2:** Scrapped `startTurnIndex === 0` and `!existingRawQuery` entirely. 
- A genuinely new query is now strictly defined as: `(iter <= 1) && !isHITLContinuation`.
- This ensures Tier 2 Memory correctly wipes and restarts when the user asks a follow-up question later in the same message thread, preventing the agent from being permanently locked into the very first question's context.

**Fix 3 — HITL Q→A Context Injection & Token Metrics Fix:**
- Detects the last AI clarifying question + human reply from `messages[]`
- Injects a `CONTEXT REFINEMENT` block into the Phase 2 user prompt explicitly stating the reply narrows the original query rather than replacing it
- Added `{ includeRaw: true }` to `withStructuredOutput` so the raw AIMessage containing `usage_metadata` is available to the `logTokenSavings` utility.
- Phase 2 now generates `pendingIntents: []` + `activeFilters: {limit: "5", distributionScope: "per_vessel"}` after fleet discovery completes.

### 🟢 Rich Diagnostic Logs Added
- `🔀 Tier 2 Reset Decision` block — logs every condition (`isFirstEverTurn`, `isHITLContinuation`, `existingRawQuery`) with final verdict
- `📊 State snapshot` — logs `startTurnIndex`, `iter`, `isHITL`, `existingRawQuery` on every invocation
- `📦 Tool turns` summary — logs turn counts and latest turn keys
- `📒 Tier 1 Ledger` count — logs how many entities are in the ledger after Phase 1
- `♻️ rawQuery PRESERVED` / `🔄 New query` — makes rawQuery source explicit
- `💬 HITL Q→A pair detected` — logs the exact Q→A when injected into Phase 2
- `🚀 No pending intents` / `⏳ N intent(s) still pending` — makes next expected Orchestrator action explicit

### 🟢 Final Revisions (Amendment 55.3)
1. **Orchestrator Mandate Override Prevented**: 
   - Found that `orchestrator.ts` swapped out the strict `Discovery-First Mandate` block for a generic "proceed with the appropriate tool calls" message when `isHITLContinuation === true`.
   - The prompt was amended to forcefully re-inject the `Discovery-First Mandate` into the HITL continuation block so the LLM cannot bypass `fleet.query_overview`.
2. **Phase 2 Hallucination Removed**: 
   - Found that `update_memory2.ts` was poisoning its own `activeFilters` output because the CRITICAL INSTRUCTION string contained a hardcoded example: `(e.g. "top 5 per vessel")`. 
   - When the user asked `"for all vessels, top 5 only"`, the LLM latched onto our example and hallucinated `distributionScope: "per_vessel"`. All hardcoded filter examples have been removed from the prompt.

### 📑 Key Invariant for Next Agent
**`orchestrator_rules.md` was NOT changed.** The constitution is correct. The bug was purely in the memory node's deterministic code and prompt injections. Do NOT add ambiguity-related rules to the constitution — the fix is structural.

### Files Changed
| File | Change |
|---|---|
| `backend/src/langgraph/nodes/update_memory2.ts` | 3 targeted fixes, token logging, hallucination prompt removed |
| `backend/src/langgraph/nodes/orchestrator.ts` | Discovery-First mandate enforced during HITL continuations |
| `orchestrator_rules.md` | **No changes** |

---

## 🏗️ 56. The "Math Optimization" Loophole & The `currentScope` Architecture

### The Problem: The Intelligent Shortcut
After removing the hallucinations from the Memory Node, we discovered a new Orchestrator behavior: when asked for `"top 5 only, for all vessels"`, the LLM aggressively bypassed our parallelization mandates. 

Instead of mapping 7 discovered vessel IDs to 7 parallel calls of `maintenance.query_status`, it simply made **1 global API call** using `organizationShortName`. 
**Root Cause**: The LLM recognized a mathematical constraint conflict. It calculated that `5 calls * limit: 5 = 25 results`, which violates the human's strict `"top 5 only"` constraint. Because the tool signature allowed `vesselID` to be optional, the LLM optimized the query to a single global call to strictly enforce the math limit.

### Failed Attempts
1. **Prompt Whack-a-Mole**: We temporarily added explicit string checks (e.g. `"for all vessels"`, `"fleet-wide"`) to the `Entity Distribution` rules. This was reverted as it polluted the generalized Constitution and failed to fix the core math disagreement.
2. **Synthetic Goal Extraction**: We attempted to strip the Orchestrator's access to the raw QnA history, feeding it only the computed `activeFilters`. This was reverted because hiding the true human conversation crippled the Orchestrator's context. 
3. **Unified QnA**: We flattened the fragmented message array into a single, clean `CONVERSATION HISTORY` block to fix API fragmentation limits, but the LLM still took the generalized shortcut.

### 🟢 The Implementation: `currentScope` Architecture

Instead of fighting the LLM's mathematical logic or writing overly specific rules, we identified that the Orchestrator must be structurally locked into its entity targets BEFORE it generates tool calls.

- **The Mechanism**: Added a `currentScope: string[]` field to the Orchestrator's structured JSON output schema (placed directly above the `tools` array). The LLM must explicitly evaluate the `Resolved Entities` ledger against the human's request and output the specific IDs it targets (e.g., `["XXX1_ID", "YYY2_ID"]` or `["ALL_7_IDS..."]`) *before* selecting tools.
- **The Mandate (`Principle of Specific Parallelization`)**: If the Orchestrator populates its own `currentScope` array with multiple IDs, it is **strictly forbidden** from generating a generalized, organization-wide query. It MUST generate a 1:1 parallel tool call array for every ID it just listed.

#### Why this handles "Narrow Follow-ups" perfectly:
Because the Orchestrator executes purely on a per-turn basis, `currentScope` is inherently ephemeral. 
- Turn 1: User says *"all vessels"*. `currentScope` = `[7 IDs]`. Result: 7 parallel calls.
- Turn 2: User says *"Now just XXX1"*. `currentScope` = `[1 ID]`. Result: 1 call.

This mirrors human "General → Specific" reasoning and shifts the burden from brittle prompt rules to structural JSON schemas.

---

## 🛠️ 57. Native Failure Filtering & Orchestration Logic Hardening

We bridged the gap between historical maintenance analysis and real-time status tracking by enabling native failure-event filtering and resolving a critical "early termination" bug in the Orchestrator's status journal.

### 🟢 Native Failure Event Filtering:
- **Service Implementation**: Updated `getMaintenanceExecutionHistory` and `getMaintenanceStatus` in [mcp.service.js](file:///home/phantom/testcodes/PhoenixCloudBE/services/mcp.service.js) to support the `isFailureEvent` boolean. The flag is injected directly into the MongoDB aggregation pipeline, ensuring the LLM receives only "true" failure events rather than performing unreliable post-retrieval filtering.
- **Contract Parity**: Synchronized [mcp.capabilities.contract.js](file:///home/phantom/testcodes/PhoenixCloudBE/constants/mcp.capabilities.contract.js) (Backend) and [contract.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/contract.ts) (Orchestrator). The `isFailureEvent` parameter is now a standard, documented part of the MCP capability advertisement.

### 🟢 Orchestration State Machine ("Finalizing" Bug):
- **Problem**: We identified a logic bug where a brand-new query would pre-populate the `SESSION DECISION JOURNAL` with the status `✓ A: Finalizing`. Because the LLM is mandated to *never repeat actions*, it saw "Finalizing" and "Actions: None" and assumed the search was already finished with zero results, leading it to skip tool calls entirely.
- **Fix**: Replaced the optimistic placeholders in [orchestrator.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/nodes/orchestrator.ts) with active-state indicators:
  - `Finalizing` → `Awaiting Execution`
  - `Proceeding` → `Awaiting User Reply`
  - `Actions: None` → `Actions: None yet`
- **Result**: The LLM now correctly recognizes that a new query is "unfilled" and immediately proceeds to tool selection.

### 🟢 Prompt Hygiene (Hallucination Prevention):
- **Scrubbing "fleetships"**: Removed all hardcoded instances of the example organization name "fleetships" from the [contract.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/contract.ts) parameter descriptions.
- **Result**: This prevents a "prompt-injection-by-example" where the LLM would steal the word "fleetships" from its own documentation to bypass the `⚠️ ORG CONTEXT MISSING` guardrail in fresh sessions.

### 📑 Final Session Checklist:
- [x] **Failure Filtering**: Confirmed `isFailureEvent` support across historical and status toolsets via direct DB verification scripts.
- [x] **Contract Sync**: Verified 100% parameter parity between Backend and Orchestrator contracts for the new failure filter.
- [x] **Org Hallucination Fix**: Verified that removing "fleetships" documentation forces the LLM to follow the `⚠️ ORG CONTEXT MISSING` mandatory guardrail.
- [x] **Journal Logic**: Confirmed `Awaiting Execution` status prevents Turn 0 tool skipping, ensuring reliable new searches.
- [x] **currentScope Architecture**: Confirmed the LLM produces a target ID list before executing parallel tool arrays, enforcing the specific parallelization mandate.

---

## 🛠️ 58. Orchestration Softening (Intent-Based Heuristics)
We resolved a critical "Rule-Induced Hesitation" bug where the Orchestrator refused to fetch related data (e.g., Invoices for POs) due to overly aggressive deduplication and anti-loop mandates.

### 🟢 Remediation Strategy:
- **From Mandates to Heuristics**: Replaced rigid "FORBIDDEN" constraints with intent-based heuristics. The system now distinguishes between a redundant loop (useless repetition) and a **proactive investigation** (fetching related entities to complete a human's request).
- **Code-Level Mandate Update (`orchestrator.ts`)**: Rewrote the `SESSION DECISION JOURNAL` suffix. Removed the hard ban on repeating tool+parameter combinations. Injected a new mandate: *"If the user asks a follow-up question requiring new or related data... you MUST proactively execute the relevant new tool calls to continue the investigation."*
- **Constitution Softening (`orchestrator_rules.md`)**:
  - **Rule IV.2 & IV.7**: Softened the "Vessel+Filter Completeness" and "Result Promotion" rules to allow re-querying when the user's follow-up request implies expanded bounds or related entities.
  - **Rule IV.9 (Proactive Investigation)**: Added a dedicated rule mandating that the AI fetch missing details proactively instead of reporting memory limitations to the user.
- **Reasoning**: This transition shifts the model's behavior from a "defensive" posture (fear of loops) to an "offensive" posture (eager fulfillment), mirroring natural human reasoning while maintaining the `currentScope` and `Discovery-First` safety invariants.

### 📑 Final Session Checklist:
- [x] **Journal Softening**: Verified `orchestrator.ts` mandate encourages relational follow-ups.
- [x] **Constitution Alignment**: Confirmed `orchestrator_rules.md` Section IV grants permission for proactive investigation.
- [x] **Conversational Flow**: Validated that follow-on requests (e.g., PO -> Invoices) no longer trigger "memory gap" refusals.
- [x] **Build Integrity**: Confirmed the system remains compilable (`npx tsc --noEmit`) after prompt/logic adjustments.
---

## 🛠️ 59. Production Environment Access (Azure VM)

We have standardized the production environment access and deployment configuration to ensure seamless handovers and diagnostic capabilities.

### 🟢 Connection Details:
- **Environment**: Azure VM
- **IP Address**: `20.169.48.27`
- **User**: `azureuser`
- **SSH Key**: `/home/phantom/Downloads/seikaizen_key.pem`
- **Root Path**: `/home/azureuser/maximapmx/skylark`
- **Nginx Subpath**: `/phoenixai/` (Proxied to `localhost:4000`)

---

## 🛠️ 60. Relational Reasoning & Knowledge Graph (v2.3)
We evolved the agent's internal "Mental Model" from a reactive state to a proactive, **Relational Reasoner**. This phase decoupled behavioral reasoning from data facts, creating a sturdy, human-like deduction engine.

### 🟢 Knowledge Graph Refactor (Hyper-Rich v2.3):
- **Formal Semantic Definitions**: Updated [phoenix_knowledge_graph.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/knowledge/phoenix_knowledge_graph.ts) with explicit definitions for:
  - **DOMAIN_HIERARCHIES**: Vertical Ownership/Containment (The "Parent-Child" Stack).
  - **ENTITY_RELATIONSHIPS**: Horizontal Bridges/Associations (The "Cross-Domain" Connectors).
  - **REASONING_INFERENCE_MAP**: Semantic Proximity (The "Colloquial Compass").
- **Hyper-Rich Vertical Hierarchies**: Mapped 7 deep domains (Maintenance, Procurement, Finance, Inventory, Safety, Crew, Documents) to 5-7 levels each, based on a full audit of 80+ backend models.
- **Cross-Domain "Bridges"**: Implemented 14+ horizontal connectors (e.g., `Activity` ↔ `BudgetAllocation`, `CrewMember` ↔ `DocumentMetadata`) to enable autonomous multi-hop reasoning (e.g., tracing a technical failure to a financial invoice).

### 🟢 Orchestrator Hardening (Relational Deduction Protocol II.B):
- **The Decoupling Mandate**: Moved operational strategy out of the Knowledge Graph and into the [orchestrator_rules.ts](file:///home/phantom/testcodes/SkylarkAI/backend/src/langgraph/prompts/orchestrator_rules.ts).
- **Five-Tier Deduction Framework**:
  - **Rule 1: Structural Inference**: AI must infer "Parent" type (e.g., Vessel) if the user requests a "Child" entity (e.g., Schedule).
  - **Rule 2: Functional Constraint**: Unclassified labels inherit the type required by the tool's parameter signature (The "Logic Gate").
  - **Rule 3: Contextual Anchoring**: Strictly protects Global Organization context from being substituted for sub-entities.
  - **Rule 4: Mandatory Hard-Stop (HITL)**: If Rules 1-3 fail to resolve a label with high confidence (>0.7), the agent is **strictly forbidden from guessing**. It MUST pause and trigger a **Human-In-The-Loop (HITL)** turn via `clarifyingQuestion`.
  - **Rule 5: Relational Persistence**: Insulates unclassified labels from being "lost" across turns when the user provides context (e.g., providing an Org name shouldn't flush the search for 'XXX1').

### 📑 Final Session Checklist:
- [x] **Hierarchy Depth**: Verified 7 domains are mapped to 5+ levels of depth.
- [x] **Bridge Logic**: Confirmed the AI can navigate from a technical `Activity` to a financial `Invoice` via the `BudgetAllocation` bridge.
- [x] **Prompt Hygiene**: Verified that all specific-case examples (e.g., "fleetships", "XXX1") have been removed from the core architecture, ensuring a general, scaleable mental model.
- [x] **Ambiguity Recovery**: Verified Rule 4 (Hard-Stop) correctly triggers a clarification request for opaque labels rather than hallucinating matches.
- [x] **Build Integrity**: Confirmed the system is fully compilable (`npx tsc --noEmit`) after the v2.3 refactor.

### 🟢 Diagnostic Commands:
- **SSH Access**:
  ```bash
  ssh -i /home/phantom/Downloads/seikaizen_key.pem azureuser@20.169.48.27
  ```
- **Logging (PM2)**:
  ```bash
  pm2 logs skylark-backend
  ```
- **Log Rotation**: The environment is equipped with `pm2-logrotate`. Logs are rotated at **10MB** intervals to prevent disk saturation.
  ```bash
  pm2 conf pm2-logrotate
  ```

### 🟢 Nginx Routing:
The application is mounted under `/phoenixai/` on the primary reverse proxy. Ensure `VITE_API_BASE_URL` in the frontend and `API_BASE_URL` in the backend are aligned with this subpath.

---

## 🛠️ 61. Tier 5 Memory Unification (currentScope)
We unified the transient investigation memory from `accumulatedScope` to **`currentScope`** across the entire system. This aligns the underlying state with the prompt terminology and the established 5-tier memory nomenclature.

### 🟢 Unification Check:
- **`state.ts`**: The field in `SkylarkState['workingMemory']['queryContext']` is now `currentScope`.
- **`orchestrator.ts`**: Both the prompt injection label and the internal turn-to-turn accumulation logic use `currentScope`.
- **Terminology**:
    - **`currentScope`**: Transient scratchpad for the current question (Turn-to-Turn). Reset on every brand new user query.
    - **`secondaryScope`**: Persistent ledger of entities from previous questions (Question-to-Question). Pruned after 7 conversations.

### ⚠️ Mandate:
Future agents must NOT revert this to `accumulatedScope`. The term is dead. All functional logic must treat `currentScope` as the single source of truth for "discovered entities within the current investigative loop."

---

## 🛠️ 62. Orchestrator Diet (Latest-Turn Results Only)
To optimize for token efficiency and eliminate context noise, we hardened the Orchestrator's dependency on the Tier 5 Scratchpad (`currentScope`). 

### 🟢 Strategic Change:
- **`orchestrator.ts`**: The prompt now only receives the **Latest Turn's** tool results (`currentTurns.slice(-1)`) instead of the entire investigative history.
- **Rationale**: 
    - **Token Efficiency**: Massive reduction in prompt size for deep 3+ turn investigations.
    - **Stateful Independence**: Forces the AI to rely on its **`currentScope`** (The Notebook) for entity IDs and its **Journal** for process history.
    - **Summarizer Integrity**: The `Summarizer` node is **NOT** affected. It still receives the full result set from every turn to ensure final report accuracy.

### ⚠️ Mandate:
---

## 🛠️ 63. Maintenance Status Filtering (Cancelled vs All)
We resolved a long-standing tool contract mismatch where the AI was unable to filter for "Cancelled" jobs in historical data.

### 🟢 Implementation Fixes:
- **Service Layer**: Updated `getMaintenanceExecutionHistory` in [mcp.service.js](file:///home/phantom/testcodes/PhoenixCloudBE/services/mcp.service.js) to natively support `statusCode`. It now maps strings like "cancelled" to the `latestEventStatus` field in the MongoDB aggregation pipeline.
- **Contract Parity**: Synchronized [contract.ts (SkylarkAI)](file:///home/phantom/testcodes/SkylarkAI/backend/src/mcp/capabilities/contract.ts) and [mcp.capabilities.contract.js (Backend)](file:///home/phantom/testcodes/PhoenixCloudBE/constants/mcp.capabilities.contract.js) to include `statusCode` in the `optionalQuery` for `maintenance.query_execution_history`.
- **Status Guidance**: Added `interpretationGuidance` to both maintenance tools to explicitly list `completed, cancelled, rescheduled, created` as valid values, preventing the LLM from falling back to "completed" by default.

---

## 🛠️ 64. The "XXX1" Lesson (Classify -> Resolve -> Retrieve)
We identified a critical reasoning breakdown where the Orchestrator attempted to "shortcut" the discovery process to save a turn, leading to an investigation failure for the label **"XXX1"**.

### 🔴 The Breakdown:
- **Parameter Hijacking**: Because the Orchestrator didn't have a VesselID for "XXX1", it "hijacked" the `activityDescription` text field in the retrieval tool and placed "XXX1" there. 
- **The Result**: The tool searched for a *Maintenance Job* named "XXX1" (which doesn't exist) and returned 0 results, while correctly ignoring the actual *Vessel* named "XXX1".

### 🟢 The Mandatory Agentic Pattern:
Future agents MUST enforce the **Classify -> Resolve -> Retrieve** loop for all unclassified labels (e.g., "XXX1", "Main Engine", "CC-01"):
1.  **Classify**: The LLM must infer the most likely Entity Type (e.g., "I think XXX1 is a Vessel").
2.  **Resolve**: The LLM MUST call `mcp.resolve_entities` with that type and label. Chaining a retrieval call in the SAME turn using that label as a placeholder is **STRICTLY FORBIDDEN**.
3.  **Retrieve**: Only after the Resolution Turn returns a 24-char Hex ID (e.g., `67eed...`) should the retrieval tool be called.

> [!WARNING]
> **No Shortcuts**: The Orchestrator is forbidden from using raw alphanumeric labels in text-search parameters (`searchTerm`, `activityDescription`) as a substitute for Missing IDs. A resolution failure MUST trigger **Rule II.B.4 (The Hard-Stop/Ambiguity Protocol)** rather than a "best-effort" mapping guess.

---

## 🛠️ 65. Identity-First & Ambiguity Bridge Architecture
We have hardened the SkylarkAI orchestrator by implementing a deterministic **"Identity-First"** protocol. This architecture eliminates LLM parameter hijacking and ensures all entity labels (e.g., "XXX1") are canonicalized to 24-char hex IDs before retrieval begins.

### 🟢 The Strategic Intercept (`orchestrator.ts`)
- **Deterministic Vestibule**: Implemented a "Pre-Execution Interceptor" in the Orchestrator node. If the LLM identifies `unclassifiedLabels`, the system **physically wipes** the suggested retrieval tools (e.g., history query) and injects parallel `mcp.resolve_entities` calls.
- **Turn Divergence**: This forces the graph into a mandatory "Identity Turn" before any data is fetched, preventing data-leaks and searching-by-label hallucinations.
- **Context Thievery**: Added logic to "steal" organization context (`organizationID`/`organizationShortName`) from the AI's *current turn tool arguments* if it hasn't yet reached the persistent session memory. This ensures the first turn of a new organization context correctly scopes the resolution pass.

### 🟢 Discovery Harvesting (`update_memory2.ts`)
- **Deterministic Promotion**: Upgraded Phase 1 of the memory node to scan all `mcp.resolve_entities` results. It now automatically promotes discovered IDs (e.g., `vesselID`, `machineryID`, `activityID`) directly into the `sessionContext.scope` ledger if a unique match is found.
- **Ambiguity Detection (The Collision Bridge)**: If a single label (e.g., "CCC") returns matches for multiple different entity types (e.g., both a Vessel and an Activity), the node flags an **`ambiguousMatches`** collision in memory instead of guessing a winner.

### 🟢 Relational Deduction Constitution (`orchestrator_rules.ts`)
- **The Pointer Pattern**: Consolidated all resolution logic into a single source of truth (**Section II.B**). The high-level "Fidelity Bridge" now acts as a pointer to the deep deduction protocol, eliminating instructional divergence.
- **No-Hex-ID Policy (Rule 4)**: The AI is **strictly forbidden** from asking users for "24-character hex IDs." It MUST ask for human-friendly "Type Clarification" (e.g., *"Is 'XXX1' a Vessel or a piece of Machinery?"*).
- **Ambiguity Logic (Rule 7)**: Mandates a hard-stop when `⚠️ AMBIGUITY DETECTED ⚠️` appears in the prompt context.
- **Resolution Consolidation (Rule 8)**: Once a user clarifies an ambiguity, the AI is mandated to fire exactly **ONE** targeted confirmation turn to lock in the ID before proceeding.

### 📑 Identity-First Verification:
- [x] **Strategic Intercept**: Verified that `unclassifiedLabels` correctly trigger a diversion to resolution tools.
- [x] **Context Thievery**: Confirmed Turn 1 org extraction works before memory persistence.
- [x] **Multi-Harvesting**: Validated that `update_memory2` promotes only unique IDs and flags collisions.
- [x] **Human Protocol**: Confirmed the LLM asks for "type" instead of "ID" during ambiguities.
- [x] **Consolidation**: Verified Rule 8 correctly triggers a follow-up resolution after user clarification.

---

## 🛠️ 66. Identity Resolution Persistence & currentScope Hardening

We resolved a critical "Resolution Loop" and "Parameter Hallucination" bug where the AI would forget its discovered IDs or populate tools with result keys (e.g., `mcp.resolve_entities_iter1_2`).

### 🟢 Deduplicated Harvesting (`update_memory2.ts`)
- **Unique-ID Deduplication**: Updated Phase 1 of the memory node to filter identity matches by their unique document ID. This prevents the system from flagging a collision if the same vessel is returned multiple times across different turns of the same request.
- **`resolvedLabels` Ledger**: Implemented a persistent mapping ledger in `sessionContext.scope.resolvedLabels`. Once an entity (e.g., "XXX1") is resolved, its ID and Label are stored indefinitely for the conversation.

### 🟢 Orchestrator Context Injection (`orchestrator.ts`)
- **Grounded Mapping Injection**: The Orchestrator now injects a dedicated `🆔 RESOLVED ENTITIES` block into the system prompt. This provides the LLM with immediate, grounded evidence that "XXX1" is already verified to a specific ID, even after the discovery tool results are purged from history.
- **currentScope Hex-ID Enforcement**: Hardened the Zod schema and prompt for `currentScope`. It now explicitly forbids tool result keys and mandates that only 24-character hex IDs be output.
- **Interceptor Optimization**: The "Strategic Interceptor" now cross-references the `resolvedLabels` ledger and will NOT diver turns for labels that are already verified, ensuring the graph proceeds directly to retrieval.

### 📑 Final Session Checklist:
- [x] **Deduplication**: Confirmed that identical matches across turns no longer trigger an ambiguity loop.
- [x] **Mapping Persistence**: Verified that `resolvedLabels` keeps names linked to IDs throughout 3+ turns.
- [x] **Schema Guard**: Validated that `currentScope` contains hex IDs and never tool-keys.
- [x] **Intercept Filtering**: Confirmed that previously resolved labels do not trigger a resolution intercept.
- [x] **Build Integrity**: Verified the system is fully compilable (`npx tsc --noEmit`) with the new state fields.

---

## 🛠️ 67. Request-Local Resolution Loop Breaker

We identified and resolved a critical "Agentic Loop" bug where the Orchestrator would enter an infinite cycle of trying to resolve irresolvable labels (typos like "XCCCCC").

### 🟢 Deterministic Loop Prevention (`orchestrator.ts`)

- **Negative Resolution Caching**: The `Strategic Interceptor` now performs a deterministic check BEFORE triggering a resolution turn. 
- **Internal Turn Scanning**: It scans all `toolResults` for the **current user request** (using `state.startTurnIndex`). 
- **Bypass Mandate**: If a label was already searched via `mcp.resolve_entities` in a previous iteration of the *same turn* and returned "No matches found," the Interceptor now **skips** that label.
- **Graceful Best-Effort**: If the filtered list of labels to resolve is empty, the Interceptor stands down. This allows the graph to proceed with the retrieval of other valid entities in the query (e.g., fetching jobs for a valid vessel even if a second vessel name was a typo).

### 🟢 Lifecycle of the "Failure Cache"
- **Ephemeral**: The failure state is **strictly local** to the current internal request loop.
- **Auto-Reset**: As soon as the user sends a new message, the `startTurnIndex` moves forward, clearing the "failure cache" and ensuring the AI will attempt the resolution again if asked.

### 📑 Loop Breaker Verification:
- [x] **Internal Loop Termination**: Confirmed that the system stops retrying "XCCCCC" after the first failure.
- [x] **Selective Retrieval**: Verified that valid data for "MV Phoenix Demo" is still retrieved even when "XCCCCC" fails.
- [x] **New-Turn Reset**: Confirmed that the AI will re-try the resolution if the user asks for it in a fresh prompt.

---

## 🛠️ 68. Null-Safe Organization Validation (Unknown-String Elimination)

We identified and eliminated a logical flaw where the Orchestrator would "thieve" hallucinated placeholder strings (like `"UNKNOWN"`, `"N/A"`, or `"NULL"`) from LLM tool arguments and treat them as valid organization context.

### 🟢 Protocol Hardening:
- **Null-Safe Thievery (`orchestrator.ts`)**: Updated the "Deep Context Thievery" logic to strictly ignore common placeholder strings. The orchestrator now treats these as `null` or `undefined`, correctly triggering the mandatory \`⚠️ ORG CONTEXT MISSING\` guardrail.
- **Logical Simplification**: Removed the brittle string comparisons against \`"UNKNOWN"\`. Validation now relies on robust falsy/null checks (\`!orgValue\`).
- **Strategic Interceptor Hard-Gate**: The interceptor for entity resolution is now strictly gated by \`!shouldShowOrgWarning\`. If the organization context is missing (i.e., \`null\` in session scope and not found in messages), the system is **strictly forbidden** from attempting parallel resolution, prioritizing the clarifying question instead.
- **Memory Extraction Parity (\`update_memory2.ts\`)**: Standardized Phase 1 extraction to discard placeholder strings before they reach the persistent conversational ledger.
- **Constitution Prohibition (\`orchestrator_rules.ts\`)**: Added a strict rule to the **OPERATIONAL DISCIPLINE** section forbidding the use of placeholder strings for any tool parameters, ensuring the LLM understands that an absent value must remain absent, not be filled with "UNKNOWN".

### 📑 Final Session Checklist:
- [x] **Placeholder Elimination**: Verified that \`"UNKNOWN"\` is no longer accepted as a valid organization short name.
- [x] **Null Validation**: Confirmed that the orchestrator uses strict falsy checks for organization presence.
- [x] **Clarification Priority**: Validated that the system asks for the organization short name before attempting any discovery or retrieval tools.
- [x] **Build Integrity**: Confirmed the system remains fully compilable (\`npx tsc --noEmit\`) after the logic refinement.

---

## 🛠️ 69. Graph Routing & Proactive Retrieval Hardening

We resolved a critical "Reasoning Stall" and "Routing Trap" where the orchestrator would enter an infinite loop of "thinking" without acting, ultimately being terminated by an aggressive graph safety sink.

### 🟢 Graph Routing Restoration (`graph.ts`):
- **The Routing Trap Fix**: Previously, the graph router at `graph.ts` forced any turn with zero tools directly to the `Summarizer`. If the AI decided to "plan" (empty tools) and set its verdict to `FEED_BACK_TO_ME`, the router overruled the AI and killed the turn.
- **Verdict Precedence**: Updated the conditional edge from the Orchestrator. The system now strictly honors a `FEED_BACK_TO_ME` verdict, ensuring it orbits back to the "Brain" for follow-up turns even if no tools were called in the current turn.

### 🟢 Non-Procrastination Mandate (`orchestrator_rules.ts`):
- **Proactive Execution**: Added a new **Step 2 (Non-Procrastination Mandate)** to Section VIII. 
- **Mandatory Action**: If target entity IDs are already present in the session ledger (`secondaryScope` or `Organic Discoveries`), the Orchestrator is **strictly forbidden** from returning a zero-tool "planning turn." It MUST generate and execute the parallel retrieval tool calls immediately.
- **Result**: This prevents the AI from being "too cautious," forcing it to leverage available data instantly rather than wasting turns on verbalizing a plan.

### 📑 Sequential Logic Checklist:
- [x] **Router Loop-back**: Verified that `FEED_BACK_TO_ME` successfully bypasses the "Zero Tool" sink and returns to the orchestrator.
- [x] **Proactive Retrieval**: Confirmed that the AI fires parallel retrieval tools immediately once vessel/machinery IDs are discovered.
- [x] **Investigative Continuity**: Validated that multi-turn chaining (e.g., Fleet Overview -> Per Vessel Statistics) works without manual intervention or stalling.
- [x] **Build Integrity**: Confirmed the system is fully compilable (`npx tsc --noEmit`) after the routing and prompt updates.

---

## 🛠️ 70. Architectural Alignment: Turns vs. Conversations

This section formalizes the memory-anchoring strategy to prevent "Topic Lockdown" regressions.

### 📐 Definitions (User-Agent Shared Protocol)
*   **Conversation (Summary-to-Summary)**: Represented by the User's NEW incoming query until the Agent returns a final `[INSIGHT]` Summary. A Conversation is a complete mission (e.g., "Find all completed jobs").
*   **Turn (Internal Iteration)**: Any intermediate step (`AI <-> AI` or `AI <-> HITL`) *inside* a single Conversation. Turns share the same topic anchor (`rawQuery`).

### ⚓ Dynamic Topic Anchoring (UpdateMemory2)
To break the "Topic Lock," the `UpdateMemory2` node now uses a **Force-Refresh** protocol:
*   **Conversation Start (`isNewQuery`)**: The system MUST ignore any existing thread topic and refresh purely from the latest User Query. This allows the user to pivot from "Cancelled" to "Completed" without the agent staying stuck on the previous task. 
*   **Turn Continuation**: The topic stays anchored to ensure multi-step retrieval (Discover -> Resolve -> Retrieve) remains focused on the original mission.

### 🧩 Filter Poisoning & RULE 69
*   **Anti-Poisoning**: The Memory Controller prompt now prioritizes **Latest Tool Arguments** as the ground truth. If a tool successfully fetches "Completed" data, the memory will reflect "Completed" regardless of historical intent.
*   **Investigative Continuity (RULE 69)**: The Orchestrator is now strictly forbidden from downgrading to "lite" status tools once a deep "Work History" (Audit) investigation is underway. This preserves data richness across status pivots.


---

## 🛠️ 71. Deterministic Topic Anchoring & Re-Retrieval Mandate

We addressed a regression where the agent incorrectly pivoted the investigation topic to HITL answers (e.g., "fleetships") instead of the new mission query ("show me vessel wise"). We also resolved a data-loss issue where the Summarizer would lack the raw data needed for re-grouping insights across conversation boundaries.

### 🟢 Boundary-Aware Anchoring ( & ):
- **Structural Boundary Detection**: The system no longer "guesses" based on iteration counts alone. It now identifies the **Boundary** as the last `[INSIGHT]` Summary emitted by the AI.
- **Top-Level Mission ID**: The `rawQuery` (Topic) is now anchored to the **first Human message following the last Summary**. This ensures that the original starting question of the new mission is preserved, reliably skipping any "tail" HITL messages from the previous conversation.
- **Result**: Perfect topic stability during the "vessel-wise" pivot.

### 🟢 Re-Retrieval Mandate (RULE 71):
- **Summarizer Context Restoration**: Identified that the Summarizer is isolated by `startTurnIndex` and cannot "see" raw tool results from previous conversations.
- **Mandatory Re-Execution**: Added **RULE 71** to the Constitution. If a user asks for a re-grouping or further analysis of historical data, the Orchestrator MUST re-execute the relevant retrieval tools. This guarantees that the current turn's toolResults payload contains the raw rows necessary for the Summarizer to build its synthesis.

### 📑 Stability Checklist:
- [x] **Topic Pivot Accuracy**: Verified that "fleetships" (HITL) no longer steals the mission anchor from "show me vessel wise".
- [x] **Raw Data Availability**: Confirmed that the Orchestrator re-runs retrieval when a new view is requested.
- [x] **Summarizer Synthesis**: Validated that the Summarizer successfully produces vessel-wise insights when tool results are populated in the current turn.


---

## 🛠️ 72. Visibility Ledger vs. Data Diet (Context Hardening)

We refined the **"Orchestrator Diet"** (Section 62) to resolve a critical visibility gap that occurred during cross-conversation re-summarization.

### 🔴 The Regression:
The previous "Diet" was too aggressive, hiding ALL historical tool results from the Orchestrator's prompt. When a user requested a re-grouping (e.g., "vessel wise"), the AI correctly pivoted to the new topic but **hallucinated key names** (e.g., `previous_cancelled_jobs_overview`) because it couldn't see the technical technical IDs/results from the previous conversation.

### 🟢 The Deterministic Fix (`orchestrator.ts`):
- **Full Ledger Visibility**: The Orchestrator now receives a **Full Technical Ledger** (Headers and Keys only) for every tool result in the thread history. This ensures the AI always has the correct technical key (e.g., `_iter1`) for selection.
- **ID-Sniffing Weight-Limit**: Heavy Data Previews (ID harvesting and row counts) remain restricted to the **latest turn results** only. 
- **Result**: Massive token efficiency is preserved, but the AI is no longer "blind" to the existence of data it already retrieved.

### 🟢 Topic Boundary Sync (`orchestrator.ts` & `update_memory2.ts`):
- **Boundary Detection**: Unified the topic-anchoring logic to look for the last `[INSIGHT]` (Summary) and treat the **first Human message after that boundary** as the new Mission Topic. This deterministically breaks the "Topic Lockdown" without fragile If/Else logic.


---

## 🛠️ 73. Post-Implementation Gap Fixes (Ledger Hardening)

Following a thorough audit against all three handover documents, we identified and fixed **4 gaps** introduced during the Section 72 implementation.

### �� GAP-1 FIX: Off-By-One in `scanStartIdx` (`update_memory2.ts`)
- **Root Cause**: The `lastSummaryIdx` is derived from a **reversed** array's `.findIndex()`. Converting it back to a forward index requires `length - 1 - reversedIdx`. The implementation was using `length - reversedIdx` (missing the `-1`), shifting the scan window one message too far. When the Summary was the last message, `.slice()` returned an empty array → `missionTopic = ""` → `rawQuery` collapsed to empty string → the AI lost its topic anchor entirely.
- **Fix**: Changed formula in `update_memory2.ts` to `(allMessages.length - 1 - lastSummaryIdx)`.
- **Formula Rule for Future Agents**: reversed `.findIndex()` result → forward index = `array.length - 1 - reversedIdx`. Never `length - reversedIdx`.

### 🔴 GAP-2 FIX: Decision Journal Was Showing Full History (`orchestrator.ts`)
- **Root Cause**: The journal's tool-matching loop was changed to iterate `ledgerTurns` (the last 5 turns of all history) instead of `requestCycleTurns` (tools from THIS request only). This violated the journal's own mandate ("Current Query Only") and caused the AI to see tools from **previous conversations** as "already done," refusing to re-run them even on explicit user request.
- **Fix**: Changed the journal's tool-matching loop back to use `requestCycleTurns` (= `history.slice(state.startTurnIndex)`).
- **Mandate**: The journal MUST always be scoped to `requestCycleTurns`. Only the `ledgerTurns` section (headers/keys) may reference broader history.

### 🟡 GAP-3 FIX: Boundary Detection Was Running Outside `isNewQuery` (`update_memory2.ts`)
- **Root Cause**: The full boundary scan (`lastSummaryIdx` → `missionStartMsg`) was running unconditionally on every memory update, including HITL continuations. This caused two problems: (a) wasteful computation, (b) during a HITL continuation, the HITL reply itself (e.g., "fleetships") could become the new "first human msg after boundary," overwriting the genuine mission topic.
- **Fix**: Moved the entire boundary scan block **inside** the `if (isNewQuery)` branch. During HITL continuations (`isNewQuery = false`), the code now falls straight to `existingRawQuery` preservation without re-scanning.

### 🟡 GAP-4 FIX: `ledgerTurns` Was Unbounded (`orchestrator.ts`)
- **Root Cause**: After the Section 72 fix, `ledgerTurns` was set to the full `history` array with no cap. In a 30-turn session (≤30 per the BSON guard) with 5 tools per turn, this injects 150 header lines into every orchestrator call, partially defeating the Section 62 Diet.
- **Fix**: Capped `ledgerTurns` to `history.slice(-5)` — the last 5 turns. This covers any realistic active investigation window. For older data, the AI relies on `currentScope` (Notebook) and `secondaryScope` (7-conv rolling ledger) which already carry the entity IDs.
- **Token Budget**: 5 turns × 5 tools = 25 header lines maximum per orchestrator call. Bounded and predictable.

### �� Final Variable Responsibilities (for Future Agents):
| Variable | Source | Purpose |
|---|---|---|
| `history` | `state.toolResults` (all) | Raw source — never inject directly |
| `ledgerTurns` | `history.slice(-5)` | Headers/keys for re-grouping visibility |
| `requestCycleTurns` | `history.slice(startTurnIndex)` | Journal + Loop Breaker (current request only) |


---

## 🛠️ 74. Infinite Resolution Loop Fix — Routing Order Bug (`graph.ts`)

### 🔴 The Bug (GAP-LOOP-1):
A critical infinite loop was observed when the user asked for a re-grouping of already-retrieved data (e.g., "show me these per vessel"). The system would loop indefinitely without ever running tools or producing a response.

**Root Cause**: Two mechanisms interacted in a destructive way:
1. The **Strategic Interceptor** (`orchestrator.ts`): When the AI listed vessel labels as `unclassifiedLabels`, the interceptor correctly injected `mcp.resolve_entities` tool calls AND set `feedBackVerdict = FEED_BACK_TO_ME`.
2. The **Orchestrator Conditional Edge** (`graph.ts`): The routing check for `feedBackVerdict === "FEED_BACK_TO_ME"` came **BEFORE** the check for `toolCalls.length > 0`.

**Effect**: The graph saw the `FEED_BACK_TO_ME` verdict first and short-circuited directly to `update_memory`, **silently dropping the injected resolve_entities tools**. On the next turn, the AI saw the same unresolved labels, the interceptor fired again, tools were dropped again → infinite loop. Confirmed by logs: `latestTurn keys: [none]` on every iteration.

### 🟢 The Fix (`graph.ts`):
Swapped the routing check order. `toolCalls` is now checked **first**:
```
• tools present (any verdict)  → execute_tools → update_memory / summarizer
• no tools + FEED_BACK_TO_ME  → update_memory  (planning-only turn, loop back)  
• no tools + SUMMARIZE        → summarizer     (empty / conversational end)
```

**Key Principle for Future Agents**: The verdict governs what happens **AFTER** tools run. It must never be used to skip tool execution. If `toolCalls` is non-empty, `execute_tools` MUST always be the next node, regardless of the verdict.


---

## 🛠️ 75. Summarizer Conductor History Lookup (`summarizer.ts`)

### 🔴 The Bug (GAP-HIST-1):
User asked "show me per vessel" after the AI had already retrieved 29 cancelled jobs. The AI (correctly) set `selectedResultKeys = ["maintenance.query_execution_history_iter1"]` and issued `SUMMARIZE`. But the Summarizer saw **0 items** and said "no data available."

**Root Cause**: The Summarizer's `currentTurns = history.slice(startTurnIndex)` only covers the **current HTTP request's** tool turns. The original 29-item result was in turn 0 (from the previous conversation turn), before `startTurnIndex=1`. When `selectedResultKeys` named that key, the filter against `currentTurns` found nothing, triggering the fallback to `unpackedEntries` (also empty) → 0 rows → empty summary.

**Secondary cause**: On an earlier attempt, the AI had tried to re-fetch per-vessel with `vesselID: "XXX1"` (a display name, not a Mongo ObjectId), which correctly failed. The Conductor then selected the *failed* key (which had 0 items) causing the same result.

### 🟢 The Fix (`summarizer.ts`):
Extended the Conductor Selection fallback block with a **Conductor History Lookup**:
1. When `finalEntries` is empty after filtering `currentTurns`, walk **all history** (not just `currentTurns`) 
2. Find any entry that: (a) matches a `selectedResultKey`, (b) is not an error, (c) has `items.length > 0`
3. Use those historical entries for the summary — this is the "re-group prior data" use case
4. Only if nothing matches in all history do we fall back to `unpackedEntries` (true hallucination case)

**Key Principle**: The Conductor explicitly named the key — that name is authoritative. The Summarizer must honour it even if the key is from a prior turn before `startTurnIndex`. The `startTurnIndex` isolation prevents stale data from contaminating NEW queries, but must not block the Conductor from accessing prior results for re-grouping.


---

## 🛠️ 76. Vessel ObjectId Dropped from Execution History Response (`mcp.service.js`)

### 🔴 The Bug (GAP-VESSEL-ID):
Per-vessel follow-up queries (e.g., "show me these per vessel") failed with `vesselID must be a valid Mongo ObjectId`. The root cause was traced through a 4-step chain:

1. `maintenance.query_execution_history` returns items with `vessel: { vesselName: "XXX1" }` — **no `vessel._id`**.
2. The MongoDB aggregation pipeline uses `buildStringRefLookupStages` with `project: { _id: 1, vesselName: 1 }` — so the lookup correctly fetches both fields.
3. BUT the final `$project` stage (line ~2155 in `mcp.service.js`) explicitly projects **only** `"vessel.vesselName": 1`, silently dropping `vessel._id`.
4. The Summarizer LLM receives items with no vessel ObjectId, falls back to using the vessel name `"XXX1"` as the `id` in its `[ENTITIES]` block, and `secondaryScope` stores `{ name: "XXX1", id: "XXX1" }` instead of the real Mongo ObjectId.
5. Next turn, the AI reads `id: "XXX1"` from secondaryScope and passes it as `vesselID: "XXX1"` to the tool → **backend rejects it** since `"XXX1"` is not a 24-char hex ObjectId.

### 🟢 The Fix (`mcp.service.js`):
Added `"vessel._id": 1` to the final `$project` stage in `getMaintenanceExecutionHistory`. The response now includes `vessel: { _id: "68...", vesselName: "XXX1" }`. The Summarizer can correctly emit `{ "modelType": "Vessel", "name": "XXX1", "id": "68..." }` into `[ENTITIES]`, which correctly propagates into `secondaryScope` with a real ObjectId.

**Key Principle**: Always project `_id` alongside display fields in lookup stages AND in the final `$project`. Dropping `_id` from response items causes the AI to use display names as identifiers, creating a cascade of tool failures downstream.


---

## 🛠️ 74. UI Tab Bleed Fix & Completed Jobs Timeout

### Problem 1: Old Result Tabs Showing in UI
**Root Cause**: `emitToolResults()` in `workflow.ts` used `selectedResultKeys` (set by the Orchestrator) to filter results across ALL historical turns. When the user asked a new question (e.g. "completed jobs"), the Orchestrator also selected old result keys from prior turns (e.g. cancelled jobs) for the Summarizer's context. The `emitToolResults` D1 call was then promoting those old keys to the UI, causing stale tabs to appear.

**Fix**: Added `currentTurnOnly: boolean = false` parameter to `emitToolResults`:
- **D1 (execute_tools)**: Calls `emitToolResults("execute_tools", true)` → emits only `allTurns.slice(startTurnIndex)` (keys from THIS request only, no historical bleed)
- **D2 (summarizer)**: Calls `emitToolResults("summarizer")` (unchanged) → uses `selectedResultKeys` conductor logic for final consolidated view, which is correct (D2 fires when no new tools are run and historical re-surfacing IS intended)

**File**: `backend/src/langgraph/routes/workflow.ts` — `emitToolResults` function signature + D1 call site

---

### Problem 2: Timeout on "completed" Jobs Query
**Root Cause**: `statusCode: "completed"` in `getMaintenanceExecutionHistory` was setting `effectiveBaseMatch.committed = true`. This is a boolean field with no compound index alongside `organizationID` or `latestEventDate`, causing a full collection scan on fleet-wide queries with large datasets. Result: 25s timeout.

**Fix 1** (`mcp.service.js`): Changed the `completed` branch to:
```js
effectiveBaseMatch.latestEventStatus = { $in: ["completed"] };
```
`latestEventStatus` is a denormalized field that is now covered by the new compound indexes and hits the index directly.

**Fix 2** (`models/activity.work.history.model.js`): Added two compound indexes:
```js
// Fleet-wide status queries (no vessel filter)
{ organizationID: 1, latestEventStatus: 1, latestEventDate: -1 }  → "ix_awh_org_status_date"

// Per-vessel status queries
{ organizationID: 1, vesselID: 1, latestEventStatus: 1, latestEventDate: -1 } → "ix_awh_org_vessel_status_date"
```
These indexes cover ALL status-based execution history queries (`completed`, `cancelled`, `missed`, etc.) for both fleet-wide and per-vessel scopes. Indexes are created automatically by Mongoose on server restart (background build, no downtime).

> ⚠️ Note: The `cancelled` status was already working because cancelled jobs are sparse in the dataset. The `completed` query timed out because `committed: true` is set on a much larger superset of records. The new `latestEventStatus` filter is tighter and index-backed.


---

## 🛠️ 75. D2 Tab Bleed Fix (Vessel-wise Breakdown) & Log De-bloat

### Problem: Old Result Tabs Surfaced via D2 (Summarizer Path)
When the user asked "show me a vessel wise break up" after the cancelled jobs overview, the orchestrator ran ONE fleet-wide tool in iter 1, then went SUMMARIZE/tools=[] in iter 2. Since no tools ran in iter 2, execute_tools was skipped → D1 never fired → D2 (summarizer) fired.

D2 called `emitToolResults("summarizer")` which used `selectedResultKeys: ["maintenance.query_status_iter1", "maintenance.query_execution_history_iter1"]`. It searched ALL historical turns, found `maintenance.query_execution_history_iter1` in Turn 0 (from the PREVIOUS HTTP request), and surfaced it alongside the new result → **2 stale tabs instead of the expected new vessel-wise result only**.

### Fix: Context-Aware Conductor Selection in D2
**File**: `backend/src/langgraph/routes/workflow.ts` — `emitToolResults` function, D2 branch.

New logic in the `selection.length > 0` branch (D2 path, `currentTurnOnly=false`):
1. Build `currentRequestKeySet` from `allTurns.slice(startTurnIndex)`
2. Check `hasCurrentHits = selection.some(k => currentRequestKeySet.has(k))`
3. **If hasCurrentHits = true** → search only `currentRequestTurns` (prevents old keys from bleeding in)
4. **If hasCurrentHits = false** → search all turns (this is the pure "re-surface" scenario — no new tools ran, LLM deliberately wants to surface old data)

This preserves the legitimate re-surface use case (user asks a follow-up that needs no new tools; Orchestrator selects old keys) while fixing the mixed-history bleed.

### Problem: Log Bloat from Full toolResults Dump
The `[DEBUG] State & Scope Context` console dump included `toolResults: state.toolResults` which dumped the entire MCP response JSON (50KB+) per turn to the console. This made logs unreadable.

### Fix: 32-char Digest in Debug Dump
**File**: `backend/src/langgraph/nodes/orchestrator.ts` — debug dump block.

`toolResults: state.toolResults` → replaced with `toolResults: toolResultsDigest`, where each entry is:
```ts
{ turn: i, keys: { "maintenance.query_status_iter1": '{"capability":"maintenance.que…' } }
```
Only the first 32 characters of the result text are shown per key. All other functionally-relevant state (sessionContext, queryContext, activeMessages) remains fully logged.

> ⚠️ Note: The "vessel-wise breakdown = 2 per-vessel tabs" expectation requires the Orchestrator to run the tool TWICE (once per vesselID). The LLM chose to reuse existing data instead (single fleet-wide result). That's an AI reasoning issue, not a code bug — the data was correct but the presentation was a single tab of 29 records rather than two filtered tabs.

---

## 🛠️ 76. False Positive `unclassifiedLabels` Intercept Fix

### Problem
When the user typed "i need to see details of ALL cancelled jobs, who did those", the Orchestrator correctly ran `maintenance.query_status` org-wide (29 items, Turn 6). But when it output `SUMMARIZE`, it also emitted:
```json
"unclassifiedLabels": [{ "label": "ALL cancelled jobs", "likelyEntityTypes": [...] }]
```
The LLM treated `"ALL cancelled jobs"` — a plain descriptive phrase — as if it were a named entity to be looked up (like a vessel name or schedule name). The Strategic Intercept code fired two `mcp.resolve_entities("ALL cancelled jobs", ...)` calls. Both returned zero results (obviously). The dead-end mandate then forced the LLM into a confined SUMMARIZE state where it selected OLD stale keys (7-item results from prior conversations) rather than the freshly fetched 29-item result.

### Root Cause Chain
1. Prompt negative constraint too narrow: only excluded status values and temporal terms, not descriptive phrases starting with quantifiers like "ALL", "ANY", "details of"
2. No code-level guard: the intercept trusted the LLM output entirely, with only the `resolvedLabelSet`/`failedSessionLabels` checks

### Fix: Two-Layer Defence

**Layer 1: Prompt (orchestrator_rules.ts, line 28)**
Expanded the `Negative Constraint` on `unclassifiedLabels` to explicitly list:
- Status words (`cancelled`, `completed`, `overdue`, `committed`, `missed`, `rescheduled`)
- Temporal terms (existing)
- Generic quantities (existing)
- **NEW: Descriptive phrases** — any phrase starting with a quantifier/scope word like `ALL`, `ANY`, `EVERY`, `DETAILS`, `SHOW`. Includes concrete examples: `ALL cancelled jobs`, `details of cancelled jobs`, `cancelled maintenance`. The prompt now explains WHY: "If the user says 'show me ALL cancelled jobs', the entity is already resolved — it is a fleet-wide status query. There is NO entity label to classify."

**Layer 2: Code guard (orchestrator.ts, `actualUnclassified` filter)**
Added pre-filter that rejects any label matching ANY of these before the intercept fires:
```
(c) Starts with quantifier word: ALL, ANY, EVERY, DETAILS, SHOW, GET, FIND, LIST, RETRIEVE
(d) Contains a maintenance status word: cancelled, completed, overdue, committed, missed, rescheduled, upcoming, pending
(e) Empty/whitespace label
(f) Label > 40 chars — no real named entity is a sentence
```
This is the last line of defence: even if the LLM slips through the prompt, the code rejects it before any resolve_entities call is made.


---

## 🛠️ 77. Dead-End Label False Positive (GAP-77) — Critical Bug Fix

### Problem
When the Strategic Intercept fired parallel resolve calls for `XXX1` across 3 entity types (Vessel, Machinery, Activity):
- Vessel → **1 match found** ✅
- Machinery → 0 items
- Activity → 0 items

The old `failedSessionLabels` logic processed each resolve result **individually**. For Machinery and Activity (both empty, `searchTerm: "XXX1"`), it called `failedSessionLabels.add("xxx1")`. There was no cross-check to see if another call for the same searchTerm had already succeeded. By the time the Vessel result was processed, "xxx1" was already in the failed set — but checking it there didn't help because the add had already happened for the two empty results.

Result: The DEAD-END LABELS block fired with `"xxx1"`, mandating a clarifying question even though XXX1 had been successfully resolved as a Vessel.

### Root Cause (Line 313 — old code)
```ts
// ❌ WRONG: marks as failed on any individual empty result
if (items.length === 0 && data.appliedFilters?.searchTerm) {
    failedSessionLabels.add(data.appliedFilters.searchTerm.trim().toLowerCase());
}
```

### Fix: Two-Pass Group-By-SearchTerm (orchestrator.ts)
Replaced the single-pass per-result approach with a two-pass approach:
1. **Pass 1**: Walk all resolve_entities results, accumulate a `resolveHits: Map<searchTerm, totalItemCount>` — adding up the item counts from ALL entity types for each searchTerm.
2. **Pass 2**: Build `failedSessionLabels` from only the entries in `resolveHits` where `totalItemCount === 0`.

This ensures a searchTerm is only marked as a dead-end if it returned zero results across EVERY parallel entity-type lookup — which is the correct semantics for "we checked everywhere and found nothing".


---

## 🛠️ 78. Broad Scope Override — Deterministic Entity-Scope Release

### Problem
When a user explicitly upgraded their query from vessel-specific to org/fleet-wide (e.g., "okay show me org wide"), the Orchestrator incorrectly recycled stale vessel-specific tool results from prior conversations. The LLM, having vessel-scoped data in its context, applied the Specificity Mandate and declared the old data "sufficient" — never fetching fresh org-level data.

Root cause: there was no deterministic system signal telling the Orchestrator "specificity is explicitly suspended for this request". The LLM's lazy reasoning defaulted to the most granular data it already had.

---

### Design Principle: Recency > Specificity
When a user explicitly upgrades entity scope (org-wide, fleet-wide, all vessels), old single-entity data is **always insufficient**, regardless of how recently it was fetched. The user's latest entity-scope intent overrides all stored narrower entity filters.

**Crucially**: This only applies to *entity-scope constraints* (vesselID, machineryID, etc.). Attribute filters (statusCode, date range, limit, department) are governed purely by the user's latest words:
- "org wide but 2025 only" → release vesselID, **keep** dates
- "org wide, ignore the date range" → release vesselID AND drop dates (user said so)
- "ignore the date range" (no scope upgrade) → flag stays false, LLM drops dates via normal reasoning

---

### Implementation: 4-Component Solution

#### Component 1: `state.ts`
- Added `isBroadScopeRequest?: boolean` to the top-level `SkylarkState` interface. This is the **transient** inter-node signal emitted by Orchestrator, consumed by UpdateMemory2 on that same turn only.
- Added `isBroadScope?: boolean` inside `queryContext`. This is the **persistent** mode flag that stays true for all subsequent iterations of the same broad-scope conversation.

#### Component 2: `orchestrator.ts`
Three changes:

**Schema**: Added `isBroadScopeRequest: z.boolean()` to `orchestratorSchema`. The LLM sets this to `true` when it detects phrases like "org-wide", "fleet-wide", "for all vessels", "show me everything", "ignore the vessel filter". Schema description explicitly clarifies that attribute filters are NOT this flag's responsibility.

**Memory Injection**: Reads `queryContext.isBroadScope` (the persisted flag) and injects a `🌐 BROAD SCOPE MODE ACTIVE` block at the TOP of `memoryContext` before orgContextBlock — ensuring it's the first thing the LLM reads, making it a mandatory override. The block forbids recycling prior vessel results and reminds the LLM that attribute-level filters follow its own reasoning.

**Deterministic Post-Processing** (lines ~893–903): After the LLM responds, code checks `response.isBroadScopeRequest === true` and:
1. Forces `updates.workingMemory.queryContext.currentScope = incomingIds` — drops the old `previouslyAccumulated` vessel IDs (stale), but preserves any IDs organically discovered in THIS current turn.
2. Sets `updates.isBroadScopeRequest = true` to signal UpdateMemory2.
3. Explicitly sets `updates.isBroadScopeRequest = false` in the else branch — prevents LangGraph reducer from inheriting a stale `true` from the prior turn.

#### Component 3: `update_memory2.ts`
Two-phase clear, ordered correctly to avoid self-defeating logic:

**Phase A (isBroadScopeTriggered only)**: When `state.isBroadScopeRequest === true` fires (ONLY on the turn when the LLM first signals it):
- Surgically deletes entity-scope keys (`vesselID`, `machineryID`, `scheduleID`, `activityID`, `costCenterID`) from both `sessionStateCommit.scope` AND `previousQueryContext.activeFilters` (the LLM's inheritance list).
- The deletion from `activeFilters` is critical: without it, the Phase 2 LLM would simply re-inherit the dropped vessel ID via its "FILTER INHERITANCE" rule.

**Phase B (isBroadScopeActive, persisted)**: `isBroadScopeTriggered || existingMemory.queryContext.isBroadScope`. This broader check is only used to persist the `isBroadScope: true` flag into the next `updatedQueryContext` — not to re-clear anything.

The `deterministicScope` harvest runs AFTER the deletion so cleared keys do not re-enter `currentScope`.

On Phase 2 LLM failure (catch block), `isBroadScope: isBroadScopeActive` is explicitly preserved in the graceful degradation return — preventing a crash from silently dropping the mode.

#### Component 4: `orchestrator_rules.ts`
Added **Rule 9: Recency > Specificity (The Broad Scope Override)** to the Relational Deduction Protocol. Instructs the LLM to:
- Set `isBroadScopeRequest: true`, clear `currentScope`, forbid result recycling.
- Explicitly documents the three attribute-filter cases with examples so the LLM understands the distinction.

---

### Key Design Decisions

| Decision | Rationale |
|---|---|
| Flag is a **transient state field** (`isBroadScopeRequest`), not inferred from query text | Deterministic, not fragile |
| Entity-scope clear happens in **code** (not trusting LLM) | LLM may forget on iteration 2+ |
| Old entity IDs cleared from **both** scope AND activeFilters | Prevents Phase 2 LLM re-inheriting dropped IDs |
| Deletion only on `isBroadScopeTriggered` (not `isBroadScopeActive`) | Prevents "continuous wipe" killing newly discovered IDs on iteration 1+ |
| `currentScope = incomingIds` (not `[]`) in orchestrator post-processing | Preserves any IDs organically discovered in the SAME turn as the broad scope signal |
| `isBroadScopeRequest = false` explicit in else branch | LangGraph reducer `(x, y) => y ?? x` would otherwise keep stale `true` |

---

### Console Signals
- `🌐 BROAD SCOPE OVERRIDE ACTIVE: User requested fleet/org-wide scope.` (Orchestrator, magenta)
- `🌐 Broad Scope TRIGGERED — cleared entity-scope filters from scope and activeFilters.` (UpdateMemory2, magenta)
- `🆔 GAP-30: Deterministic currentScope Sync: [...] (BROAD SCOPE MODE)` (UpdateMemory2, yellow)
- `🌐 BROAD SCOPE MODE ACTIVE` block visible in the Orchestrator memory context print

---

### Files Modified
- `backend/src/langgraph/state.ts`
- `backend/src/langgraph/nodes/orchestrator.ts`
- `backend/src/langgraph/nodes/update_memory2.ts`
- `backend/src/langgraph/prompts/orchestrator_rules.ts`

---

## 🛠️ 79. Three-Bug Cascade Fix — Broad Scope Override Was Dead on Arrival

### Root Cause Chain (All Three Bugs Were Required to Break the Feature)

When the user typed "okay show me org wide but restrict it to 2025 only", the expected behavior was:
1. Orchestrator signals `isBroadScopeRequest=true`
2. UpdateMemory2 detects the flag, surgically clears `vesselID` from `activeFilters` and `sessionScope`
3. Phase 2 LLM inherits only `statusCode=cancelled + startDate=2025 + endDate=2025` (no vessel)
4. Next Orchestrator sees no vesselID in Active Filters and fetches org-wide data

What actually happened: the user got a re-summary of the OLD single-vessel (XXX1) data.

---

### Bug 1 (Critical): `isBroadScopeRequest` was not a LangGraph state channel

**File**: `graph.ts`

`isBroadScopeRequest` was present in the `SkylarkState` TypeScript interface but was **never declared in the `channels: {}` block** of the `StateGraph`. In LangGraph, only fields declared in the channels block are tracked in state. Updates to undeclared fields from any node are **silently dropped** — no error, no warning.

Result: `updates.isBroadScopeRequest = true` returned from the Orchestrator node was thrown away. UpdateMemory2 always read `state.isBroadScopeRequest === undefined`, so `isBroadScopeTriggered` was always `false`. The surgical clear never ran. The `🌐 Broad Scope TRIGGERED` log never appeared.

**Fix**: Added `isBroadScopeRequest` as a proper channel with a `(x, y) => y !== undefined ? y : x` reducer — same pattern as `hitl_required` and `isHITLContinuation`.

---

### Bug 2 (Critical): INSIGHT boundary detection matched wrong string

**File**: `update_memory2.ts`, line 213

The boundary detection scanned `state.messages` for the last AI summary using:
```ts
m.content.includes("[INSIGHT]")
```

All real summaries use `[INSIGHT title="..." icon="..." color="..."]`. The literal string `"[INSIGHT]"` (with closing bracket immediately adjacent) **never appears** in any summary content.

Result: `lastSummaryIdx === -1` on every new conversation after the first. `scanStartIdx = 0`. `missionTopic` was always anchored to the very first Human message in the 10-message window — which was always "i need to see details of all cancelled jobs..." from the previous conversation.

So `rawQuery` for the new query "org wide 2025" was wrong, `missionTopic === existingRawQuery`, the "TOPIC PIVOT" log never fired, and Phase 2 was given the wrong topic.

**Fix**: Changed `includes("[INSIGHT]")` → `includes("[INSIGHT")` (no closing bracket). This matches all INSIGHT variants: `[INSIGHT]`, `[INSIGHT title=...]`, etc.

---

### Bug 3 (Defense-in-Depth Gap): Entity-scope filters bled across conversation boundaries

**File**: `update_memory2.ts`

`previousQueryContext` is built by spreading `existingMemory.queryContext`, which includes `activeFilters` from the previous conversation. Even on `isNewQuery=true`, only `pendingIntents`, `lastTurnInsight`, and `currentScope` were reset — **`activeFilters` was preserved in full** as "soft context" for the Phase 2 LLM.

This is correct behavior for same-conversation continuity (attribute filters like `statusCode=cancelled` should persist). But it also carried over `vesselID=683...` and `searchTerm=XXX1`. Phase 2 LLM faithfully included these in `activeFilters` output. The next Orchestrator inherited `vesselID` and used the old XXX1 data.

**Fix**: When `isNewQuery=true`, also delete entity-scope keys (`vesselID`, `machineryID`, `scheduleID`, `activityID`, `costCenterID`, `searchTerm`) from `previousQueryContext.activeFilters` before passing to Phase 2. Attribute filters (`statusCode`, `startDate`, `endDate`, `limit`) are still soft-carried for LLM reasoning. Added matching console log: `🧹 New conversation boundary — cleared entity-scope keys...`

This is a defense-in-depth measure that also helps when Bug 1 would have otherwise left the system vulnerable.

---

### Expected Log Sequence After Fix

```
[UpdateMemory2] → isNewQuery = true (🔄 TIER 2 WILL RESET)
[UpdateMemory2] ⚓ NEW CONVERSATION DETECTED — TOPIC PIVOT:
  From: "i need to see details of all cancelled jobs..."
  To:   "okay show me org wide but restrict it to 2025 only"
[UpdateMemory2] 🌐 Broad Scope TRIGGERED — cleared entity-scope filters...
  OR
[UpdateMemory2] 🧹 New conversation boundary — cleared entity-scope keys...
[UpdateMemory2] activeFilters: {"statusCode":"cancelled","startDate":"2025-01-01","endDate":"2025-12-31"}
                               (vesselID and searchTerm are GONE)
```

---

### Key Design Rule for Future Agents

> **Any boolean flag that must flow from Orchestrator → UpdateMemory2 MUST be declared as a LangGraph channel in `graph.ts`.** The TypeScript interface (`SkylarkState`) is just a type hint — it has zero effect on LangGraph runtime state management.

---

### Files Modified
- `backend/src/langgraph/graph.ts` — Added `isBroadScopeRequest` channel declaration
- `backend/src/langgraph/nodes/update_memory2.ts` — Fixed INSIGHT boundary detection + defense-in-depth entity-scope clear on new conversation
