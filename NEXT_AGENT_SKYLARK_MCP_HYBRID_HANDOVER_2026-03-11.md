# SkylarkAI Next-Agent Handover

**Date:** 2026-03-11  
**Primary focus:** SkylarkAI MCP layer, PhoenixCloudBE deterministic capability surface, and PhoenixAI backend/runtime consolidation into this project  
**Intended next architecture:** **Mastra AI SDK + assistant-ui + this backend as the single maintained host for Skylark MCP + migrated PhoenixAI runtime (Tools first, MongoQL second; MongoDB is the database technology of choice, and this product’s MongoDB database should be named `SkylarkDB` with clear internal boundaries between domain data and assistant/system state)**

---

## 1. Why this document exists

This handover is for the **next agent** who needs to continue the current MCP / agent architecture work with full context.

The immediate goal is **not** another isolated bugfix. The goal is to carry forward a broader system direction:

1. Keep the current **deterministic MCP surface** working.
2. Move toward a **user-controlled assistant stack**.
3. Use **Mastra AI SDK** as the orchestration layer.
4. Use **assistant-ui** as the frontend.
5. Keep **SkylarkAI** as the backend host for the MCP server.
6. Pull **PhoenixAI backend/runtime code** into this project so unsupported questions can use the PhoenixAI query path **inside the same maintained backend**.
7. End up with a **hybrid architecture**:
   - **Tools / deterministic MCP first**
   - **MongoQL / LLM fallback second**

This direction is reasonable and strongly recommended, with guardrails described below.

---

## 2. Very important warning about repo docs

At the repo root there are older files named:

- `handover.md`
- `handover2.md`

These are **Halcyon LayTime Mate** handovers and are **not the active MCP / Skylark / PhoenixAI architecture handover** for this current effort.

Do **not** assume those files represent the current MCP project direction.

This file is the correct continuity document for the present workstream.

---

## 3. High-level system summary

There are effectively **three cooperating layers / codebases** in play:

### A. SkylarkAI
Current role: **MCP server / proxy layer**.

What it does today:
- exposes MCP tools
- accepts tool calls over MCP transports
- forwards those calls to PhoenixCloudBE
- returns the response payload back to the caller

What it does **not** primarily do today:
- it is **not** the main LLM reasoning/orchestration engine for user queries
- it is **not** currently the main place where OpenAI query model selection controls cost in the active MCP flow

### B. PhoenixCloudBE
Current role: **deterministic execution layer / business API surface**.

What it does:
- owns the actual business data access
- answers maintenance / crew / inventory / fleet / PTW / procurement / budgeting / documents questions deterministically
- backs the MCP capability surface that Skylark exposes

### C. PhoenixAI
Current role: **ambiguity handling / LLM orchestration / retrieval / query generation / MongoQL-style fallback path**.

What it does:
- interprets natural language
- resolves ambiguity
- performs retrieval / narrowing
- generates executable query structures / Mongo-oriented result paths
- can stream and handle more open-ended questions not fully covered by deterministic tools

---

## 4. Current architecture: what is running today

### Active practical flow

The active MCP path is currently:

**MCP Client / Inspector / external assistant**  
→ **SkylarkAI MCP server**  
→ **PhoenixCloudBE MCP/business endpoints**  
→ **SkylarkAI returns result**  
→ **caller model/client humanizes the output**

That means the caller model is often where the final answer is synthesized.

### Important consequence

If cost is high during MCP usage, the cost is often driven more by:
- the **caller model**
- or **PhoenixAI LLM calls**

than by Skylark itself.

Skylark contributes token overhead mainly through:
- tool descriptions / tool metadata
- tool result size
- raw JSON returned back to the caller model

But Skylark is not the primary place where multi-step LLM orchestration is happening in the active proxy-only path.

---

## 5. Current SkylarkAI MCP implementation to understand first

These files matter the most inside Skylark:

### `backend/src/index.ts`
Current role:
- boots Express
- applies CORS / Helmet / body parsing
- mounts MCP routes via `setupMcpRoutes(app)`

Relevant current behavior:
- logs requests
- exposes the MCP endpoints
- advertises:
  - `http://localhost:${PORT}/mcp`
  - `http://localhost:${PORT}/mcp/sse`

### `backend/src/mcp/server.ts`
Current role:
- the real MCP server entrypoint
- builds registered tools from the capabilities contract
- sanitizes tool names for OpenAI/client compatibility
- supports both modern and legacy transport styles

Important details:
- uses `StreamableHTTPServerTransport`
- also supports legacy `SSEServerTransport`
- registers handlers for:
  - `ListToolsRequestSchema`
  - `CallToolRequestSchema`
- on tool call, delegates to `proxyToolCall(...)`

Routes currently supported:
- `POST/GET/DELETE/HEAD /mcp` as streamable MCP handling pattern
- compatibility behavior around `/mcp/sse`
- legacy message path `/mcp/messages`

### `backend/src/mcp/proxy.ts`
Current role:
- performs the actual proxy call to PhoenixCloudBE

Important current behavior:
- validates that required arguments are present
- validates that a token exists
- forwards request method/path/query params to PhoenixCloudBE
- returns the response as **full minified JSON** via:
  - `JSON.stringify(response.data)`

Important current policy:
- semantic truncation / preview minimization was experimented with and then **reverted**
- current state intentionally preserves the full data payload
- only whitespace-heavy pretty-printing was removed

### `backend/src/mcp/capabilities/contract.ts`
Current role:
- defines the MCP capability contract that Skylark exposes
- includes descriptions, schema, and identifier guidance

Important current behavior:
- supports friendly organization identification via:
  - `organizationShortName`
  - `organizationName`
  - `organizationID`
- supports friendly vessel identification via:
  - `vesselName`
  - `vesselID`
- builds tool descriptions and input schemas from the contract
- includes `whenToUse` / `whenNotToUse` style guidance for many tools

---

## 6. Current PhoenixCloudBE role and key changes already made

PhoenixCloudBE must continue to be treated as the **deterministic business execution layer**.

This split is important:

- **PhoenixCloudBE** = deterministic execution / business truth surface
- **PhoenixAI** = ambiguity handling / LLM orchestration / flexible query generation

Do not blur that separation casually.

### Important previous MCP work completed in PhoenixCloudBE

The following work was already completed earlier and should be preserved:

1. **Friendly identifier handling** for MCP queries
   - `organizationShortName`
   - `organizationName`
   - `organizationID`
   - `vesselName`
   - `vesselID`

2. **Maintenance drill-down support**
   - schedules by vessel
   - machinery by schedule
   - activities by machinery within a schedule

3. **Contract synchronization** between PhoenixCloudBE and SkylarkAI MCP exposure

4. **Expired-documents / contract mismatches fixed**

5. **OpenAI-safe / client-safe MCP tool naming support** on the Skylark side

### Critical auth note from previous work

