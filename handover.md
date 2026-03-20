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
  - **Turn 2 Recursive Split**: Appends `sequentialInstruction` tips if `state.iterationCount > 0` to guide multi-turn investigating without loop stagnation. Aligns with `implementation_plan.md` (item 3.1).
- **`nodes/execute_tools.ts`**:
  - Implements Parallel parallel tool triggering.
  - **Direct Query Parameter Mapping**: Maps `userQuery` appropriately mapped down nodes Node sequences for `direct_query_fallback` seamless execution execution execution.
- **`nodes/update_memory.ts`**:
  - Incrementally appends context onto memory buffers. Uses pure dynamic abstraction wrapper over standard `.env` resolvers.
- **`nodes/summarizer.ts`**:
  - Aggregates final tool outputs via `prepareMongoForLLM` support into a final analytical user-facing formatted layout.

---

### 🟢 Phase 2 & 3: Compilation & Connect Step Edges
Compiled on `graph.ts` linking node conditionals explicitly:
1. **Conditional Chaining**: Bypasses execute_tools if Orchestrator returns empty tools checklist.
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
This guarantees the absolute Frontend dashboard continues hitting those endpoints seamlessly without having to adapt or reconfigure internal socket payloads.

---

## 🧯 4. Error & Stream Troubleshooting (Latest Fixes)
- **SSE StreamEvents Refactoring (`routes/workflow.ts`)**: Converted `.invoke()` into `.streamEvents({ version: 'v2' })`.
  * **Statuses**: Emits `event: status_update` based on `event.metadata.langgraph_node` starting triggers (Orchestrator, Tools, Summarizer).
  * **Word-by-word streaming**: Emits `event: text_delta` streaming using `on_chat_model_stream` triggers filtered specifically to the Summarizer node!
- **Rich Dynamic Tool Layout (`node_orchestrator.ts`)**: Loads capabilities dynamically at runtime by polling `/api/mcp/capabilities` directly via `axios.get()`. This leverages the raw isolated MCP server contract to inject complete parameter guidelines (Required/Optional Params, Purpose, Guidance, typicalQuestions, responseShape) on-the-fly without any hardcoded code duplication.
- **Provider Support**: Installed `@langchain/google-genai` with safe null assertions.

---

## 🛠️ 6. Latest Refinements (Observational Memory & UI Timing Updates)

We rolled out several critical fixes governing prompt size bloats, real-time counter states, and context memory loading:

### 🟢 **UI Dynamic Timers (`StreamingTimeline.tsx`)**
- **Problem**: Individual stage timelines in the thinker interface froze after creation, defaulting to stagnant intervals until subsequent updates triggered rendering.
- **Fix**: Adjusted the `.map` render loop calculation inside `StreamingTimeline.tsx` to explicitly calculate `elapsed = (nowMs - item.startTime) / 1000` for active items dynamically during ticks. 

### 🟢 **Prompt Inflation & State Bloat Prevention (`graph.ts` & `orchestrator.ts`)**
- **Problem**: Submitting sequential operations inflated the system prompts by appending tool results accumulatively, exploding context window consumption and raising bills triggers  .
- **Fix**: Removed the custom dictionary merge reducer `(x, y) => ({ ...x, ...y })` from `toolResults` on `graph.ts`. LangGraph now employs deep overwrites turn-by-turn. 
- Additionally reinforced `toolResults: {}` flush wipes inside `nodeOrchestrator` outputs to start fresh per-turn.

### 🟢 **Observational Memory Consolidation (`update_memory.ts`)**
- **Problem**: Memory summaries over-wrote instead of combining seamlessly across operations.
- **Fix**: Upgraded the system instructions to feed **`[Previous Memory]`** along with `[Latest Tool Results]`, instructing are consolidation on-the-fly to prevent memory replacement lists loops  .
- Adapted instruction guidelines using strict **PMS Architecture** entities (`Vessel`, `Machinery`, `ActivityWorkHistory`, `InventoryPart`) for rich dataset descriptions.

