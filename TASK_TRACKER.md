## SkylarkAI Implementation Tracker

### Purpose
- Record implementation progress alongside `NEXT_AGENT_SKYLARK_MCP_HYBRID_HANDOVER_2026-03-11.md`.
- Give the next agent a reliable resume point with completed work, current state, and next steps.

### Current phase
- Active tranche: `Tranche 2A`.
- Goal: finish backend-only Phoenix parity and prove the real one-shot API path end-to-end before frontend work. The backend now uses Phoenix-style env/config, keeps Skylark persistence separate from the PhoenixCloudBE query DB, mounts `/api/phoenix-openai` publicly, and now also has startup/runtime observability plus live LLM stream proof in both the smoke-script terminal and the backend terminal. The latest streamed proof run showed one representative query still regressing with `MALFORMED_LLM_QUERY_JSON`, so frontend should remain blocked until that representative backend query is restored.

### Completed so far
#### 2026-03-11 — Planning + Tranche 1A start
- Re-validated the migration plan against the actual Skylark backend, PhoenixAI source, and PhoenixCloudBE seam.
- Confirmed architectural guardrails:
  - deterministic MCP remains untouched
  - Phoenix runtime lands later as an isolated fallback namespace
  - LangChain is tactical for retrieval/indexing only
  - `.env` remains the single source for URL/DB/vector/model config
- Installed approved backend dependencies:
  - `@langchain/openai`
  - `@langchain/mongodb`
  - `@langchain/core`
  - `@qdrant/js-client-rest`
  - `mongodb`
  - `mongoose`
  - `cookie-parser`
- Copied PhoenixAI seed assets into `backend/seed/`.
- Copied PhoenixAI indexer scripts into `backend/scripts/phoenixai/`.
- Added backend npm scripts for the copied indexers.
- Validation notes:
  - copied indexer scripts compile under targeted `tsc --noEmit --skipLibCheck ...`
  - existing MCP smoke test passes after starting the backend locally

#### 2026-03-11 — Tranche 1B scaffold
- Added the initial isolated Phoenix namespace under `backend/src/phoenixai/`.
- Added a route factory placeholder for the future `phoenix-openai-response` port.
- Added a runtime engine contract plus placeholder engine that throws explicit `not implemented yet` errors.
- Added retrieval/persistence namespace placeholders.
- Ported the Phoenix SSE helper into `backend/src/phoenixai/utils/response-stream.ts`.
- Validated the new scaffold files with targeted diagnostics and `tsc --noEmit`.

#### 2026-03-11 — Prompt source + compatibility loader
- Ported the Phoenix prompt source into `backend/src/phoenixai/prompts.ts`.
- Added a compatibility prompt loader in `backend/src/phoenixai/utils/prompts-loader.ts` so the migrated runtime can keep the old `loadPrompts()` / `getPrompt()` shape during the transition.
- Verified the prompt slice with targeted diagnostics.

#### 2026-03-11 — Persistence + route surface scaffold
- Expanded the Phoenix runtime contract to accept the request fields the source route/service expect:
  - `sessionData` on query input
  - `conversationId` and `responses` on disambiguation input
  - stream methods returning final payloads instead of `void`
- Added Phoenix persistence modules under `backend/src/phoenixai/persistence/`:
  - `mongodb.ts`
  - `gridfs.ts`
  - `conversations.ts`
- Ported the first usable conversation persistence layer:
  - Mongo connection reuse
  - GridFS JSON upload/download helpers
  - conversation create/update/list/get/pin/delete
  - `_id` → `conversationId` client mapping
  - lazy `resultsRef` rehydration
- Replaced the placeholder-only Phoenix router with a route surface that mirrors the source Phoenix router:
  - `/health`
  - `POST /query`
  - `GET /query/stream`
  - `POST /disambiguate`
  - `GET /disambiguate/stream`
  - `GET /conversations`
  - `GET /conversations/:id`
  - `PATCH /conversations/:id/pin`
  - `DELETE /conversations/:id`
- Kept the router unmounted and engine-seam based, per the migration guardrails.

#### 2026-03-11 — Strict TS cleanup + validation pass
- Fixed strict TypeScript issues introduced by the new persistence/route scaffold.
- Also cleaned previously-known repo-level strictness issues in:
  - `backend/scripts/phoenixai/indexer_qdrant.ts`
  - `backend/scripts/phoenixai/indexer_collections_qdrant.ts`
  - `backend/scripts/validate-mcp-smoke.ts`