There was a production-style issue with `organizationShortName=fleetships`.

Root cause:
- same-org validation depended on `req.user.orgShortName`
- but only `organizationID` was guaranteed in the active auth path

The fix was intentionally **narrow and route-local** in:
- `PhoenixCloudBE/routes/mcp.route.js`

This is a very important design constraint:

> **Do not “clean this up” by broadening shared auth middleware unless absolutely necessary.**

The user is explicitly risk-sensitive about broad auth rewrites.

Preferred style:
- narrow, local MCP fixes
- route-specific normalization
- avoid shared auth blast radius

### PhoenixCloudBE files worth reviewing next

- `PhoenixCloudBE/routes/mcp.route.js`
- `PhoenixCloudBE/controllers/mcp.controller.js`
- `PhoenixCloudBE/services/mcp.service.js`
- `PhoenixCloudBE/constants/mcp.capabilities.contract.js`
- `PhoenixCloudBE/MCP_API_IMPLEMENTATION_TRACKER.md`

The tracker file should remain part of continuity.

---

## 7. Current PhoenixAI role and what is now being consolidated

PhoenixAI is the current home of the **non-deterministic / LLM-heavy / retrieval / MongoQL-style** path.

That part remains true conceptually, but the architecture note in the earlier version of this document was too soft.

### Correction to the architecture direction

The target is **not** to keep PhoenixAI as a separate long-term sibling service that Skylark merely calls.

The user explicitly wants to:

- pull the **PhoenixAI backend/runtime code** into this project
- keep **one maintained project**
- bring over the backend pieces PhoenixAI needs to run
- bring over the **prompt system**
- bring over the **Qdrant/indexer/startup** pieces
- bring over **signin/auth/session** pieces
- bring over the **deployment concepts/scripts** in adapted form
- **not copy `FE_TSX` wholesale as the new frontend**
- but **do carry forward FE_TSX requirements that matter**, especially:
  - the 4-language localization support (`en`, `ja`, `zh`, `ko`)
  - the sign-in/auth UX and behavior embodied by `SignIn.tsx`

So the next agent should treat PhoenixAI as a **migration source** whose backend/runtime capabilities are being absorbed here, not as an external service to preserve indefinitely.

### Critical PhoenixAI behavior already identified

Main route surface:
- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix-openai-response.route.js`

Main orchestration service:
- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix-openai-response.service.js`

What this path currently does:
- keyword extraction
- ambiguity resolution
- retrieval / narrowing
- intent selection
- query generation
- streaming and non-streaming execution
- conversation persistence / rehydration
- GridFS-backed large-result persistence

Important confirmed implementation details:
- prompts are loaded through `loadPrompts()` from `../AgentsAndMCPs/PhoenixAI/BE/utils/prompts-loader.js`
- prompt content lives centrally in `../AgentsAndMCPs/PhoenixAI/prompts.ts`
- schema grounding depends on `../AgentsAndMCPs/PhoenixAI/seed/pms_collections_vector_schema.json`
- retrieval is delegated to `retrieveChunksGrouped(...)` from `../AgentsAndMCPs/PhoenixAI/BE/services/retrieve.service.js`
- large results are persisted through `uploadJSONToGridFS(...)`
- conversation views use `detectDualViewOpportunity(...)`

### Cost-related behavior already confirmed

PhoenixAI uses env-driven model selection with defaults such as:
- `OPENAI_AMBIGUITY_MODEL` → default `gpt-5-mini`
- `OPENAI_QUERY_MODEL` → default `gpt-5`
- `OPENAI_EMBED_MODEL` → default `text-embedding-3-small`

It also performs **multiple LLM calls per user query**, which is why PhoenixAI remains a real cost center even though Skylark’s current proxy path is not.

---

## 8. The actual target architecture after the user correction

This section supersedes the earlier softer wording.

### User’s intended direction

The user wants to move toward:

- **assistant-ui** for the frontend chat / assistant experience
- **Mastra AI SDK** for orchestration and agent logic
- **this backend project** as the home for:
  - Skylark MCP serving/proxy logic
  - the migrated PhoenixAI backend/runtime logic
  - future hybrid orchestration logic
- **MongoDB** as the database technology of choice
- **`SkylarkDB`** as the MongoDB database name for this product, with clear logical boundaries between business/domain collections and Mastra/assistant/system collections
- **PhoenixCloudBE** continuing as the deterministic business/API execution surface

### Best expression of that architecture

Recommended future flow:

**assistant-ui frontend**  
→ **Mastra-based assistant/orchestrator**  
→ **this consolidated backend**  
→ first try **Skylark MCP tools (deterministic via PhoenixCloudBE)**  
→ if insufficient, route to **migrated PhoenixAI runtime inside the same project**  
→ answer returned to frontend

### Why this is the right direction

Because it gives the user:

1. **One maintained project**
   - less operational sprawl
   - less ambiguity about where assistant logic lives

2. **Model control**
   - pick `gpt-5-mini` or other models deliberately

3. **Cost control**
   - avoid being stuck with expensive default caller behavior

4. **Deterministic-first architecture**
   - whenever a tool exists, use the tool

5. **Fallback coverage for uncovered questions**
   - migrated PhoenixAI / MongoQL logic covers questions not fully captured by the MCP surface

6. **Cleaner long-term product story**
   - tools for precision
   - LLM fallback for coverage
   - one backend shell to own and evolve

---

## 9. Cost / model-control conclusions from this session

This remains important because it motivates the target architecture.

### What was initially suspected

The user noticed that querying the MCP was quickly consuming OpenAI credits.

### What was found

1. Skylark does contain OpenAI-related env settings such as `OPENAI_QUERY_MODEL`, but that is **not the active cost lever in the current MCP proxy path**.
2. In the active Skylark MCP flow, Skylark is mostly:
   - receiving tool calls
   - proxying to PhoenixCloudBE
   - returning results
3. The “humanization” step is normally performed by the **caller assistant/model**, not by Skylark itself.
4. If the user uses a client like MCP Inspector with their own OpenAI key, they may effectively **lack meaningful model control**, depending on how the client is configured.
5. PhoenixAI itself is a meaningful cost center because it can do **multiple LLM calls per request**.

### What was temporarily tried

An aggressive Skylark-side response compaction / truncation approach was implemented to reduce token use.

### Why it was reverted

The system was already performing well, and the user did not want correctness / completeness degraded.

That was the right concern.

So the risky minimization was **reverted**.

### Current agreed state

- tool outputs remain **full**
- tool descriptions remain **rich enough for proper usage**
- JSON is still **minified** rather than pretty-printed
- no semantic truncation is currently active in `backend/src/mcp/proxy.ts`

### Strategic conclusion

The user’s plan is correct:

> If they build and control their own assistant and run it on a cheaper model such as `gpt-5-mini`, then the system should generally be cheaper while preserving quality better than doing risky truncation inside Skylark.

