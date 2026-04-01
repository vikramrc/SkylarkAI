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