- Validation results:
  - `npx tsc --noEmit --pretty false` now passes for the full backend
  - MCP smoke test passes after starting the backend locally

#### 2026-03-11 — Dual-view helper port
- Ported `detectDualViewOpportunity()` from the source Phoenix runtime into `backend/src/phoenixai/utils/dual-view.ts`.
- Wired on-read dual-view detection into `getConversationById()` so conversations can surface a dual-view toggle without waiting for the full runtime port.
- Added a focused unit test at `backend/src/phoenixai/utils/dual-view.test.ts`.
- Validation results:
  - targeted diagnostics clean
  - unit test passes via `node --import tsx --test src/phoenixai/utils/dual-view.test.ts`
  - repo-wide `tsc` remains clean

#### 2026-03-11 — Service adapter + runtime seam
- Extended the root `.gitignore` with additional MERN/local-dev artifacts (`backend/dist`, `frontend/dist`, `.turbo`, `.vercel`, `uploads`, `tmp`, `temp`, `*.local`, `.env.*`, etc.).
- Added a thin Phoenix service adapter at `backend/src/phoenixai/services/phoenix-openai-response.ts`.
- Preserved the important Phoenix route/service state-transition behaviors before the real executor port:
  - validate `userQuery` / `conversationId`
  - create the initial conversation in `processing`
  - mark the started conversation as `error` when executor calls fail
  - normalize and combine disambiguation responses
  - persist `disambiguationLog` on the original ambiguous conversation
  - link the resolved conversation back to the original with `relatedConversationId`
  - copy `resolvedQuery` back into the original conversation's `disambiguationLog`
- Added focused unit tests at `backend/src/phoenixai/services/phoenix-openai-response.test.ts`.
- Added `backend/src/phoenixai/runtime/service-engine.ts` as the next engine seam, backed by real persistence functions but still throwing explicit executor-not-ready errors for the actual query execution path.
- Validation results:
  - targeted diagnostics clean
  - `npx tsc --noEmit --pretty false` passes repo-wide
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts`

#### 2026-03-11 — Runtime executor prep slice
- Replaced the Phoenix retrieval placeholder in `backend/src/phoenixai/retrieval/index.ts` with the first real retrieval module:
  - `retrieveChunksGrouped(...)`
  - Qdrant and MongoDB Atlas vector retrieval paths
  - grouped output for `business_context`, `technical_structure_fields`, `domain_logic_rules`, and `mapping_rules`
  - `dedupByCanonical(...)`
  - `allowed_fields_whitelist` derivation from technical field hits
- Added `backend/src/phoenixai/runtime/executor.ts` as the first real executor behind the service seam.
- Ported Phoenix prep-path behavior into the executor:
  - keyword extraction using `KEYWORD_EXTRACTOR_SYSTEM_PROMPT`
  - RAG retrieval via `retrieveChunksGrouped(userQuery, extractedKeywords)`
  - intent candidate building from `rag.mapping_rules`
  - fallback intent selection using `simpleSelectIntentsFallback(...)`
  - target collection resolution from canonical docs or directly from Qdrant mapping rules
  - PMS collection schema loading from `backend/seed/pms_collections_vector_schema.json`
  - schema narrowing before ambiguity resolution
  - ambiguity handling using `AMBIGUITY_RESOLVER_SYSTEM_PROMPT`
  - direct OpenAI Responses API client with Phoenix model-selection defaults
- Preserved parity-oriented collection expansion behavior by resolving ambiguity keywords against the PMS-collections vector index as well.
- Wired `backend/src/phoenixai/runtime/service-engine.ts` to use `createPhoenixRuntimeExecutor(...)` for both non-streaming and streaming paths.
- Exported the new executor surface from `backend/src/phoenixai/runtime/index.ts`.
- Added focused executor tests in `backend/src/phoenixai/runtime/executor.test.ts` covering:
  - LLM JSON parsing
  - intent candidate and Qdrant collection resolution
  - schema narrowing
  - business-context dedup
  - ambiguous update path
  - prepared-state streaming path
- Current truthful runtime behavior after this slice:
  - ambiguous requests update the conversation to `status: ambiguous`
  - non-ambiguous requests update the conversation to `status: processing`
  - execution metadata marks the run as `stage: prepared` with `nextStep: query_generation_not_ported`
- Validation results:
  - targeted diagnostics clean on the touched executor/retrieval files
  - `npx tsc --noEmit --pretty false` passes repo-wide after the executor slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts`