---

## 10. Recommended architecture principle: Tools first, MongoQL fallback second

This should be the default routing principle going forward.

### Rule of thumb

#### Use deterministic MCP tools when:
- a matching capability exists
- the question can be answered from the current capability contract
- required identifiers can be resolved
- a multi-tool composition can answer the question safely

#### Use migrated PhoenixAI fallback when:
- no tool exists for the question
- the question is broader than the current capability surface
- the user asks for open-ended analytical correlation not covered deterministically
- the query requires flexible schema exploration or MongoQL-style retrieval logic

### Important nuance

The fallback should be a **fallback**, not the default.

Do **not** accidentally rebuild the old “everything goes through LLM first” anti-pattern.

The right ordering is:

1. detect whether available MCP tools can satisfy the request
2. use tools first when possible
3. only escalate to the migrated PhoenixAI path when tool coverage is insufficient

---

## 11. Recommended routing behavior for the future assistant

The next agent should design the routing with something like this logic:

### Step 1: intent + coverage check
- inspect the user request
- map it against the Skylark capability contract
- determine whether one or more MCP tools can satisfy it

### Step 2: identifier resolution
- prefer friendly org / vessel identifiers
- resolve org and vessel scope cleanly
- preserve the current identifier normalization behavior

### Step 3: deterministic execution path
- if the capability is covered, call the relevant tool(s)
- compose multiple tool results if necessary

### Step 4: sufficiency decision
- ask: did the tool result fully satisfy the question?
- if yes, synthesize the answer from tool outputs
- if no, escalate to the migrated PhoenixAI path

### Step 5: PhoenixAI fallback path inside this project
- run ambiguity resolution / retrieval / query generation only when needed
- keep the fallback bounded and purposeful
- preserve provenance so callers can tell which path answered

### Step 6: response synthesis
- provide final answer
- ideally preserve provenance, e.g. whether answer came from:
  - MCP tool(s)
  - migrated PhoenixAI fallback
  - a hybrid combination

---

## 12. Concrete PhoenixAI migration inventory

This is the main correction the earlier version was missing.

### A. Must move or deliberately re-implement inside this project

#### 1. Backend runtime / route mounting

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/server.js`
- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix-openai-response.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/response-stream.js`

What matters:
- Express startup and middleware shape
- route mounting for query, disambiguation, conversations, auth, and cloud proxy paths
- streaming and non-streaming route behavior
- Mongo startup wiring

Important note:
- static FE serving in `server.js` must be treated carefully because `FE_TSX` is explicitly **not** being copied.

#### 2. Core orchestration / query-generation runtime

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix-openai-response.service.js`

What matters:
- `processUserQuery(...)`
- `continueWithDisambiguation(...)`
- `processUserQueryStream(...)`
- `processDisambiguationStream(...)`
- `detectDualViewOpportunity(...)`
- prompt loading
- retrieval orchestration
- streaming behavior
- GridFS result persistence
- model/env selection

This file is a major migration surface, not a minor helper.

#### 3. Prompt system and schema-grounding assets

Source files:
- `../AgentsAndMCPs/PhoenixAI/prompts.ts`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/prompts-loader.js`
- `../AgentsAndMCPs/PhoenixAI/seed/pms_collections_vector_schema.json`
- `../AgentsAndMCPs/PhoenixAI/seed/` (broader seed set, including mapping rules)

What matters:
- the prompt system is central and large
- prompt loading currently uses dynamic execution / `vm`
- the prompt system depends on schema seed data
- the migration is incomplete if only service code is copied without prompt/seed/runtime loader glue

#### 4. Retrieval and Qdrant indexing/tooling

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/services/retrieve.service.js`
- `../AgentsAndMCPs/PhoenixAI/indexer_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/indexer_collections_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/retrieve_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/package.json`
- `../AgentsAndMCPs/PhoenixAI/qdrant_vectordb/` (operational/deployment relevance)

What matters:
- Qdrant vs Mongo Atlas retrieval behavior
- root-level indexing scripts and startup assumptions
- root-level package scripts such as:
  - `index:qdrant`
  - `index:collections:qdrant`
  - `retrieve:qdrant`
  - `retrieve:collections:qdrant`
- seed-driven index building

Important note:
- this confirms the migration is broader than `BE/`; root-level PhoenixAI runtime/indexing assets matter too.

#### 5. Persistence / Mongo / GridFS runtime

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/services/conversation.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/mongodb.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/gridfs.util.js`

What matters:
- conversation lifecycle
- lazy GridFS rehydration
- large result persistence
- Mongo startup and connection reuse

#### 6. Sign-in / auth / session bridge

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/routes/auth.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/session.store.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/keepalive.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/middleware/tenant.guard.js`

What matters:
- captcha/login/check/logout proxy behavior
- `ai_session` cookie handling
- mapping of assistant session → Phoenix Cloud cookie/user/org metadata
- keepalive behavior to prevent session expiry
- tenant/path guard behavior if tenant-prefixed routes are preserved

This is part of the migration scope. The user explicitly called out **signin stuff**.

#### 7. Frontend requirements that still need to be preserved in assistant-ui

Source files:
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/locales/en.json`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/locales/ja.json`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/locales/zh.json`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/locales/ko.json`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/utils/i18n.ts`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/app/SignIn.tsx`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/components/CaptchaWidget.tsx`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/services/auth.service.ts`
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/app/RootApp.tsx`

What matters:
- the future assistant-ui frontend must preserve **4-language support** for:
  - English (`en`)
  - Japanese (`ja`)
  - Chinese (`zh`)
  - Korean (`ko`)
- the current FE uses `i18next` with a persisted `localStorage` language preference; that requirement should survive in the new frontend
- the current top-level toggle appears to flip only `ja ↔ en` in one place, but the actual locale resource set is 4-language; the new frontend should expose all 4 cleanly
- the new frontend must include a real **sign-in page**, not just assume ambient auth
- the sign-in flow currently depends on:
  - `/auth/captcha/generate`
  - `/auth/captcha/refresh`
  - `/auth/login`
  - `/auth/check`
  - `/auth/logout`
- auth is cookie/session based (`withCredentials`) and should be preserved or intentionally replaced with a documented equivalent
- the existing sign-in UX pattern is:
  - email + password + CAPTCHA
  - auth check gate before entering the main app
  - clear error handling and CAPTCHA refresh on failure
  - a mobile-friendly centered card layout with soft branded visual treatment

Important note:
- do **not** transplant all of FE_TSX
- do preserve/adapt these specific locale and sign-in requirements in the assistant-ui product shell

#### 8. Cloud-proxy and direct DB helper routes

Source files:
- `../AgentsAndMCPs/PhoenixAI/BE/routes/cloud-proxy.route.js`

What matters:
- forms/document/AWH/inventory proxy helpers
- direct Mongo reads where PhoenixCloudBE routes do not exist

