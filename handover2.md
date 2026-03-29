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