#### 2026-03-11 — Runtime executor generation + execution slice
- Extended `backend/src/phoenixai/runtime/executor.ts` beyond prep-only behavior into the Phoenix one-shot completion path.
- Ported Phoenix query-generation behavior:
  - generation request now uses `QUERY_GENERATION_SYSTEM_PROMPT`
  - user payload follows Phoenix shape with `user_query`, `business_context_snippet`, and narrowed `collections`
  - generation JSON is parsed through `safeParseLLMJSON(...)`
- Added Phoenix-style pipeline sanitization and result cleanup helpers:
  - `sanitizePipeline(...)`
  - `stripGridFSKeys(...)`
  - `stripPrivateKeys(...)`
  - `cleanResultsForClient(...)`
- Added execution/persistence flow behind conservative seams:
  - execute Mongo aggregation with `allowDiskUse: true`
  - optional result enrichment seam (currently pass-through by default)
  - persist final cleaned results to GridFS as `resultsRef`
  - keep inline cleaned `results` in the returned service payload
- Added completed/error finalization behavior:
  - conversation updates now end in `completed` with `generatedQuery`, `resultsRef`, and completed `executionMetadata`
  - failures update the conversation to `error` while preserving `resolvedQuery`, `selectedIntents`, `generatedQuery`, and `targetCollections`
  - final metadata removes the old prep-only `nextStep` marker
- Added final stream completion behavior for the migrated executor path:
  - emit `status` updates through generation and execution
  - emit final `result`
  - emit final `end`
- Extended `backend/src/phoenixai/runtime/executor.test.ts` coverage for:
  - recursive pipeline sanitation
  - successful generation/execution/persistence completion
  - error finalization with generated-query metadata
  - final stream result/end emission
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/runtime/executor.ts` and `backend/src/phoenixai/runtime/executor.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after this slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts`

#### 2026-03-11 — Runtime executor retry correction + bounded enrichment slice
- Corrected `backend/src/phoenixai/runtime/executor.ts` retry behavior to match the current migration requirement:
  - retry once for any Mongo execution error
  - optional retry once on empty results via env parity:
    - `PHOENIX_RETRY_ON_EMPTY_RESULTS`
    - `PHX_RETRY_ON_EMPTY_RESULTS`
  - retry-aware stream `status` payloads for `generation` and `execute` include `messageKey` and `attempt`
  - final error metadata records `attempts`
- Added a Phoenix smoothness/status improvement:
  - emit `status.enriching_results` before post-execution enrichment runs
- Switched the default executor enrichment seam from pass-through to bounded real enrichment:
  - default executor wiring now uses `enrichHumanReadableResults`
  - preserves canonical ids in `sourceMeta.entities`
  - derives `sourceMeta.organizationID` where possible
  - replaces a bounded set of common ids with human-readable display values
  - infers `type` from the preserved entity metadata
  - remains non-fatal when enrichment fetches fail
- Extended `backend/src/phoenixai/runtime/executor.test.ts` coverage for:
  - generic Mongo execution retry/final metadata
  - retry recovery on second execution attempt
  - final malformed-query retry failure metadata
  - env-gated empty-result retry
  - bounded enrichment label replacement / canonical-id preservation / org derivation
  - non-fatal enrichment fallback
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/runtime/executor.ts` and `backend/src/phoenixai/runtime/executor.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the retry/enrichment slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts` (`17` passing)