This should be moved or adapted **if** the consolidated assistant experience still depends on these helper routes.

#### 9. Dependency and script surface

Source files:
- `../AgentsAndMCPs/PhoenixAI/package.json`
- `../AgentsAndMCPs/PhoenixAI/BE/package.json`

What matters:
- root runtime/indexing dependencies
- BE runtime dependencies
- TypeScript/ts-node/Qdrant/OpenAI/LangChain dependencies

Important migration note:
- when this is implemented, use the project’s package manager to add/merge dependencies; do **not** hand-edit dependency manifests casually.

### B. Move only if parity is still required

These are real PhoenixAI files, but they may be optional depending on whether the consolidated project keeps legacy behavior:

- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/langchain.service.js`

Interpretation:
- the preferred path appears to be the OpenAI-response route/service
- legacy LangChain pieces should be brought over only if there is a concrete parity need

### C. Explicitly do **not** move as-is

#### Do not copy wholesale:
- `../AgentsAndMCPs/PhoenixAI/FE_TSX/`

#### Do not preserve blindly:
- FE build → copy into `BE/public` deployment flow
- assumptions that the app must remain a standalone PhoenixAI service on port `3001`
- nginx path assumptions such as `/phoenixai/`
- PM2 naming assumptions such as `phoenixai`

The user was explicit: **`FE_TSX` will not be copied wholesale as the new frontend.**

However, the next agent should still preserve and adapt the FE_TSX pieces that are now explicitly required:
- 4-language support (`en`, `ja`, `zh`, `ko`)
- the sign-in/auth UX contract represented by `SignIn.tsx`, `CaptchaWidget.tsx`, `auth.service.ts`, and `RootApp.tsx`

---

## 13. Deployment adaptation notes for the consolidated project

This also needed to be made explicit.

### What PhoenixAI deployment currently assumes

The current PhoenixAI deployment docs/scripts assume:
- a standalone PhoenixAI deployment
- `FE_TSX` is built and copied into `BE/public`
- the backend runs on port `3001`
- nginx proxies `/phoenixai/` to that backend
- PM2 process naming is PhoenixAI-specific

Relevant source files:
- `../AgentsAndMCPs/PhoenixAI/deploy-all.sh`
- `../AgentsAndMCPs/PhoenixAI/deploy-to-azure.sh`
- `../AgentsAndMCPs/PhoenixAI/nginx-phoenixai-location.conf`
- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT.md`
- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT_SUMMARY.md`

### What needs to happen instead

The next agent should create an equivalent deployment story for **this consolidated project**, not clone PhoenixAI deployment literally.

That adapted deployment should package or account for:
- the backend runtime that exists here already
- migrated PhoenixAI routes/services/utils/middleware/models as needed
- prompts and seed assets
- Qdrant/indexing scripts and any startup or operational hooks they require
- auth/sign-in/session pieces
- whichever frontend is actually used here (`assistant-ui` later, not `FE_TSX`)

### Deployment cautions

1. **Do not leave deployment logic FE_TSX-dependent.**
2. **Do not assume PhoenixAI’s old port/path/process naming survives unchanged.**
3. **Do not forget Qdrant operational needs** just because they live outside `BE/` today.
4. **Do not forget prompt/seed files** when packaging.
5. **Do not forget auth/session env needs** when adapting the runtime.

### Concrete destination-by-destination migration plan inside this repo

The next agent should not treat “migrate PhoenixAI” as “copy a whole service into one folder.”

The cleaner destination plan is:

- keep **MCP transport/proxy** code in `backend/src/mcp/`
- create a new **hybrid/orchestration seam** in `backend/src/hybrid/`
- place the migrated **PhoenixAI runtime** under `backend/src/phoenixai/`
- place non-code **seed/schema assets** under `backend/resources/phoenixai/`
- place **Qdrant/index/retrieval scripts** under `backend/scripts/phoenixai/`
- place adapted **deployment shell/nginx helpers** under repo-root `scripts/deploy/`

That keeps the deterministic MCP surface, hybrid routing, migrated PhoenixAI runtime, static assets, and deployment artifacts separated cleanly.

#### A. Repo-native integration seam to create first

These files do not exist in PhoenixAI as-is, but the next agent should create them as the receiving layer for the migration:

- `backend/src/hybrid/route-to-tool-or-fallback.ts`
  - explicit tool-first vs fallback routing decision
- `backend/src/hybrid/capability-coverage.ts`
  - answers “can MCP satisfy this request deterministically?”
- `backend/src/hybrid/types.ts`
  - shared routing/result provenance types
- `backend/src/phoenixai/index.ts`
  - the PhoenixAI module entrypoint for this repo
- `backend/src/phoenixai/config.ts`
  - centralize PhoenixAI env/config lookups instead of scattering them across services

Important boundary:
- `backend/src/mcp/` should remain the MCP surface
- `backend/src/hybrid/` should decide when to use MCP vs PhoenixAI runtime
- `backend/src/phoenixai/` should contain the migrated fallback runtime itself

#### B. Source-to-destination map for runtime wiring

- `../AgentsAndMCPs/PhoenixAI/BE/server.js`
  - **do not copy as a standalone server**
  - split its responsibilities across:
    - `backend/src/index.ts` for top-level Express wiring only
    - `backend/src/phoenixai/index.ts` for module bootstrapping / route registration
    - `backend/src/phoenixai/routes/` for actual route modules

- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix-openai-response.route.js`
  - destination: `backend/src/phoenixai/routes/phoenix-openai-response.route.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/utils/response-stream.js`
  - destination: `backend/src/phoenixai/utils/response-stream.ts`

Recommended mounting pattern from `backend/src/index.ts`:
- keep current MCP mounts intact
- mount the migrated PhoenixAI router tree separately
- do **not** bury PhoenixAI routes directly inside `backend/src/mcp/`

#### C. Source-to-destination map for core PhoenixAI services

- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix-openai-response.service.js`
  - destination: `backend/src/phoenixai/services/phoenix-openai-response.service.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/services/retrieve.service.js`
  - destination: `backend/src/phoenixai/services/retrieve.service.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/services/conversation.service.js`
  - destination: `backend/src/phoenixai/services/conversation.service.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/services/mongodb.service.js`
  - destination: `backend/src/phoenixai/services/mongodb.service.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/utils/gridfs.util.js`
  - destination: `backend/src/phoenixai/utils/gridfs.util.ts`

Recommended service grouping inside `backend/src/phoenixai/`:
- `routes/` for HTTP entrypoints
- `services/` for orchestration/retrieval/persistence
- `utils/` for SSE/GridFS/prompt-loader helpers
- `middleware/` only for PhoenixAI-specific guards

#### D. Source-to-destination map for auth/session bridge

- `../AgentsAndMCPs/PhoenixAI/BE/routes/auth.route.js`
  - destination: `backend/src/phoenixai/routes/auth.route.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/services/session.store.js`
  - destination: `backend/src/phoenixai/services/session.store.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/services/keepalive.service.js`
  - destination: `backend/src/phoenixai/services/keepalive.service.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/middleware/tenant.guard.js`
  - destination: `backend/src/phoenixai/middleware/tenant.guard.ts`

Important note:
- keep the PhoenixAI sign-in/session bridge isolated from existing MCP auth logic as much as possible
- do not blend this immediately into unrelated shared middleware

#### E. Source-to-destination map for cloud-proxy helpers

- `../AgentsAndMCPs/PhoenixAI/BE/routes/cloud-proxy.route.js`
  - destination: `backend/src/phoenixai/routes/cloud-proxy.route.ts`

Recommendation:
- migrate this route only if the consolidated assistant experience still needs these helper endpoints
- if some parts are still required but others are not, split them into focused files under:
  - `backend/src/phoenixai/routes/cloud-proxy/`

#### F. Source-to-destination map for prompts and seed assets

- `../AgentsAndMCPs/PhoenixAI/prompts.ts`
  - destination: `backend/src/phoenixai/prompts/prompts.ts`

- `../AgentsAndMCPs/PhoenixAI/BE/utils/prompts-loader.js`
  - destination: `backend/src/phoenixai/prompts/prompts-loader.ts`

- `../AgentsAndMCPs/PhoenixAI/seed/pms_collections_vector_schema.json`
  - destination: `backend/resources/phoenixai/seed/pms_collections_vector_schema.json`

- `../AgentsAndMCPs/PhoenixAI/seed/mapping_rules_revised.json`
  - destination: `backend/resources/phoenixai/seed/mapping_rules_revised.json`

- broader `../AgentsAndMCPs/PhoenixAI/seed/` assets
  - destination: `backend/resources/phoenixai/seed/`

Reason for splitting code vs assets:
- prompt code belongs with runtime code in `src/`
- JSON/schema seed assets are easier to package reliably if they live under a dedicated runtime-resources folder

#### G. Source-to-destination map for Qdrant/index/retrieval scripts

- `../AgentsAndMCPs/PhoenixAI/indexer_qdrant.ts`
  - destination: `backend/scripts/phoenixai/indexer_qdrant.ts`

- `../AgentsAndMCPs/PhoenixAI/indexer_collections_qdrant.ts`
  - destination: `backend/scripts/phoenixai/indexer_collections_qdrant.ts`

- `../AgentsAndMCPs/PhoenixAI/retrieve_qdrant.ts`
  - destination: `backend/scripts/phoenixai/retrieve_qdrant.ts`

- `../AgentsAndMCPs/PhoenixAI/qdrant_vectordb/`
  - do **not** treat this as app source code
  - document it under deployment/ops notes and only preserve what is still operationally relevant

Recommended script policy:
- Qdrant/index scripts should stay outside `backend/src/`
- they should be invoked from `backend/package.json` scripts after dependency merge
- they should load seed assets from `backend/resources/phoenixai/seed/`

#### H. Source-to-destination map for dependency and package-script merge

- `../AgentsAndMCPs/PhoenixAI/package.json`
- `../AgentsAndMCPs/PhoenixAI/BE/package.json`
  - **do not copy these as parallel package manifests**
  - merge required dependencies into `backend/package.json` via the package manager
  - add new backend script entries there for:
    - PhoenixAI runtime/dev tasks if needed
    - Qdrant indexing scripts
    - retrieval smoke/debug scripts

Important note:
- the consolidated backend should have **one** package/dependency surface in `backend/package.json`, not a nested PhoenixAI app with its own independent manifest

#### I. Source-to-destination map for deployment assets

- `../AgentsAndMCPs/PhoenixAI/deploy-all.sh`
  - destination concept: `scripts/deploy/deploy-consolidated-backend.sh`

- `../AgentsAndMCPs/PhoenixAI/deploy-to-azure.sh`
  - destination concept: `scripts/deploy/deploy-consolidated-backend-azure.sh`

- `../AgentsAndMCPs/PhoenixAI/nginx-phoenixai-location.conf`
  - destination concept: `scripts/deploy/nginx-consolidated-backend-location.conf`

- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT.md`
- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT_SUMMARY.md`
  - destination concept: fold relevant operational notes into this repo’s handover/deployment docs

Important note:
- the next agent should adapt these into a deployment story for the consolidated backend and future `assistant-ui`
- do **not** preserve the old FE build-copy flow to `BE/public`

#### J. Areas that should explicitly remain where they are

- `backend/src/mcp/`
  - keep as the MCP transport/proxy/capability surface

- `backend/src/index.ts`
  - keep as the backend’s top-level server bootstrap
  - do not let it become a copy of PhoenixAI `server.js`

- repo root handover/docs
  - keep migration strategy, deployment caveats, and cutover notes at repo root

#### K. Final target tree the next agent should aim for conceptually

- `backend/src/index.ts`
- `backend/src/mcp/...`
- `backend/src/hybrid/...`
- `backend/src/phoenixai/routes/...`
- `backend/src/phoenixai/services/...`
- `backend/src/phoenixai/utils/...`
- `backend/src/phoenixai/middleware/...`
- `backend/src/phoenixai/prompts/...`
- `backend/src/phoenixai/config.ts`
- `backend/resources/phoenixai/seed/...`
- `backend/scripts/phoenixai/...`
- `scripts/deploy/...`

If the next agent follows that structure, the result should be a genuinely consolidated backend rather than a confusing partial service transplant.

---

## 14. Strong guardrails the next agent must preserve

### Guardrail 1: Keep the architecture split clean

- **PhoenixCloudBE** remains deterministic business execution
- the **migrated PhoenixAI runtime inside this project** remains the LLM/retrieval/query-generation path
- this project becomes the unifying orchestration/backend shell

This is a single-project consolidation goal, but it is **not** a license to blur deterministic and non-deterministic responsibilities.

### Guardrail 2: Do not reintroduce risky result truncation by default

Current preference is:
- full tool payloads
- minified JSON is fine
- avoid semantic minimization unless behind an explicit flag and clearly justified

### Guardrail 3: Do not broad-brush auth changes

Especially around MCP org resolution.

Remember the Fleetships fix:
- route-local
- narrow
- intentional

### Guardrail 4: Prefer friendly identifiers in UX/orchestration

The user likes direct naming such as:
- `fleetships`
- organization name
- vessel name

The system should keep supporting those naturally.

### Guardrail 5: Do not preserve PhoenixAI as a permanent parallel service if the goal is one project

The migration target is consolidation here.

Temporary migration stages may exist during implementation, but the architecture note should not drift back into “just keep both forever.”

### Guardrail 6: `FE_TSX` is not the new frontend, but key FE requirements are in scope

Do not waste migration time trying to port **all** of `FE_TSX`.

Do preserve the frontend requirements the user explicitly wants carried into the assistant-ui build:
- 4-language localization support (`en`, `ja`, `zh`, `ko`)
- the sign-in/auth/session UX behavior

### Guardrail 7: Deployment scripts must be adapted, not copied blindly

Especially avoid inheriting:
- FE copy-to-public assumptions
- stale port/path/process naming
- PhoenixAI-only packaging assumptions

### Guardrail 8: Deterministic answers should stay deterministic

Do not hide precise MCP results behind unnecessary summarization when a tool already answers the question directly.

---

## 15. What the next agent should build next

Recommended order of work:

### Phase 1 — Create a clear consolidation area in this backend

Add a clear place for hybrid/orchestration/migrated-PhoenixAI concerns, likely something like:

- `backend/src/ai/`
- `backend/src/assistant/`
- `backend/src/hybrid/`
- or another clearly named backend area

The exact folder name matters less than clarity.

The goal is to avoid stuffing all migrated logic into the existing MCP proxy files.

Use the destination map in **Section 13** as the default landing plan unless a specific file proves it must go elsewhere.

### Phase 2 — Define the hybrid decision boundary

Create a small, explicit routing abstraction such as:

- `routeToToolOrFallback(...)`
- `determineExecutionMode(...)`
- `isCoveredByMcpCapabilities(...)`

Do not bury this logic ad hoc in controllers.

### Phase 3 — Transplant the PhoenixAI runtime essentials

Bring over, in a controlled modular way:
- query/disambiguation routes
- orchestration service
- prompt loader + prompt definitions
- retrieval service
- conversation + Mongo + GridFS helpers
- streaming helpers

### Phase 4 — Transplant auth/sign-in/session and any required cloud-proxy helpers

Bring over or adapt:
- auth route
- session store
- keepalive logic
- tenant guard if required
- cloud-proxy helpers if the new experience depends on them

### Phase 5 — Transplant root-level Qdrant/indexing assets

Bring over or re-home:
- seed assets
- indexer scripts
- retrieval scripts
- startup/documentation for index lifecycle

### Phase 6 — Adapt deployment/startup for the consolidated app

Create the replacement deployment story here:
- no wholesale `FE_TSX` transplant
- package prompts/seed/runtime properly
- include auth/session/env requirements
- include Qdrant/index operational notes

### Phase 7 — Add the user-owned assistant layer

Use Mastra AI SDK as the orchestration layer that:
- chooses the model
- chooses whether to call tools
- decides whether to escalate to fallback
- returns structured results to assistant-ui

### Phase 8 — assistant-ui frontend

assistant-ui should become the user-facing layer that:
- displays conversation
- shows tool usage / provenance if desired
- allows full ownership of the assistant experience

---

## 16. Files the next agent should inspect first

### In this project
- `backend/src/index.ts`
- `backend/src/mcp/server.ts`
- `backend/src/mcp/proxy.ts`
- `backend/src/mcp/capabilities/contract.ts`

### In PhoenixCloudBE
- `PhoenixCloudBE/routes/mcp.route.js`
- `PhoenixCloudBE/controllers/mcp.controller.js`
- `PhoenixCloudBE/services/mcp.service.js`
- `PhoenixCloudBE/constants/mcp.capabilities.contract.js`
- `PhoenixCloudBE/MCP_API_IMPLEMENTATION_TRACKER.md`

### In PhoenixAI migration source
- `../AgentsAndMCPs/PhoenixAI/package.json`
- `../AgentsAndMCPs/PhoenixAI/BE/package.json`
- `../AgentsAndMCPs/PhoenixAI/BE/server.js`
- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix-openai-response.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/routes/auth.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/routes/cloud-proxy.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix-openai-response.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/retrieve.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/conversation.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/session.store.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/keepalive.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/mongodb.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/prompts-loader.js`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/gridfs.util.js`
- `../AgentsAndMCPs/PhoenixAI/BE/utils/response-stream.js`
- `../AgentsAndMCPs/PhoenixAI/prompts.ts`
- `../AgentsAndMCPs/PhoenixAI/seed/`
- `../AgentsAndMCPs/PhoenixAI/indexer_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/indexer_collections_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/retrieve_qdrant.ts`
- `../AgentsAndMCPs/PhoenixAI/deploy-all.sh`
- `../AgentsAndMCPs/PhoenixAI/deploy-to-azure.sh`
- `../AgentsAndMCPs/PhoenixAI/nginx-phoenixai-location.conf`
- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT.md`
- `../AgentsAndMCPs/PhoenixAI/readmes/DEPLOYMENT_SUMMARY.md`

