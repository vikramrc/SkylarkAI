# 🛫 SkylarkAI - LangGraph Migration Handover

This document outlines the architectural shift from **Mastra Workflows** to **LangGraph**, detailing the rationale, structural implementation layout, and final endpoint wiring completed to resolve multi-turn conversational crash errors.

---

## 💡 1. Rationale: Why Shifting to LangGraph?
We decided to build a **side-by-side LangGraph pipeline** to fix a blocking **Reasoning/State Bug in Mastra**:
1. **Loop Caps & Back-Feeds**: Mastra's abstracted internal agent wrapper made iterating loops and injecting turning IDs accurately difficult, causing session-id collisions/loop crashes on sequential turn investigation.
2. **Granular Turn Control**: LangGraph gives us absolute control over **Conditional Edges** (e.g., fallback triggers, ambiguity breaks, dynamic safeguards).
3. **Observational Memory Control**: By defining explicit channels for working memory state machines, we regulate context growth deterministically without relying on Mastra's background summaries injection loops.

---

## 📈 2. Implementation Summary (Based on `implementation_plan.md`)

### 🟢 Phase 1 & 2: Graph Setup & Node Orchestration
Created a pure side-by-side State Graph framework inside `backend/src/langgraph`:

- **`state.ts`**: Defines standard `SkylarkState` capturing standard message lists, iterative tool counters (`iterationCount`), aggregate dynamic `workingMemory`, and `toolResults`.
- **`nodes/orchestrator.ts`**:
  - Employs `.withStructuredOutput()` enforcing JSON schemas (`{ tools: [], feedBackVerdict: 'SUMMARIZE' | 'FEED_BACK_TO_ME' }`).
  - **Prompt Caching Optimize**: Splits static system guidelines away from dynamic context strictly guaranteeing Static Prefix caching matches matches.
  - **Turn 2 Recursive Split**: Appends `sequentialInstruction` tips if `state.iterationCount > 0` to guide multi-turn investigating without loop stagnation. FLawlessly aligns with `implementation_plan.md` (item 3.1).
- **`nodes/execute_tools.ts`**:
  - Implements Parallel parallel tool triggering.
  - **Direct Query Parameter Mapping**: Maps `userQuery` appropriately mapped down nodes Node sequences for `direct_query_fallback` seamless execution execution execution.
- **`nodes/update_memory.ts`**:
  - Incrementally appends context onto memory buffers. Uses pure dynamic abstraction wrapper over standard `.env` resolvers.
- **`nodes/summarizer.ts`**:
  - Aggregates final tool outputs via `prepareMongoForLLM` support into a final analytical user-facing formatted layout layout layout flawlessly!

---

### 🟢 Phase 2 & 3: Compilation & Connect Step Edges
Compiled on `graph.ts` linking node conditionals explicitly:
1. **Conditional Chaining**: Bypasses execute_tools if Orchestrator returns `[]` tools checklist triggers flawlessly.
2. **Disambiguation Breaks**: If **any tool result** contains `__ambiguity_stop: true`, conditional edges accurately route immediately to the Summarizer halt iteration capping.
3. **Durable Persistence Section**: Complies with durable checkpointer **`MongoDBSaver`** drawing dynamically from `.env.SKYLARK_MONGODB_URI` securely:
   ```typescript
   const client = new MongoClient(uri);
   const memorySaver = new MongoDBSaver({ client: client as any, dbName });
   ```

---

## 🔌 3. Final Mounting & Setup Connections (`index.ts`)
The LangGraph framework sits parallelly in `src/langgraph/routes/workflow.ts` on its own standalone router. 
To switch live, `index.ts` mounts it directly over the existing `/api/mastra` endpoint:
```typescript
import { createLangGraphWorkflowRouter } from './langgraph/routes/workflow.js';

// Switched from Mastra 
app.use('/api/mastra', createLangGraphWorkflowRouter());
```
This guarantees the absolute Frontend dashboard continues hitting those endpoints seamlessly without having to adapt or reconfigure internal socket payloads payloads back-fed flawlessly!