#### 2026-03-11 — Phoenix route mounting-readiness validation slice
- Kept Phoenix routes unmounted, but tightened the route/service/runtime seam with focused route-contract tests.
- Made `backend/src/phoenixai/routes/phoenix-openai-response.ts` accept optional injected persistence dependencies so route tests can validate behavior without touching real Mongo state.
- Added focused route tests at `backend/src/phoenixai/routes/phoenix-openai-response.test.ts` covering:
  - readiness middleware invocation on mounted router requests
  - readiness-failure propagation through Express error handling
  - `POST /query` using the streaming executor when stream mode is enabled
  - fallback SSE emission for ambiguous `/query/stream` responses
  - `/disambiguate/stream` response parsing and SSE emission
  - conversations route compatibility for list/get/pin/delete behavior and stream flags
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/routes/phoenix-openai-response.ts` and `backend/src/phoenixai/routes/phoenix-openai-response.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the route slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts` (`22` passing)

#### 2026-03-11 — Read-time reopened-conversation parity slice
- Added bounded read-time parity behavior in `backend/src/phoenixai/persistence/conversations.ts` for reopened Phoenix conversations.
- Implemented read-time AWH repair behavior:
  - backfill FE-safe minimal `validatedForms`
  - burn in `awh_hasForms = false` when no forms exist
  - persist repaired results back through GridFS `resultsRef`
- Implemented read-time `DocumentMetadata` repair behavior:
  - backfill `sourceMeta.organizationID` from canonical `documentMetadataId`
  - infer `type = 'document'` when missing
- Kept the patch bounded to persistence/read behavior; deterministic MCP remains untouched and Phoenix routes remain unmounted.
- Added focused unit coverage in `backend/src/phoenixai/persistence/conversations.test.ts`.
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/persistence/conversations.ts` and `backend/src/phoenixai/persistence/conversations.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the read-time parity slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`25` passing)

#### 2026-03-11 — Runtime AWH validatedForms/template enrichment slice
- Extended `backend/src/phoenixai/runtime/executor.ts` so fresh one-shot runtime results can perform Phoenix-style `ActivityWorkHistory` form enrichment without touching routes or MCP.
- Added bounded runtime AWH repair/enrichment behavior:
  - collect `ActivityWorkHistory` ids from preserved `sourceMeta.entities.activityWorkHistoryId`
  - fetch `forms` by `activityWorkHistoryID`
  - backfill FE-safe minimal `validatedForms` when missing
  - burn in `awh_hasForms = false` when no forms exist for an AWH row
  - enrich matched validated forms with `_id`, `status`, `submittedAt`, `committedAt`, `sourceMeta.entities.formId`, and `sourceMeta.organizationID`
  - fetch `FormTemplate` docs and attach `templateSnapshot`
  - preserve canonical `formTemplateId` in `sourceMeta.entities` while surfacing template `name` in `formTemplateID`
- Kept the change bounded to the executor enrichment seam so deterministic MCP remains untouched and Phoenix routes remain unmounted.
- Extended `backend/src/phoenixai/runtime/executor.test.ts` coverage for:
  - runtime AWH `validatedForms` backfill + template enrichment
  - runtime `awh_hasForms = false` burn-in when no forms exist
  - updated bounded-enrichment expectation to reflect the new negative marker behavior
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/runtime/executor.ts` and `backend/src/phoenixai/runtime/executor.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the runtime AWH enrichment slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`27` passing)

#### 2026-03-11 — Runtime AWH auxiliary FE enrichment slice
- Extended `backend/src/phoenixai/runtime/executor.ts` so fresh one-shot runtime results also attach Phoenix-style auxiliary `ActivityWorkHistory` FE/display fields without touching routes or MCP.
- Added bounded runtime auxiliary enrichment behavior:
  - derive `awhToActivity` and `activityToMachinery` relationships from `ActivityWorkHistory` + `Activity`
  - fetch `ComponentActivity` links and `Component` docs to derive `component_ID`
  - fetch `Machinery` docs to derive `machinery_ID`
  - scan `ActivityWorkHistoryEvent` docs for attachment presence and burn in `awh_hasAttachments`
  - attach auxiliary FE fields for rows with direct `activityWorkHistory_ID` replacement
  - also attach the same FE fields for rows that only retain `sourceMeta.entities.activityWorkHistoryId`
- Kept the patch bounded to the executor enrichment seam so deterministic MCP remains untouched and Phoenix routes remain unmounted.
- Extended `backend/src/phoenixai/runtime/executor.test.ts` coverage for:
  - direct AWH auxiliary enrichment
  - sourceMeta-only AWH auxiliary enrichment
  - attachment-presence derivation
  - machinery/component label derivation alongside existing `awh_hasForms` behavior
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/runtime/executor.ts` and `backend/src/phoenixai/runtime/executor.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the runtime AWH auxiliary enrichment slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`28` passing)

#### 2026-03-11 — Read-time AWH auxiliary FE backfill slice
- Extended `backend/src/phoenixai/persistence/conversations.ts` so reopened `ActivityWorkHistory` conversations can regain Phoenix-style auxiliary FE/display fields on read without touching routes or MCP.
- Added bounded read-time AWH auxiliary backfill behavior:
  - detect reopened rows still carrying canonical `sourceMeta.entities.activityWorkHistoryId`
  - fetch `ActivityWorkHistory` + `Activity` relationships needed to derive machinery/component context
  - fetch `ComponentActivity`, `Component`, and `Machinery` docs to restore `component_ID` and `machinery_ID`
  - scan `ActivityWorkHistoryEvent` docs to burn in `awh_hasAttachments`
  - persist repaired results back through GridFS `resultsRef` using the existing read-time save-back path
- Kept the patch bounded to persistence/read behavior so deterministic MCP remains untouched and Phoenix routes remain unmounted.
- Added focused unit coverage in `backend/src/phoenixai/persistence/conversations.test.ts` for reopened AWH auxiliary FE backfill behavior.
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/persistence/conversations.ts` and `backend/src/phoenixai/persistence/conversations.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the read-time AWH auxiliary backfill slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`29` passing)

#### 2026-03-11 — Prepared executionMetadata cleanup slice
- Removed the stale temporary `nextStep: 'query_generation_not_ported'` marker from `backend/src/phoenixai/runtime/executor.ts` so the live prepared-stage backend metadata no longer advertises an outdated placeholder step.
- Simplified the prepared metadata flow so the same clean prepared metadata object now feeds:
  - the processing-stage conversation patch
  - completed execution metadata
  - error execution metadata
- Extended `backend/src/phoenixai/runtime/executor.test.ts` to assert the processing-stage `executionMetadata` shape directly, keeping the cleanup covered.
- Validation results:
  - targeted diagnostics clean on `backend/src/phoenixai/runtime/executor.ts` and `backend/src/phoenixai/runtime/executor.test.ts`
  - `npx tsc --noEmit --pretty false` passes repo-wide after the executionMetadata cleanup slice
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`29` passing)

#### 2026-03-11 — TypeScript build-output relocation slice
- Updated backend TypeScript emit settings so generated `.js`, `.d.ts`, and source-map artifacts now land under `backend/dist/` instead of beside source files.
- Added explicit backend package scripts for:
  - `build` via `tsconfig.build.json`
  - `typecheck` via `tsc --noEmit`
- Added `backend/tsconfig.build.json` so production emit excludes `src/**/*.test.ts` while the broader `tsconfig.json` still supports repo-local typechecking.
- Removed stale generated `.js`, `.d.ts`, `.js.map`, and `.d.ts.map` artifacts from `backend/src/` and `backend/scripts/` so `.ts` files remain the authoritative edit targets.
- Validation results:
  - `npm run build` passes and emits into `backend/dist/`
  - `npm run typecheck` passes after the config split
  - focused Phoenix tests pass via `node --import tsx --test src/phoenixai/services/phoenix-openai-response.test.ts src/phoenixai/utils/dual-view.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/persistence/conversations.test.ts` (`29` passing)
  - `find src scripts -type f \( -name '*.js' -o -name '*.d.ts' -o -name '*.js.map' -o -name '*.d.ts.map' \)` returns no source-adjacent emit artifacts
  - `find dist -type f \( -name '*.test.js' -o -name '*.test.d.ts' -o -name '*.test.js.map' -o -name '*.test.d.ts.map' \)` returns no emitted test artifacts

#### 2026-03-11 — Final backend parity + live smoke proof
- Aligned the active backend env/config surface with PhoenixAI requirements in `backend/.env` while preserving the required Mongo role split:
  - Skylark-owned persistence continues in `SkylarkDB`
  - generated Mongo queries run against the PhoenixCloudBE operational/query DB
- Completed the dual-Mongo persistence/runtime split in the backend Phoenix namespace:
  - Mongoose/GridFS/conversation persistence use the Skylark persistence DB
  - runtime query execution and read-time source backfills use the Phoenix query DB via native `MongoClient`
- Mounted the Phoenix route surface publicly from `backend/src/index.ts` under `/api/phoenix-openai` without touching deterministic MCP behavior.
- Added focused backend proof/coverage assets:
  - `backend/src/phoenixai/persistence/mongodb.test.ts`
  - `backend/scripts/phoenixai/query-smoke.mjs`
  - `backend/package.json` script: `npm run test:phoenix:api`
- Fixed the last confirmed executor parity gap in `backend/src/phoenixai/runtime/executor.ts`:
  - empty or sanitized-away generated queries no longer fall through as fake `completed` runs with `[]`
  - they now trigger the same retry/error path expected from PhoenixAI-style generation failures
- Extended `backend/src/phoenixai/runtime/executor.test.ts` coverage for:
  - regeneration after an empty generated query
  - final error metadata when generated queries remain empty across retry
- Validation results:
  - focused Phoenix slice passes via `node --import tsx --test src/phoenixai/persistence/mongodb.test.ts src/phoenixai/persistence/conversations.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/services/phoenix-openai-response.test.ts` (`32` passing)
  - `npm run typecheck`: passing
  - `npm run build`: passing
  - live backend boot via `npm start`: passing
  - real API smoke via `npm run test:phoenix:api`: passing
    - `show me all expired certificates` → `results` (`101` rows)
    - `show me all maintenance tasks due next month` → `results` (`101` rows)

#### 2026-03-11 — Startup observability + live streaming proof
- Added safe backend startup observability in `backend/src/index.ts` so boot now logs the effective runtime summary derived from `.env`, including:
  - stream/runtime flags
  - effective provider selection
  - model selection (`gpt-5.4` family + embed model)
  - masked OpenAI key
  - Skylark persistence Mongo target vs Phoenix query-source Mongo target
  - Qdrant/vector settings
  - Phoenix/MCP endpoint summary
- Extended `backend/src/phoenixai/runtime/executor.ts` to forward OpenAI Responses API stream events into Phoenix runtime `llm` events with stage context.
- Added focused unit coverage in `backend/src/phoenixai/runtime/executor.test.ts` proving `llm` events are forwarded for:
  - `keywords`
  - `ambiguity`
  - `generation` with attempt context
- Updated `backend/scripts/phoenixai/query-smoke.mjs` into an SSE streaming smoke consumer that now prints live:
  - `status`
  - `llm` start / delta / complete
  - final `result` / `disambiguation`
  - terminal `end`
  - explicit failure if no `llm` stream events are observed
- Added backend-side Phoenix stream logging in `backend/src/phoenixai/routes/phoenix-openai-response.ts` so the BE terminal now shows `[PhoenixStream]...` logs for streamed query/disambiguation events.
- Validation results:
  - `node --import tsx --test src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts`: passing (`23` passing)
  - `npm run typecheck`: passing
  - `npm run build`: passing
  - live backend boot via `npm start`: passing with startup config summary visible
  - live streaming proof via `npm run test:phoenix:api`: observability proof successful
    - smoke terminal showed live `status` and `llm` output proving the OpenAI path was hit
    - backend terminal showed live `[PhoenixStream][query][status|llm|result|end]` logs
    - `show me all expired certificates` → streamed `keywords`, `ambiguity`, `generation#1`, `generation#2`, then failed with `MALFORMED_LLM_QUERY_JSON`
    - `show me all maintenance tasks due next month` → streamed successfully and returned `results` (`101` rows)