### Optional legacy PhoenixAI files if parity demands it later
- `../AgentsAndMCPs/PhoenixAI/BE/routes/phoenix.route.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/phoenix.service.js`
- `../AgentsAndMCPs/PhoenixAI/BE/services/langchain.service.js`

---

## 17. What was changed recently and is important to retain

### In Skylark
- MCP server supports both streamable HTTP and legacy SSE compatibility
- tool names are sanitized for client compatibility
- proxy returns full result data as minified JSON
- rich identifier-aware tool descriptions are preserved

### In PhoenixCloudBE
- missing deterministic MCP methods were added earlier
- maintenance drill-down endpoints were added earlier
- route-local org short-name auth issue was fixed narrowly

### In the overall strategy
- risky tool-result minimization was intentionally backed out
- the user now prefers cost control through **owning the assistant model**, not by degrading deterministic data
- the architecture direction is now explicitly **single-project consolidation**, not “run PhoenixAI alongside forever”

---

## 18. What not to waste time on next

Avoid these traps:

1. **Do not spend the next session re-investigating whether Skylark’s `.env` model is the main current cost lever**.
   - It is not the main lever in the active MCP proxy path.

2. **Do not broaden shared auth middleware just because route-local logic looks inelegant**.
   - The narrow fix was deliberate.

3. **Do not add automatic LLM summarization inside Skylark by default**.
   - That weakens determinism and adds another LLM hop.

4. **Do not collapse everything into PhoenixAI-first orchestration**.
   - The whole point is deterministic tools first.

5. **Do not assume old root handover files describe this architecture**.

6. **Do not plan around keeping PhoenixAI as a forever-separate service if the task is consolidation here**.

7. **Do not migrate `FE_TSX` wholesale or let deployment work get stuck on FE_TSX assumptions; only preserve the required locale/sign-in behavior**.

---

## 19. Immediate next-step checklist for the next agent

If picking up from here, the next agent should likely do this:

1. Read the Skylark MCP files listed above.
2. Read the PhoenixCloudBE MCP tracker and MCP route/service files.
3. Read the PhoenixAI migration-source files listed above.
4. Write a concrete destination map inside this repo for:
   - migrated routes
   - migrated services
   - prompts / seed assets
   - auth / session pieces
   - indexing / retrieval scripts
   - use the destination plan in **Section 13** as the starting default