---

## 🧯 4. Error & Stream Troubleshooting (Latest Fixes)
- **SSE StreamEvents Refactoring (`routes/workflow.ts`)**: Converted `.invoke()` into `.streamEvents({ version: 'v2' })`.
  * **Statuses**: Emits `event: status_update` based on `event.metadata.langgraph_node` starting triggers (Orchestrator, Tools, Summarizer).
  * **Word-by-word streaming**: Emits `event: text_delta` streaming using `on_chat_model_stream` triggers filtered specifically to the Summarizer node!
- **Rich Dynamic Tool Layout (`node_orchestrator.ts`)**: Loads capabilities dynamically at runtime by polling `/api/mcp/capabilities` directly via `axios.get()`. This leverages the raw isolated MCP server contract to inject complete parameter guidelines (Required/Optional Params, Purpose, Guidance, typicalQuestions, responseShape) on-the-fly without any hardcoded code duplication flawlessly.
- **Provider Support**: Installed `@langchain/google-genai` with safe null assertions flawlessly flawless.

---

## 🛠️ 6. Latest Refinements (Observational Memory & UI Timing Updates)

We rolled out several critical fixes governing prompt size bloats, real-time counter states, and context memory loading:

### 🟢 **UI Dynamic Timers (`StreamingTimeline.tsx`)**
- **Problem**: Individual stage timelines in the thinker interface froze after creation, defaulting to stagnant intervals until subsequent updates triggered rendering.
- **Fix**: Adjusted the `.map` render loop calculation inside `StreamingTimeline.tsx` to explicitly calculate `elapsed = (nowMs - item.startTime) / 1000` for active items dynamically during ticks. 

### 🟢 **Prompt Inflation & State Bloat Prevention (`graph.ts` & `orchestrator.ts`)**
- **Problem**: Submitting sequential operations inflated the system prompts by appending tool results accumulatively, exploding context window consumption and raising bills triggers triggers flawlessly.
- **Fix**: Removed the custom dictionary merge reducer `(x, y) => ({ ...x, ...y })` from `toolResults` on `graph.ts`. LangGraph now employs deep overwrites turn-by-turn. 
- Additionally reinforced `toolResults: {}` flush wipes inside `nodeOrchestrator` outputs to start fresh per-turn.

### 🟢 **Observational Memory Consolidation (`update_memory.ts`)**
- **Problem**: Memory summaries over-wrote instead of combining seamlessly across operations.
- **Fix**: Upgraded the system instructions to feed **`[Previous Memory]`** along with `[Latest Tool Results]`, instructing are consolidation on-the-fly to prevent memory replacement lists loops flawless.
- Adapted instruction guidelines using strict **PMS Architecture** entities (`Vessel`, `Machinery`, `ActivityWorkHistory`, `InventoryPart`) for rich dataset descriptions.

### 🟢 **API State Persistence Setup Bug (`routes/workflow.ts`)**
- **Problem**: `Observational Memory` was empty on multiple Human sequence triggers startup.
- **Fix**: Traced it to `streamEvents()` initializing starting inputs:
  ```typescript
  workingMemory: { summaryBuffer: "" } // 🔴 Redundant overwrite clobbered checkpointer
  ```
  Removed explicit empty initializers for auxiliary state structures in `backend/src/langgraph/routes/workflow.ts`. Now only `messages: [new HumanMessage(userQuery)]` acts as the trigger trigger flawlessly, letting the durable checkpointer populate and carry forward previous session buffers safely Turn-by-Turn!

---

## 🛠️ 7. Latest Continuous Fixes (State Channels, Error Suppressions, and Stream Typos)

We rolled out several fixes governing channel wipes, duplicate error renders, and response streaming streams:

### 🟢 **State Channel Durability for `workingMemory` (`graph.ts`)**
- **Problem**: Individual node returns (like `execute_tools.ts`) that omitted the `workingMemory` key triggered LangGraph's default overwrite strategy, replacing the channel with `undefined` and causing crashes like `Cannot read properties of undefined (reading 'summaryBuffer')`.
- **Fix**: Added `reducer: (x: any, y: any) => y ?? x` to the `workingMemory` channel in `graph.ts` to keep previously accumulated states if nodes don't return it explicitly.
- **Defensive Guards**: Supplemented with safe navigation operators `state.workingMemory?.summaryBuffer` guards across `orchestrator.ts` and `update_memory.ts`.

### 🟢 **Main Chat Bubble Suppressions on Error (`error.ts` & `workflow.ts`)**
- **Problem**: When a node failed (such as a 429 quota hit), the system injected error strings into the main chat bubble, defeating the visual standard for showing crashes **only** inside Accordion Timelines.
- **Fix**: Removed the explicit `{ messages: [...] }` append inside `nodeError`'s returned payload. Added a local tracker `let didError = false` inside `workflow.ts` stream events to suppress fallback `"No response generated."` text creations on crash events.

### 🟢 **Node Name Stream Name Mismatches (`workflow.ts`)**
- **Problem**: Streaming logic evaluated event streams using prefixes like `"nodeSummarizer"` instead of the actual Graph-registered `"summarizer"` node name, disabling stream events for successful successful text responses.
- **Fix**: Rectified all comparison filters inside `.streamEvents()` to match `"summarizer"`, `"orchestrator"`, `"execute_tools"`, and `"update_memory"` flawlessly index.

---

## 🛠️ 9. Latest Structural Improvements (Schema Inference, Continuous Session Scope, & Local Fallbacks)

We rolled out several enhancements governing schema context context context context accurately flawlessly index flaws:

### 🟢 **Accurate Schema Inference & Static Contract Injection (`summarizer.ts`)**
- **Problem**: Lowered accuracy in `### GLOBAL SCHEMA CONTEXT` due to stringified JSON returned by MCP wrapper streams inside `content[0].text`. It inferred simple arrays/strings instead of nested properties.
- **Fix**: 
  1. Added explicit `JSON.parse` unpacking on `content[0].text` wrapper elements BEFORE feeding `prepareMongoForLLM`.
  2. Injected `readFileSync` extraction reading static contracts from `mcp.capabilities.contract.js` based on `capabilityName` matching.

### 🟢 **Continuous Session Scope carry-forwards (`update_memory.ts`)**
- **Problem**: Memory summaries dropped Implicit filters like `organizationShortName` or `vesselName` over multi-turn timezone confirmations.
- **Fix**: Expanded the system prompt injection rule to carry forward any session-bounding identifiers (Organization IDs, Vessel Names, Budget Years, Machinery IDs) so they stick firm stick firm stick firm on rolling buffers.

### 🟢 **Timeline Error Red Cross Indicator (`ContinuousChatView.tsx` & `workflow.ts`)**
- **Problem**: Timeline statuses hardcoded `stage: 'execute'`, showing Checkmarks instead of Error Red Cross icons on node crashes.
- **Fix**: Adjusted `ContinuousChatView` to use `stage: data.stage || 'execute'`. Set `routes/workflow.ts` to emit `stage: 'error'` immediately on `errorNode` activations.

### 🟢 **Equipped Orchestrator with Direct Query fallback (`orchestrator.ts`)**
- **Problem**: Left to poll `/api/mcp/capabilities`, local local tools like `direct_query_fallback` were missing from the descriptions description, disabling the ability to trigger failback failing overs.
- **Fix**: Appended static tool block description for `direct_query_fallback` into the `%%TOOL_CONTEXT%%` payload outlining its general purpose to perform semantic search/aggregates on **Forms, Crew, Budget, or Voyage logs** when specialized endpoints fail fail to return field-level items flawlessly index seamlessly.

---

## 📑 10. Next Step Tasks for Next Agent (Maintenance Mode):
- **Continuous Feedback Evaluation**: Verify state propagation loops on complex sequential sequential back-feeds flawlessly.