### Files touched so far
- `.gitignore`
- `backend/.env`
- `backend/package.json`
- `backend/tsconfig.json`
- `backend/tsconfig.build.json`
- `backend/package-lock.json`
- `backend/seed/*`
- `backend/scripts/phoenixai/query-smoke.mjs`
- `backend/scripts/phoenixai/indexer_qdrant.ts`
- `backend/scripts/phoenixai/indexer_collections_qdrant.ts`
- `backend/src/index.ts`
- `backend/src/phoenixai/index.ts`
- `backend/src/phoenixai/routes/index.ts`
- `backend/src/phoenixai/routes/phoenix-openai-response.ts`
- `backend/src/phoenixai/routes/phoenix-openai-response.test.ts`
- `backend/src/phoenixai/runtime/index.ts`
- `backend/src/phoenixai/runtime/contracts.ts`
- `backend/src/phoenixai/runtime/placeholder-engine.ts`
- `backend/src/phoenixai/runtime/service-engine.ts`
- `backend/src/phoenixai/runtime/executor.ts`
- `backend/src/phoenixai/runtime/executor.test.ts`
- `backend/src/phoenixai/retrieval/index.ts`
- `backend/src/phoenixai/persistence/index.ts`
- `backend/src/phoenixai/persistence/mongodb.ts`
- `backend/src/phoenixai/persistence/mongodb.test.ts`
- `backend/src/phoenixai/persistence/gridfs.ts`
- `backend/src/phoenixai/persistence/conversations.ts`
- `backend/src/phoenixai/persistence/conversations.test.ts`
- `backend/src/phoenixai/services/index.ts`
- `backend/src/phoenixai/services/phoenix-openai-response.ts`
- `backend/src/phoenixai/services/phoenix-openai-response.test.ts`
- `backend/src/phoenixai/utils/index.ts`
- `backend/src/phoenixai/utils/response-stream.ts`
- `backend/src/phoenixai/utils/prompts-loader.ts`
- `backend/src/phoenixai/utils/dual-view.ts`
- `backend/src/phoenixai/utils/dual-view.test.ts`
- `backend/src/phoenixai/prompts.ts`
- `TASK_TRACKER.md`