5. Define the tool-first vs fallback routing abstraction.
6. Start scaffolding the consolidated backend area.
7. Plan the package-manager dependency merge required for the migrated runtime.
8. Draft the replacement deployment/startup story here, explicitly excluding a wholesale `FE_TSX` transplant while preserving the required locale/sign-in behavior.
9. Keep all auth and deterministic behavior conservative.

---

## 20. Bottom-line opinion for the next agent

The user’s proposed direction is sound.

The best version of it is:

- **assistant-ui** for FE
- **Mastra** for assistant orchestration
- **this project** as the single maintained backend shell
- **Skylark MCP** retained as the deterministic tool surface
- **PhoenixCloudBE** retained as deterministic business execution
- **PhoenixAI backend/runtime migrated into this project** for fallback / ambiguity / MongoQL logic
- **Tools first, MongoQL fallback second**
- **assistant-ui as the new frontend, while preserving FE_TSX’s required locale/sign-in behavior without transplanting the whole FE app**

That gives:
- lower cost through model choice control
- higher trust through deterministic answers first
- broader coverage through PhoenixAI fallback
- a cleaner long-term product architecture
- one maintained codebase for the assistant/backend side

If the next agent stays disciplined about those boundaries, this can become a much stronger system than either “pure tools only” or “pure LLM only.”

---

## 21. Mastra + assistant-ui + data-layer deep dive for the next agent

This section was added after a docs-level research pass on the official Mastra and assistant-ui materials.

The short version is:

- **Mastra** is the strongest fit for the orchestration/runtime layer
- **assistant-ui** is the strongest fit for the product chat shell
- **MongoDB** is the database technology choice for this product
- **`SkylarkDB`** is the MongoDB database name for this product
- inside **`SkylarkDB`**, keep a clear logical boundary between trusted business/domain collections and Mastra/assistant/system collections
- the target product is an **authenticated, mobile-responsive, agentic chat interface** where a user can log in from a phone and query the system safely

### A. What Mastra gives this architecture

Mastra is not just “an agent wrapper.” It is a TypeScript AI framework with the specific primitives this project needs:

- **agents** for open-ended reasoning with tools
- **workflows** for deterministic multi-step execution
- **memory** for message history, working memory, semantic recall, and observational memory
- **streaming** for responsive chat UX
- **structured output** for predictable UI rendering and typed downstream handling
- **request context** for user/session/org-aware execution
- **supervisor/subagent patterns** for decomposing higher-level tasks
- **observability/evals** for tracing agent behavior, tool calls, and quality over time

Important details confirmed from Mastra docs:

- agents can use tools, memory, streaming, and structured output
- agents can be composed with subagents and subworkflows
- workflows are the right primitive for known multi-step business sequences, not agents
- workflows support state, suspend/resume, restart, and streaming
- memory requires a storage adapter and Mastra supports databases including **MongoDB**
- semantic recall requires a vector DB + embeddings, which aligns with the already-identified PhoenixAI/Qdrant migration surface

### B. How Mastra should fit **this** repo

Mastra should be treated as the **assistant runtime/orchestration layer inside the consolidated backend**, not as a replacement for PhoenixCloudBE and not as a direct replacement for every existing PhoenixAI service.

Recommended role split:

- **assistant-ui** = frontend chat shell
- **Mastra** = orchestration/runtime layer exposed by this backend
- **`backend/src/hybrid/`** = tool-first vs fallback routing seam
- **`backend/src/mcp/`** = deterministic MCP transport/capability surface
- **`backend/src/phoenixai/`** = migrated ambiguity/retrieval/MongoQL fallback runtime
- **PhoenixCloudBE** = deterministic business execution and business truth access

Recommended Mastra responsibilities here:

1. receive authenticated chat requests from the future assistant-ui frontend
2. maintain request context for user/org/vessel/session/device state
3. decide whether the request is satisfied by deterministic MCP capabilities
4. call deterministic tools first whenever coverage exists
5. escalate to the migrated PhoenixAI fallback only when tool coverage is insufficient
6. return a streamed, provenance-aware response suitable for assistant-ui

Mastra workflows are especially appropriate for:

- capability coverage checks
- auth/session preflight steps
- tool composition with deterministic ordering
- guarded fallback escalation
- long-running or resumable multi-step jobs

Mastra agents are especially appropriate for:

- interpreting the user question
- deciding which tools to call
- synthesizing the final answer
- deciding when fallback reasoning is actually necessary

### C. What assistant-ui gives this architecture

assistant-ui is not the agent runtime; it is the **frontend chat/product toolkit**.

From the official docs, its architecture is built around:

- **frontend components**
- a **runtime/state layer**
- optional **Assistant Cloud** services

The most important fit for this project is the combination of:

- production-ready chat components
- streaming-friendly state management
- runtime adapters/integrations
- framework-agnostic backend connectivity
- UI primitives for tools, reasoning, attachments, thread lists, and message state

Capabilities surfaced in the docs that matter directly for this product:

- thread/message/chat shell components
- tool rendering and fallback tool UIs
- message branching/editing
- attachments
- context API / custom component hooks
- suggestions and generative UI patterns
- speech/dictation hooks
- reasoning / chain-of-thought presentation controls
- thread list support
- mobile-oriented React UX patterns

There is also explicit assistant-ui documentation for:

- overall architecture
- using your **own API endpoint**
- **Mastra runtime integration**
- both **full-stack** and **separate-server** Mastra integration patterns

### D. How assistant-ui should fit **this** product

For this project, assistant-ui should become the **future user-facing product shell** for the authenticated assistant experience.

That means:

- login/session-aware chat UI
- streaming responses
- thread history
- tool/provenance display when useful
- responsive composer/message layout for phone use
- room to expose attachments, clarifications, and follow-up actions later

Two explicit PhoenixAI FE carry-overs are now mandatory requirements for the future assistant-ui frontend:

1. **4-language support must be preserved**
   - use the same language set PhoenixAI FE_TSX already wires through `i18next`:
     - `en`
     - `ja`
     - `zh`
     - `ko`
   - preserve persisted client-side language preference behavior
   - do **not** ship an English-only or 2-language regression

2. **A real sign-in page must exist in the new system**
   - use `../AgentsAndMCPs/PhoenixAI/FE_TSX/src/app/SignIn.tsx` as the behavioral reference
   - it is acceptable to restyle it into assistant-ui’s visual system, or port it closely, but it must work reliably
   - the required auth behavior currently includes:
     - email/password entry
     - CAPTCHA generation/refresh
     - login error handling with CAPTCHA reset/refresh behavior
     - session check gating before entering the main app
     - logout support
     - cookie/session-aware requests (`withCredentials`)

Important nuance from the current FE_TSX codebase:
- the locale resource set is already 4-language
- one visible top-level toggle currently flips `ja ↔ en`, so the next frontend should improve that and expose all 4 supported languages cleanly