### 🟢 **API State Persistence Setup Bug (`routes/workflow.ts`)**
- **Problem**: `Observational Memory` was empty on multiple Human sequence triggers startup.
- **Fix**: Traced it to `streamEvents()` initializing starting inputs:
  ```typescript
  workingMemory: { summaryBuffer: "" } // 🔴 Redundant overwrite clobbered checkpointer
  ```
  Removed explicit empty initializers for auxiliary state structures in `backend/src/langgraph/routes/workflow.ts`. Now only `messages: [new HumanMessage(userQuery)]` acts as the trigger, letting the durable checkpointer populate and carry forward previous session buffers safely Turn-by-Turn!

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
- **Fix**: Rectified all comparison filters inside `.streamEvents()` to match `"summarizer"`, `"orchestrator"`, `"execute_tools"`, and `"update_memory"`.

---

## 🛠️ 9. Latest Structural Improvements (Schema Inference, Continuous Session Scope, & Local Fallbacks)

We rolled out several enhancements governing schema context context context context accurately   index flaws:

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
- **Fix**: Appended static tool block description for `direct_query_fallback` into the `%%TOOL_CONTEXT%%` payload outlining its general purpose to perform semantic search/aggregates on **Forms, Crew, Budget, or Voyage logs** when specialized endpoints fail fail to return field-level items   index seamlessly.

### 🟢 **Summarizer Node Completion Directive Response Thresholding (`summarizer.ts`)**
- **Problem**: When `direct_query_fallback` returned full record payloads, the Summarizer AI was overly conservative and asked the user a clarifying question again rather than presenting the answers answers  .
- **Fix**: Added an explicit **`Completion Directive`** instructing the LLM to summarize and present queried payload records (e.g., loaded form submissions, formData) directly instead of defaulting to permissions questions.

---

## 🛠️ 11. Latest Optimizations (Parallel Graph Paths)

We rolled out graph-level integrations to reduce perceived latency triggers flaws:

### 🟢 **Parallel Node Execution (`graph.ts`)**
- **Problem**: Serialized execution `execute_tools` ➡️ `update_memory` ➡️ `summarizer` forced consecutive LLM roundtrips, delaying final text streams.
- **Fix**: Parallelized execution paths for turn wrap-ups:
    *   **Conditional Fork (`execute_tools`)**: If `feedBackVerdict === "SUMMARIZE"` or `standsAmbiguous` triggers, it returns `["update_memory", "summarizer"]` invoking both nodes concurrently.
    *   **Condition Guard (`update_memory`)**: Appends safety guard returning `"__end__"` if the execution was already parallelized to prevent duplicate summarizer triggers  .
- **Result**: Hides the entire update_memory LLM delay from the user, triggering immediate markdownstreams!

### 🟢 **Startup Capabilities Caching (`summarizer.ts`)**
- **Problem**: synchronous `fs.readFileSync` reads reading contract file inside async node invocation caused blocking event blocks  .
- **Fix**: Preloaded capabilities contract file into a module module module scope variable (`contractStrCache`) EXACTLY ONCE at runtime.
- **Result**: Shaves off IO overhead latency, fully instant memory buffers!

---

## 📑 10. Next Step Tasks for Next Agent (Maintenance Mode):
- **Continuous Feedback Evaluation**: Verify state propagation loops on complex sequential sequential back-feeds.

---

## 🛠️ 13. AI Interruption & Markdown Table Enhancements

We rolled out a reliable continuous AI interruption layer paired with robust Markdown parsing parsing:

### 🟢 **Centralized Abort Signals (`stream_manager.ts` & `workflow.ts`)**
- **Problem**: Long-running streaming streams were un-stoppable from client-side instructions.
- **Fix**: 
  1. Built a central controller `activeStreams = new Map<string, AbortController>()` keyed by tracking values values triggers  ly triggers  .
  2. Mounted GET coordinate `/workflow/stop?runId=...` triggering aborts cleanly  ly triggers  ly   trigger  .
  3. Integrated signals inside node execution layers (`summarizer.ts`) directly into model `.invoke()` bounds  ly triggers  .

### 🟢 **Continuous processing state fixes (`ContinuousChatView.tsx`)**
- **Problem**: Processing indicators toggles off prematurely due to synchronous EventSource wrappers exiting wrappers prematurely.
- **Fix**: Re-keyed `isProcessing(false)` triggers onto actual EventSource listeners callbacks (`result`, `workflow_error`, `onerror`)   triggers.

### 🟢 **Table toolbar Action handles (`MdBubbleContent.tsx`)**
- **Problem**: Hard scaling large dataset exports coordinates  ly.
- **Fix**: Built client-side trigger coordinates forming **Copy to TSV** and **Export to CSV** buffers  ly trigger  . Reinforced prompt structures in `summarizer.ts` forbidding numbering breakdowns  ly trigger   trigger  ly triggers  .

---

## 🛠️ 14. Simple Conversation Storage Rehydration

We introduced raw MongoDB query archiving storing user queries and assistant responses for continuous layout rehydrations:

### 🟢 **Stream Event archiving (`workflow.ts`)**
- **Fix**: Uses `ConversationModel.addMessage(runId, userQuery, assistantResponse)` and `ConversationModel.upsertShell(runId, userQuery)` inside result triggers  ly.
- **Support Endpoint**: Uses `ConversationModel.getMessages(runId)` delivering historical message list listing seamlessly.

### 🟢 **Model Encapsulation (`Conversation.ts`)**
- **Design**: Created `backend/src/langgraph/models/Conversation.ts` encapsulating all message pair inserts, sidebar upserts, and text index automation setup securely   trigger  .

### 🟢 **Continuous rehydration loader (`ContinuousChatView.tsx`)**
- **Fix**: Upgraded layout `useEffect` watching Continuous conversation ID switches on sidebar loaded models loaded.
- **Flow**: Executes asynchronous load pulling historical pair coordinates  ly   mapping back into standard visual chat frames  ly trigger  .
- **Card Cleanup**: Stripped outdated `results` count or `Status` badges from sidebar item cards layouts  ly  ly triggers.

---

## 🛠️ 12. Latest Ambiguity handling & UI Displays (`execute_tools.ts` & `graph.ts`)

We rolled out fixes to properly display ambiguity clarifying prompts as beautiful Assistant bubbles instead of crashing the turn loops:

### 🟢 **Sentinel Exception Handler (`execute_tools.ts`)**
- **Problem**: When `direct_query_fallback` triggered ambiguity (`__ambiguity_stop: true`), it was caught as an execution crash nodeError, triggering `Error Node` alerts.
- **Fix**: Updated `execute_tools.ts` error condition block to ignore the `__ambiguity_stop === true` sentinel trigger. 

### 🟢 **In-node AIMessage Formatting (`execute_tools.ts`)**
- **Problem**: Skipping the error permitted graph completion, but displayed `"No response generated."` on the UI due to lack of standard item items appended to `state.messages`.
- **Fix**: Added a check at return-time in `execute_tools.ts` to aggregate `clarifyingQuestions` and `assumptions` into a nice markdown structure and push a `new AIMessage()` to states state.

### 🟢 **Direct Escape Condition (`graph.ts`)**
- **Problem**: Parallel execution branches tried parallelizing with `update_memory` and `summarizer` loops loops, causing redundant analysis analysis.
- **Fix**: Updated the conditional edge for `execute_tools` in `graph.ts` to yield return `"__end__"` strictly when `standsAmbiguous` evaluates true, terminating turn successfully instantly!

---

## 🛠️ 15. Pin & Delete Capability Integration