### Validation status
- Dependency install: complete
- Static asset landing: complete
- Script wiring: complete
- Validation runs: complete for Tranche 1A
- Phoenix namespace scaffold validation: complete
- Prompt source / loader validation: complete
- Phoenix persistence + route scaffold validation: complete
- Phoenix service adapter + runtime seam validation: complete
- Phoenix runtime executor prep-slice validation: complete
- Phoenix runtime executor generation/execution validation: complete
- Phoenix runtime executor retry parity validation: complete
- Phoenix runtime executor bounded enrichment validation: complete
- Phoenix runtime executor stream smoothness parity validation: complete
- Phoenix route mount-readiness validation: complete
- Phoenix read-time reopened-conversation parity validation: complete
- Phoenix runtime AWH validatedForms/template enrichment validation: complete
- Phoenix runtime AWH auxiliary FE enrichment validation: complete
- Phoenix read-time AWH auxiliary FE backfill validation: complete
- Phoenix prepared executionMetadata cleanup validation: complete
- TypeScript build-output relocation validation: complete
- Phoenix env alignment validation: complete
- Phoenix dual-Mongo split validation: complete
- Phoenix live API smoke proof: passing on the earlier non-observability smoke run
- Phoenix startup/runtime observability proof: passing
- Phoenix live LLM streaming proof: passing in smoke terminal and backend terminal
- Backend build (`npm run build`): passing
- Repo-wide TypeScript (`npx tsc --noEmit --pretty false`): passing
- Backend typecheck (`npm run typecheck`): passing
- Phoenix Mongo split unit test: passing
- Phoenix service adapter unit test: passing
- Phoenix route contract unit test: passing
- Phoenix dual-view helper unit test: passing
- Phoenix runtime executor unit test: passing
- Phoenix conversation persistence unit test: passing
- Phoenix API smoke script: passing on the earlier representative-results run; latest streamed proof run is mixed (`expired certificates` currently fails with `MALFORMED_LLM_QUERY_JSON`, `maintenance due next month` passes)
- MCP smoke regression check: passing