Most important architecture choice from assistant-ui docs:

- assistant-ui supports direct provider integration, your own API endpoint, or Assistant Cloud
- for **this** system, the right default is **your own API endpoint**, backed by the consolidated backend

That is the cleanest match for the current repo direction because:

1. the user wants one maintained backend
2. this repo already owns the MCP surface and future hybrid logic
3. PhoenixAI runtime is being migrated here rather than left as an external service
4. our auth/session/business-data rules are specific enough that we should not make assistant-ui cloud services the primary source of truth by default

### E. Full-stack vs separate-server guidance for the next agent

assistant-ui’s Mastra docs show two valid patterns:

- **Full-stack integration**: Mastra lives inside the same Next.js app API routes
- **Separate-server integration**: Mastra runs as a standalone server and the frontend points at it

For the current repo direction, the better default is closer to the **separate-server integration model**, even if both pieces are maintained in the same overall product/repo family.

Reason:

- this repo is already a backend-heavy system with existing Express/MCP/runtime responsibilities
- the consolidated backend needs to keep clear ownership of MCP, hybrid routing, PhoenixAI migration, auth/session, and deployment concerns
- that boundary is cleaner if assistant-ui acts as the frontend product shell and this backend exposes the assistant endpoints Mastra runs on

If a future frontend is created as a single Next.js application and the team intentionally wants one web-app runtime, then assistant-ui’s **full-stack** pattern is still viable.

But the next agent should **not assume** that “assistant-ui + Mastra” automatically means “put everything inside a Next.js frontend app.”

### F. Required database interpretation: MongoDB as platform, `SkylarkDB` as the product database

This must remain explicit.

- **MongoDB** is the database technology/platform choice.
- **`SkylarkDB`** is the name of the MongoDB database this product should use, just like the user has named databases for other products.
- the important boundary is **logical**, not a separate DB technology decision.

Inside `SkylarkDB`, keep clear boundaries between two kinds of collections/data ownership:

#### Trusted business/domain collections

These remain:

- the source of truth for the real operational data the assistant must query
- the collections that existing deterministic and fallback runtime code already understands
- the primary business context that Mastra-powered agents/workflows should consult through tools/retrieval/business services

#### Assistant/Mastra/system collections

These should hold things like:

- assistant thread metadata
- conversation/session continuity state
- Mastra memory state
- workflow/run/checkpoint metadata
- agent housekeeping records
- resumable execution state
- other assistant-system bookkeeping that should not be confused with domain truth

In other words:

> **`SkylarkDB` is the product MongoDB database. Inside it, keep a disciplined logical boundary between business/domain truth and assistant/system state.**

Very important guardrails:

- do **not** describe MongoDB and `SkylarkDB` as different database technologies
- do **not** blur business/domain collections with assistant/system collections
- do **not** let Mastra/system state become the new business source of truth
- do **not** scatter assistant runtime state arbitrarily through product collections without naming/ownership discipline

Mastra supporting MongoDB is useful here, but the correct interpretation is:

- MongoDB = the chosen database platform
- `SkylarkDB` = this product’s MongoDB database
- business vs assistant/system separation = a collection/data-ownership boundary inside `SkylarkDB`

### G. Product intent the next agent should optimize for

The target product is not just “a chat demo.”

It is:

- an **authenticated assistant**
- that is **100% mobile responsive**
- so a user can **log in from a phone**
- ask questions about the system
- get deterministic answers first where possible
- and still have fallback reasoning when the tool surface is insufficient

That implies a few practical UI/product constraints:

1. **mobile-first chat ergonomics matter**
   - composer must work well on narrow screens
   - thread navigation must collapse/expand cleanly
   - long tool outputs must degrade gracefully on phones

2. **streaming matters**
   - the interface should feel responsive even when tools or fallback logic take time

3. **session continuity matters**
   - a logged-in user should be able to resume context reliably

4. **provenance matters**
   - the system should be able to distinguish tool-first answers from fallback/hybrid answers

5. **FE_TSX is not the frontend to transplant, but some FE_TSX requirements are directly relevant**
   - the future frontend is assistant-ui-oriented
   - but 4-language support and the sign-in/auth UX must be preserved from PhoenixAI FE_TSX

assistant-ui is a strong base for this, but the next agent should remember:

> assistant-ui enables a mobile-responsive assistant UX; it does not remove the need for disciplined mobile-first implementation choices.

### H. Recommended end-state flow

The next agent should think in this shape:

**User on phone/web**  
→ **assistant-ui frontend**  
→ **authenticated chat endpoint on this consolidated backend**  
→ **Mastra agent/workflow runtime**  
→ **hybrid coverage decision**  
→ first try **Skylark MCP / PhoenixCloudBE deterministic tools**  
→ if insufficient, use **migrated PhoenixAI runtime inside this backend**  
→ read trusted business/domain collections in **MongoDB (`SkylarkDB`)** as needed  
→ persist Mastra context/threads/housekeeping in dedicated assistant/system collections inside **`SkylarkDB`**  
→ stream answer back to assistant-ui

### I. Practical cautions for the next agent

1. **Do not make Assistant Cloud the default system of record unless the team explicitly chooses that later.**
2. **Do not let Mastra bypass the tool-first rule.**
3. **Do not treat Mastra workflows as a reason to duplicate PhoenixCloudBE business logic.**
4. **Do not misdescribe MongoDB and `SkylarkDB` as separate DB technologies; keep the boundary logical inside the same product database.**
5. **Do not drift back toward a wholesale FE_TSX transplant; only preserve the explicitly required locale/sign-in/auth behavior in assistant-ui.**

If the next agent keeps these boundaries clean, Mastra + assistant-ui should strengthen the architecture instead of adding another layer of confusion.

---

## 22. Final state at handoff

At the moment of this handoff:

- Skylark MCP proxy behavior is conservative and stable
- full tool result data is preserved
- no risky truncation is active
- PhoenixCloudBE deterministic MCP surface remains the core business layer
- this document now reflects the corrected direction: **PhoenixAI backend/runtime is to be consolidated into this project, not left as a permanent sibling service**
- this document now also reflects the corrected framework/data/UI direction: **Mastra as orchestration/runtime, assistant-ui as the future chat shell, MongoDB as the database platform, `SkylarkDB` as the product MongoDB database, and explicit preservation of PhoenixAI FE’s 4-language + sign-in requirements**
- the migration surface has been analyzed deeply enough to identify:
  - runtime/routes
  - prompts/seed
  - retrieval/Qdrant/indexers/startup
  - conversation/GridFS/Mongo pieces
  - auth/sign-in/session pieces
  - deployment adaptation needs
  - the explicit rule that `FE_TSX` is not transplanted wholesale, while its required locale/sign-in behavior is preserved
- the next meaningful step is no longer just abstract architecture discussion; it is to begin the **controlled backend consolidation plan**

End of handover.