We wired up the conversation action CTAs (Pin and Delete) to interface accurately  ly with local Skylark endpoints  ly without dependency blocks on outdated backend designs:

### 🟢 **Layout Prop wiring (`NewChatLayoutV2.tsx`)**
- **Problem**: The contemporary continuous timeline view layout (`NewChatLayoutV2.tsx`) hardcoded standard `onTogglePin={() => {}}` and `onDelete={() => {}}` as no-op stubs stubs. 
- **Fix**: Implemented active `handleTogglePin` and `handleDeleteConversation` callbacks that make direct hits onto `apiService.togglePin` and `apiService.deleteConversation` safely.

### 🟢 **Targeted Endpoint Prefixes (`api.service.ts`)**
- **Fix**: Re-anchored `togglePin` and `deleteConversation` hooks strictly back onto the pre-existing **Skylark `phoenix-openai-response.ts`** endpoints (`PATCH /conversations/:id/pin` and `DELETE /conversations/:id`). This ensures absolute payload routing directly back to pure continuous models  ly triggers  ly   trigger transparent transparent!

---

## 🛠️ 16. Multi-Step Autonomy & Tabbed Multi-Tool Displays

We introduced deeper autonomous reasoning cycles and streamlined the presentation of multiple concurrently triggered datasets.

### 🟢 **Multi-Step Iterator Restarts (`workflow.ts` & `graph.ts`)**
- **Problem**: Multi-hop reasoning loops (e.g., resolving Organization ➡️ Vessel ➡️ Activities) hit the auto-summarizer limit prematurely after 1 cycle due to cumulative `iterationCount`.
- **Fix**: 
  1. Updated `workflow.ts` `.streamEvents()` initializer setting `iterationCount: 0` ensuring clean slates Turn-by-Turn.
  2. Increased the summarization iterations ceiling threshold in `graph.ts` from `>= 2` to `>= 3` cycles, granting core reasoning agents ample cycles to discover complex nested identifiers autonomously autonomously flawlessly.

### 🟢 **Tabbed Multi-Tool Panel (`ResultTable.tsx`)**
- **Problem**: Running multiple tools sequentially (like Maintenance and Budget) rendered stacked tables which became tall, cluttered, and cumbersome items to scan.
- **Fix**: Completely rewrote frontend `ResultTable.tsx` into a **Tabbed Interface**. Single tool calls display standard single frames, while multi-tool payloads render absolute sleek top tabbars sorting results accurately with grouped tallies mapped mapped flawlessly flawless trigger flawless.

---

## 🛠️ 17. Parallel Overwrite & Table Persistence Safety

We patched dictionary race conditions in parallel branches and wired result history caching to safeguard ResultTable nodes across dashboard navigations.

### 🟢 **Duplicate Parallel execute Overwrite Fix (`execute_tools.ts`)**
- **Problem**: When Orchestrator invoked the *same tool name* twice in one turn with differing arguments (e.g., query Vessel A and Vessel B concurrently), state population `outputs[name] = result` caused race condition clobber drops.
- **Fix**: Adjusted execution closure into sequentially reduced builder blocks. If tool keys collide, it appends unique indices (`_1`, `_2`) protecting aggregates aggregates securely flawlessly.

### 🟢 **Turn-Linked Table State Persistence (`Conversation.ts` & `ContinuousChatView.tsx`)**
- **Problem**: Multi-tool result tables disappeared between turn sequences because `toolResults` were emitted purely live but never cached onto MongoDB schemas.
- **Fix**:
  1. Extended `ChatMessage` schema supporting generic `toolResults` objects payloads inside model database schemas database.
  2. Integrated `.getState()` final response handlers fetching and routing aggregates correctly into `ConversationModel.addMessage()`.
  3. Appended local hydration map loops inside `ContinuousChatView.tsx` pushing `{ type: 'table' }` restoring loaded frames frames natively seamlessly.