### Next immediate steps
1. Investigate and fix the streamed-path regression on `show me all expired certificates`, which currently ends in `MALFORMED_LLM_QUERY_JSON` after generation retry.
2. Re-run `npm run test:phoenix:api` and confirm both representative backend queries succeed while preserving the new startup/stream observability proof.
3. Only after the representative backend proof is fully green again, begin the frontend `assistant-ui` + locale-translation baseline.
4. Preserve the current backend Phoenix seam and deterministic MCP isolation; defer Mastra until after the backend + frontend baseline remains stable.
5. Keep updating this tracker after each meaningful edit/validation cycle.

### Notes for the next agent
- The indexers were intentionally landed under `backend/scripts/phoenixai/` and seeds under `backend/seed/` so they can continue using `dotenv.config()` and `seed/...` relative paths with minimal change.
- Do not merge Phoenix runtime logic into `backend/src/mcp/`; keep deterministic MCP separate.
- The full backend TypeScript check is now clean; if it regresses, treat that as a real new issue instead of an inherited one.
- The Phoenix route surface is now mounted publicly at `/api/phoenix-openai`; keep future changes bounded to that namespace rather than blending them into MCP.
- The latest observability proof is complete: startup `.env` summary, smoke-terminal LLM streaming, and BE-terminal `[PhoenixStream]` logs are all working on current code.
- The main remaining backend risk is a representative streamed query regression: `show me all expired certificates` currently fails with `MALFORMED_LLM_QUERY_JSON`, while `show me all maintenance tasks due next month` still succeeds.
- Update this tracker after every meaningful tranche or validation run.

