## SkylarkAI Implementation Tracker

### Purpose
- This is the single canonical implementation tracker / handoff file for the current Phoenix migration + UI tranche.
- Give the next agent one reliable resume point with completed work, current state, proof, and next steps.

### Current phase
- Active tranche: `Frontend PhoenixAI visual-parity refinement completed and review-ready: the sign-in screen now follows the Phoenix-inspired centered-card treatment more closely, the authenticated assistant-ui workspace has been tightened toward the Phoenix shell/sidebar/thread/composer look, and the updated frontend has been re-validated cleanly for browser review`.
- Goal: backend-only Phoenix parity is now functionally closed for the current migration scope and has been re-proved end-to-end before frontend work. The backend uses Phoenix-style env/config, keeps Skylark persistence separate from the PhoenixCloudBE query DB, mounts `/api/phoenix-openai` publicly, shows startup/runtime observability, and provides live LLM stream proof in both the smoke-script terminal and the backend terminal. The former `MALFORMED_LLM_QUERY_JSON` blocker on `show me all expired certificates` has been resolved and the representative backend proof is now green again. All cross-repo continuation notes for the next UI tranche should now live in this file only.

### 2026-03-11 — PhoenixAI sign-in + assistant-ui workspace refinement completion pass
- Kept the Phoenix-parity boundary intact:
  - `assistant-ui` remains the active runtime/thread/composer implementation
  - no backend contract changes were introduced in this visual pass
  - no new frontend dependencies were added
- Completed the user-requested closer visual parity pass across the remaining frontend shell surfaces:
  - `frontend/src/app/SignIn.tsx`: centered Phoenix-style glass auth card preserved with the existing mock login + `731` verification flow
  - `frontend/src/app/AppShell.tsx`: header chrome flattened, bulky banner removed in favor of a thinner inline status strip, and the main workspace surface tightened
  - `frontend/src/components/sidebar/ConversationSidebar.tsx`: denser Phoenix-style sidebar sections, smaller controls, flatter list items, and a tighter signed-in user footer
  - `frontend/src/components/chat/ChatThread.tsx`: welcome state redesigned toward the Phoenix empty-state structure and message surfaces tightened
  - `frontend/src/components/chat/Composer.tsx`: composer/input/send CTA reduced to a more compact Phoenix-like bottom bar
- Validation results after the refinement pass:
  - `npm run build` ✅
  - `npm run lint` ✅

### 2026-03-11 — Planned frontend PhoenixAI visual-parity tranche (approved next step before further edits)
- User-requested visual target:
  - the current SkylarkAI frontend should reach much closer visual parity with the PhoenixAI UI reference
  - the sign-in screen should also adopt the same PhoenixAI-inspired visual language
  - match the PhoenixAI-style background treatment, typography feel, muted palette, panel translucency, spacing, and shell chrome as closely as practical
- Locked implementation boundary for this tranche:
  - keep `assistant-ui` as the active chat/thread/composer/runtime layer
  - do **not** transplant PhoenixAI orchestration, transport, or business-decision logic into SkylarkAI
  - do **not** change backend contracts for this visual tranche
  - preserve the current mocked/local auth + mocked/local chat transport while visuals are being finalized
- Exact plan of record before editing the UI:
  1. inspect the current SkylarkAI frontend styling surfaces (`providers`, global CSS, sign-in, shell, sidebar, thread, composer)
  2. inspect the PhoenixAI reference files that define the target look (`src/index.css`, `src/app/SignIn.tsx`, `src/components/new-ui/*`)
  3. port only the visual system into SkylarkAI:
     - global background gradient / blur treatment
     - theme tokens for typography, colors, radii, borders, and button/input states
     - sign-in card layout and styling
     - authenticated shell layout styling around the existing `assistant-ui` primitives
  4. keep all visible copy inside the existing i18n/locale system
  5. validate with the smallest safe checks first (`npm run build`, `npm run lint`), then keep the Vite app available for browser review
- File-level intent for the visual restyle:
  - `frontend/src/index.css`: PhoenixAI-like page background, scrollbar, and shared surface tokens
  - `frontend/src/app/providers.tsx`: global theme updates for font, palette, borders, papers, inputs, and buttons
  - `frontend/src/app/SignIn.tsx`: PhoenixAI-style sign-in card treatment and security-verification area
  - `frontend/src/app/AppShell.tsx`: header, shell spacing, glass surfaces, and overall authenticated layout polish
  - `frontend/src/components/sidebar/ConversationSidebar.tsx`: sidebar density, search, list-item styling, and bottom user panel
  - `frontend/src/components/chat/ChatThread.tsx`: welcome state, message bubble styling, and thread panel treatment
  - `frontend/src/components/chat/Composer.tsx`: PhoenixAI-like composer container, input styling, and send affordance
  - supporting locale/service files only if needed to truthfully support the sign-in/security UI
- Validation plan for this tranche:
  - confirm touched files compile/type-check via `npm run build`
  - confirm lint remains clean via `npm run lint`
  - keep the dev server running for browser refresh and screenshot comparison
  - if any visual state requires new mocked data (for example, welcome chips or security verification messaging), keep it bounded to frontend-only mock/state files
- Exit criteria for calling this tranche complete:
  - sign-in visually resembles the PhoenixAI auth screen instead of the current generic MUI card
  - authenticated shell reads as PhoenixAI-inspired in background, font, panel treatment, and color hierarchy
  - `assistant-ui` remains the active thread/composer implementation
  - build + lint pass after the restyle

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

#### 2026-03-11 — Final backend hygiene closeout + representative-proof restoration
- Performed a final hygiene pass over the migrated Phoenix backend implementation before any UI work.
- Closed the remaining backend hardening gaps in `backend/src/phoenixai/runtime/executor.ts` and related tests:
  - fixed final-response text assembly so finalized OpenAI output is joined naturally without injected newline spam
  - kept streaming output natural/character-progressive in the smoke path and backend terminal logs
  - hardened generated-pipeline sanitization recursively for nested values, including dynamic `$getField.field` cases that can surface in generated Mongo expressions
  - added a bounded malformed-JSON repair path to `safeParseLLMJSON(...)` so near-valid generated query JSON can be repaired conservatively before failing
  - kept the repair bounded by parse-error locality / search limits rather than broad unsafe normalization
- Closed the final hygiene/test gaps around the surrounding implementation:
  - made backend stream logging request-scoped so concurrent query streams do not cross-close each other's in-progress log lines
  - removed a stale unused executor helper left over from earlier migration steps
  - tightened the new regression test so it uses a deterministic malformed JSON mutation that exercises the repair path without weakening runtime behavior
- Validation results after the final hygiene pass:
  - focused Phoenix validation passes via `node --import tsx --test src/phoenixai/persistence/mongodb.test.ts src/phoenixai/persistence/conversations.test.ts src/phoenixai/runtime/executor.test.ts src/phoenixai/routes/phoenix-openai-response.test.ts src/phoenixai/services/phoenix-openai-response.test.ts` (`40` passing)
  - `npm run typecheck`: passing
  - `npm run build`: passing
  - fresh backend restart via `npm start`: passing with `.env` → effective runtime summary visible on boot
  - focused real smoke proof via `node scripts/phoenixai/query-smoke.mjs "show me all expired certificates"`: passing
    - outcome: `results`
    - result count: `101`
  - full representative smoke proof via `npm run test:phoenix:api`: passing
    - `show me all expired certificates` → `results` (`101` rows)
    - `show me all maintenance tasks due next month` → `results` (`101` rows)
  - backend terminal proof on fresh code: visible
    - startup `.env` / runtime summary
    - `[PhoenixStream][query][status]...`
    - `[PhoenixStream][query][llm]...`
    - `[PhoenixStream][query][result]...`
    - `[PhoenixStream][query][end]...`
- Backend readiness conclusion:
  - the previously blocking representative query regression is resolved
  - backend proof is now honest and green on fresh code
  - frontend / UI work is no longer blocked on this Phoenix backend migration slice

#### 2026-03-11 — Single-tracker consolidation + UI-first frontend planning baseline
- Per user direction, consolidated the cross-repo UI planning / handoff notes into this file so the next agent has one canonical resume point.
- Removed the misplaced UI-tranche planning section from `../PhoenixCloudBE/readmes/MCP_API_IMPLEMENTATION_TRACKER.md` so that file goes back to being PhoenixCloudBE-local MCP history only.
- Cross-repo backend state carried forward for the UI tranche:
  - PhoenixCloudBE MCP layer remains implemented, hardened, and build-validated
  - current validated PhoenixCloudBE MCP surface: `46` authenticated GET capabilities under `/api/mcp`
  - backend orchestration remains the source of truth for execution / persistence / tool-routing behavior
- Frontend reference baseline confirmed:
  - do **not** use the current PhoenixCloudBE frontend as the design/structure reference for this tranche
  - use `/home/phantom/testcodes/AgentsAndMCPs/PhoenixAI/FE_TSX/` as the frontend structure reference
  - mirror the proven PhoenixAI FE shape: `src/app`, shared providers, `src/utils/i18n.ts`, `locales/*.json`, `src/services/*`, `src/types/*`, `src/components/*`, and chat-shell work under `src/components/new-ui/*`
- `assistant-ui` role locked:
  - use `assistant-ui` as frontend scaffolding / UI primitives / runtime-adapter pattern similar to the AI SDK example
  - do **not** move orchestration or business decisioning into the frontend
  - backend decides MCP vs MongoQL, tool fallback behavior, execution sequencing, and persistence policy
- Target UI shape locked before backend wiring:
  - full Sign In -> authenticated shell -> Sign Out flow must be mapped first
  - desktop shell should include conversation/history sidebar, main thread surface, and bottom composer
  - mobile shell should use drawer/collapsible navigation with a chat-first layout
  - inline status, disambiguation, and structured results surfaces are part of the shell plan
  - language/profile/sign-out controls belong in the authenticated shell
- UI implementation order locked:
  1. define the full route / screen map from Sign In to Sign Out
  2. establish PhoenixAI-style FE structure (`app`, `providers`, `services`, `utils/i18n`, `types`, `components`)
  3. set up locale resources and translation strategy early
  4. introduce `assistant-ui` thread/chat primitives on mocked or local data first
  5. finalize responsive desktop/mobile states and look-and-feel
  6. only after UI map approval, wire to backend endpoints

#### 2026-03-11 — Detailed UI map draft (Sign In -> Sign Out)
- Confirmed implementation stance:
  - visual/layout reference = PhoenixAI FE shell + `assistant-ui` AI SDK example style
  - `assistant-ui` supplies chat/thread UI primitives and runtime scaffolding only
  - backend remains the source of truth for auth, orchestration, streaming, MCP-vs-MongoQL choice, fallback behavior, and persistence
  - do **not** add a frontend-owned model picker or frontend orchestration policy unless explicitly requested later
- Proposed frontend structure for the upcoming UI tranche:
  - `src/app/RootApp.tsx` = auth gate + bootstrap + session check
  - `src/app/providers.tsx` = shared providers (`QueryClientProvider`, i18n bootstrap, theme/app-level providers)
  - `src/app/SignIn.tsx` = unauthenticated screen
  - `src/app/AppShell.tsx` = authenticated shell wrapper
  - `src/components/chat/*` = assistant-ui thread/composer/result rendering layer
  - `src/components/sidebar/*` = conversation history / search / pin / delete / profile affordances
  - `src/services/*` = auth/session/conversation/api transport only
  - `src/utils/i18n.ts` + `locales/*.json` = translation bootstrap from day one
- Route / screen map:
  1. `boot/session-check`
     - app loads into a lightweight checking state while `authService.check()` resolves
     - no chat shell flashes before auth status is known
     - if session valid -> authenticated shell
     - if session invalid -> sign-in screen
  2. `sign-in`
     - centered branded auth card over a soft background, visually similar to PhoenixAI
     - fields: email, password, and any required security verification/captcha if backend requires it
     - language switcher available here as well, not only after login
     - states: idle, invalid form, submitting, auth error, captcha/security error, offline/server error
     - mobile: full-height stacked layout, safe-area-aware spacing, single-column form
  3. `authenticated-shell / new-thread`
     - first authenticated landing state when no thread is selected yet
     - desktop layout: left sidebar + main thread canvas + bottom composer
     - main area shows welcome/empty state with suggested prompts or guidance chips
     - user can start a new chat immediately from composer or sidebar CTA
  4. `authenticated-shell / existing-thread`
     - same shell, but main area hydrates an existing conversation
     - assistant-ui `Thread`-style message surface handles streaming conversation rendering
     - preserve room for inline status cards, ambiguity prompts, and structured result blocks
  5. `sign-out`
     - sign-out affordance available in authenticated shell header/profile area
     - action calls backend logout, clears FE auth state, and returns user to sign-in without stale shell state
- Authenticated desktop shell layout:
  - top header:
    - product title/subtitle
    - language switcher
    - user/profile entry
    - sign-out button
  - left sidebar:
    - new chat button
    - conversation search
    - pinned conversations section
    - recent conversations section
    - delete conversation action with confirmation
    - bottom user identity panel
  - main chat area:
    - assistant-ui thread surface for user/assistant turns
    - streaming in-place response updates
    - bottom composer anchored consistently
    - support for loading, empty, error, and retry states
  - structured result rendering:
    - backend-originated tabular/summary/result payloads render inline in the thread or in a bounded companion panel
    - frontend only renders returned structures; it does not reinterpret orchestration intent
- Authenticated mobile shell layout:
  - compact top bar with brand, language/profile access, and sidebar trigger
  - conversation history moves into drawer/sheet navigation
  - thread remains the primary surface
  - composer remains bottom-anchored and thumb-reachable
  - destructive actions (delete, sign-out) require deliberate taps / confirmations
- Required UI states to implement before backend wiring:
  - session checking
  - unauthenticated idle
  - sign-in submitting
  - sign-in failure / validation error
  - authenticated empty thread
  - authenticated loading conversation list
  - authenticated loading selected thread
  - streaming response in progress
  - backend-returned ambiguity/disambiguation state
  - backend-returned error state
  - empty results / no-results explanation state
  - expired/unauthorized session bounce back to sign-in
- assistant-ui usage plan:
  - use the AI SDK example primarily as a layout/runtime-pattern reference: sidebar + thread + responsive navigation + persistence-minded conversation UX
  - for the UI-first tranche, wire `assistant-ui` components against mocked/local state first so the shell can be finalized safely
  - later replace the mock transport with the real backend stream transport without moving orchestration logic into the frontend
- i18n / translation rules locked for the UI tranche:
  - all user-visible strings must come from translation keys from the first UI pass
  - baseline locale set should mirror PhoenixAI reference: `en`, `ja`, `zh`, `ko`
  - selected language persists in `localStorage`
  - sign-in, sidebar, header, empty states, error states, and confirmation copy must all be translated
- Look-and-feel direction:
  - clean enterprise chat UI, visually close to assistant-ui AI SDK example rather than a generic admin dashboard
  - soft surfaces, clear hierarchy, restrained chrome, chat-first workspace
  - desktop should feel spacious; mobile should feel app-like rather than squeezed desktop UI
- Explicit backend/UI boundary for implementation:
  - frontend owns presentation, routing state, drawers/modals, thread rendering, and local interaction state
  - backend owns auth truth, orchestration, tool choice, fallback, streaming semantics, persistence policy, and domain reasoning
  - if the backend returns status/result/disambiguation payloads, frontend renders them faithfully; it does not invent alternate execution policy
- Immediate implementation order from this map:
  1. scaffold auth gate + providers + i18n bootstrap
  2. build sign-in screen
  3. build authenticated desktop/mobile shell skeleton
  4. add sidebar/thread/composer states on mocked data
  5. finalize translations + responsiveness + empty/error/disambiguation states
  6. only then start backend transport wiring

### 2026-03-11 — Actual frontend scaffold landing status
- Repo-root shell verification was used as the source of truth because the IDE/view layer intermittently showed unrelated `frontend/package.json` / `frontend/node_modules` / `frontend/dist` content that was **not** present in the real SkylarkAI repo.
- The real `frontend/` directory now has the intended top-level scaffold on disk:
  - `eslint.config.js`
  - `index.html`
  - `vite.config.ts`
  - `tsconfig.json`
  - `tsconfig.node.json`
  - `locales/{en,ja,zh,ko}.json`
- The real `frontend/src/` tree is now present on disk after explicitly creating the missing directories and re-applying the source files in smaller patches:
  - `src/main.tsx`, `src/index.css`, `src/vite-env.d.ts`
  - `src/app/{providers,RootApp,SignIn,AppShell}.tsx`
  - `src/components/common/LanguageSwitcher.tsx`
  - `src/components/sidebar/ConversationSidebar.tsx`
  - `src/components/chat/{ChatThread,Composer}.tsx`
  - `src/services/{auth.events,auth.service,mock-chat.service}.ts`
  - `src/types/chat.ts`
  - `src/utils/i18n.ts`
- Current UI behavior is intentionally mock/local only:
  - mocked auth session check/login/logout
  - mocked conversation list/thread/send/pin/delete
  - responsive desktop sidebar + mobile drawer shell
  - translated sign-in / shell / sidebar / composer copy for `en`, `ja`, `zh`, `ko`
- Latest frontend refinement pass completed on top of the scaffold:
  - locale JSONs were flattened into the repo-preferred dot-key pattern (for example `"app.title"` instead of nested `app -> title` objects) across `en`, `ja`, `zh`, and `ko`
  - `src/utils/i18n.ts` now sets `keySeparator: false` so existing calls like `t('app.title')` continue to work against flat JSON keys
  - mobile responsiveness was tightened in the current mocked shell for the sign-in screen, top app bar, drawer/sidebar, thread surface, composer, and language switcher
  - sign-in copy was also adjusted to stop describing the UI as a Phoenix-style auth gate; it now describes a responsive sign-in/workspace shell more truthfully
- Backend boundary remains preserved: no live backend transport, no frontend-owned orchestration, no frontend-owned MCP-vs-MongoQL selection, and no frontend-owned persistence policy has been added.
- Frontend diagnostics pass so far is limited but truthful:
  - repo-root shell verification of real on-disk files: complete
  - locale JSON parse/shape validation: complete (`44` flat entries in each locale file; no nested objects remain)
  - IDE diagnostics over the refined frontend files now mainly fail because frontend packages are still not installed in the real repo; one local sidebar typing cleanup was applied so that avoidable TS issues do not remain hidden behind the missing-dependency noise
  - `frontend/package.json`: still missing in the real repo
  - frontend dependency install / build / lint / typecheck: not yet run because package-manager bootstrap requires explicit user approval
- Important unresolved gap for the next tranche:
  - the current UI shell is still a custom MUI/mock scaffold shaped after the agreed PhoenixAI structure reference; it is **not yet actual `assistant-ui` code**
  - bringing in real `assistant-ui` components/runtime still requires the frontend package bootstrap/install step, which remains approval-gated

### 2026-03-11 — Frontend package bootstrap + real assistant-ui validation pass
- Frontend package bootstrap is now complete in the real repo:
  - `frontend/package.json` created
  - `frontend/package-lock.json` created
  - frontend dependencies installed with npm, including React, MUI, React Query, i18n, `@assistant-ui/react`, and `@assistant-ui/react-markdown`
  - `@types/node` added as a dev dependency to support the Vite/Node config types cleanly
- Replaced the prior custom chat surface with real `assistant-ui` runtime/primitives while keeping the UI shell, mocked auth, mocked local conversation persistence, mobile responsiveness, and flat locale resources intact.
- Current assistant-ui integration now uses:
  - `AssistantRuntimeProvider`
  - `useLocalRuntime`
  - a local `ChatModelAdapter`
  - `ThreadPrimitive.Root` / `Viewport` / `Messages` / `Empty`
  - `MessagePrimitive.Root` / `Parts`
  - `ComposerPrimitive.Root` / `Input` / `Send`
  - `MarkdownTextPrimitive` for markdown-capable text rendering
- Kept the required frontend/backend boundary intact:
  - frontend remains presentation/runtime-adapter only
  - backend remains the future source of truth for orchestration, tool choice, fallback behavior, streaming semantics, and persistence policy
  - current frontend transport remains mocked/local for this tranche
- Stabilized the frontend toolchain/config around the assistant-ui conversion:
  - updated `frontend/tsconfig.json` to modern Vite-compatible bundler-mode settings (`ES2022`, bundler module resolution, etc.)
  - updated `frontend/tsconfig.node.json` to use bundler resolution and Node types
  - simplified app-level assistant-ui usage to avoid brittle local selector typing assumptions
  - fixed `frontend/eslint.config.js` to use the plugin's flat-config export correctly
- Validation results after the assistant-ui/bootstrap pass:
  - `npm run build`: passing
  - `npm run lint`: passing
  - `npm run dev -- --host 0.0.0.0`: passing
  - local browser open issued for `http://localhost:5176/`
  - build emits only a non-blocking Vite chunk-size warning for the main bundle
- User-requested UI constraints remain satisfied in the current frontend state:
  - locales remain flat dot-key JSON across `en`, `ja`, `zh`, `ko`
  - mobile-responsive shell/layout refinements remain in place
  - no PhoenixAI frontend code was copied directly into SkylarkAI; `assistant-ui` is the active chat/thread/composer layer

### 2026-03-11 — Frontend PhoenixAI visual-parity restyle + clean review-ready validation
- Applied the PhoenixAI-inspired visual restyle on top of the real `assistant-ui` frontend without transplanting PhoenixAI implementation logic:
  - refreshed `frontend/src/app/providers.tsx` with the softer Phoenix-inspired palette, translucent surfaces, larger radii, and typography/theme overrides
  - replaced `frontend/src/index.css` with the layered blurred radial background/glow treatment and related shared page styling
  - redesigned `frontend/src/app/SignIn.tsx` into the Phoenix-style split auth card while keeping the existing mocked/local auth contract truthful
  - restyled `frontend/src/app/AppShell.tsx`, `frontend/src/components/sidebar/ConversationSidebar.tsx`, `frontend/src/components/chat/ChatThread.tsx`, `frontend/src/components/chat/Composer.tsx`, and `frontend/src/components/common/LanguageSwitcher.tsx` so the authenticated shell reads much closer to the PhoenixAI reference while preserving `assistant-ui` primitives/runtime
- Kept frontend constraints intact during the parity pass:
  - `assistant-ui` remains the active thread/composer/runtime layer
  - no PhoenixAI orchestration/business logic was moved into SkylarkAI
  - locales remain flat dot-key JSON in `en`, `ja`, `zh`, and `ko`
  - mobile responsiveness remains part of the touched sign-in, shell, sidebar, thread, and composer surfaces
- Added the Phoenix-style sign-in security verification UI and refreshed translated empty-state suggestion copy in the locale resources while keeping everything frontend-local for this tranche.
- Validation / review-readiness notes after the parity pass:
  - fixed a JSX closing-tag mismatch in `frontend/src/components/chat/Composer.tsx` discovered during the first validation run
  - `npm run build`: passing
  - `npm run lint`: passing
  - fresh `npm run dev -- --host 0.0.0.0`: passing on `http://localhost:5176/`
  - review state is now clean again on the restarted Vite server after removing the stale terminal that still contained the pre-fix parser error

### 2026-03-11 — Frontend sharp-edge + compact-density refinement pass
- Responded to direct user feedback that the Phoenix-inspired pass was still too rounded and oversized.
- Tightened the frontend visual system toward the flatter PhoenixAI feel by reducing radius and density across the current `assistant-ui` shell:
  - `frontend/src/app/providers.tsx`: reduced global `shape.borderRadius`, tightened button/input sizing, and reduced blur/shadow intensity on menus/dialogs/drawers/cards
  - `frontend/src/index.css`: simplified the background glow treatment to a subtler Phoenix-like top-field blur over `#FAFAFC`
  - `frontend/src/components/chat/Composer.tsx`: reduced composer padding/height, switched to a more compact single-row default, and shrank the send CTA
  - `frontend/src/components/sidebar/ConversationSidebar.tsx`: reduced new-chat button height, card padding, corner radius, footer bulk, and action button footprint
  - `frontend/src/components/chat/ChatThread.tsx`: tightened the thread panel, suggestion cards, and message bubble corner radii
  - `frontend/src/app/AppShell.tsx`, `frontend/src/components/common/LanguageSwitcher.tsx`, and `frontend/src/app/SignIn.tsx`: removed remaining pill-like controls and oversized chrome so the whole shell stays visually consistent
- Validation after the compacting pass:
  - targeted IDE diagnostics on all touched frontend files: clean
  - `npm run build`: passing
  - `npm run lint`: passing
  - existing Vite dev server kept running on `http://localhost:5176/` for immediate browser refresh/review

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
- `frontend/eslint.config.js`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/locales/en.json`
- `frontend/locales/ja.json`
- `frontend/locales/zh.json`
- `frontend/locales/ko.json`
- `frontend/tsconfig.json`
- `frontend/tsconfig.node.json`
- `frontend/vite.config.ts`
- `frontend/src/vite-env.d.ts`
- `frontend/src/main.tsx`
- `frontend/src/index.css`
- `frontend/src/app/providers.tsx`
- `frontend/src/app/RootApp.tsx`
- `frontend/src/app/SignIn.tsx`
- `frontend/src/app/AppShell.tsx`
- `frontend/src/components/common/LanguageSwitcher.tsx`
- `frontend/src/components/sidebar/ConversationSidebar.tsx`
- `frontend/src/components/chat/ChatThread.tsx`
- `frontend/src/components/chat/Composer.tsx`
- `frontend/src/services/auth.events.ts`
- `frontend/src/services/auth.service.ts`
- `frontend/src/services/mock-chat.service.ts`
- `frontend/src/types/chat.ts`
- `frontend/src/utils/i18n.ts`
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
- Phoenix final hygiene validation pass: passing
- Phoenix malformed generated-query repair regression coverage: passing
- Phoenix representative expired-certificates smoke proof: passing (`101` rows)
- Phoenix representative maintenance-due-next-month smoke proof: passing (`101` rows)
- Phoenix full representative API smoke script: passing on fresh backend code
- Backend build (`npm run build`): passing
- Repo-wide TypeScript (`npx tsc --noEmit --pretty false`): passing
- Backend typecheck (`npm run typecheck`): passing
- Frontend real on-disk scaffold verification: passing
- Frontend IDE diagnostics on scaffold source files: no issues reported
- Frontend package manifest/bootstrap: complete
- Frontend real `assistant-ui` chat runtime/primitives integration: complete for the current mocked/local shell
- Frontend build (`npm run build`): passing
- Frontend lint (`npm run lint`): passing
- Frontend dev server (`npm run dev -- --host 0.0.0.0`): passing on `http://localhost:5176/`
- Frontend browser open for inspection: complete
- Phoenix Mongo split unit test: passing
- Phoenix service adapter unit test: passing
- Phoenix route contract unit test: passing
- Phoenix dual-view helper unit test: passing
- Phoenix runtime executor unit test: passing
- Phoenix conversation persistence unit test: passing
- Phoenix API smoke script: passing on fresh backend code for both representative queries
- MCP smoke regression check: passing

### Next immediate steps
1. Perform browser/mobile visual review of the current assistant-ui-based shell and collect any UX polish feedback.
2. If the shell is accepted, plan the next tranche to replace the mocked/local transport with the real backend stream transport while keeping backend orchestration as the source of truth.
3. When backend wiring begins, keep `backend/scripts/phoenixai/query-smoke.mjs` as the honesty check and re-run the focused Phoenix tests plus `npm run test:phoenix:api` before claiming end-to-end readiness.

### Notes for the next agent
- This `TASK_TRACKER.md` file is the only canonical handoff / continuation file for this tranche; do not split progress notes across additional trackers.
- The indexers were intentionally landed under `backend/scripts/phoenixai/` and seeds under `backend/seed/` so they can continue using `dotenv.config()` and `seed/...` relative paths with minimal change.
- Do not merge Phoenix runtime logic into `backend/src/mcp/`; keep deterministic MCP separate.
- The full backend TypeScript check is now clean; if it regresses, treat that as a real new issue instead of an inherited one.
- The Phoenix route surface is now mounted publicly at `/api/phoenix-openai`; keep future changes bounded to that namespace rather than blending them into MCP.
- The latest observability proof is complete on fresh code: startup `.env` summary, smoke-terminal LLM streaming, and BE-terminal `[PhoenixStream]` logs are all working.
- The previously failing representative streamed query (`show me all expired certificates`) now succeeds again and returns `101` rows; the paired maintenance query also succeeds with `101` rows.
- For the current migration scope, the backend is ready for UI integration work; remaining work should now be driven by UI integration rather than backend-parity blockers.
- Do **not** use the current PhoenixCloudBE frontend as the UI reference for the next step; use `/home/phantom/testcodes/AgentsAndMCPs/PhoenixAI/FE_TSX/` instead.
- `assistant-ui` is frontend scaffolding only; backend remains the owner of orchestration, MCP-vs-MongoQL choice, and tool fallback behavior.
- The detailed Sign In -> Sign Out UI map is already captured above; the current truth is that the first real frontend scaffold has now landed on disk with mocked auth/chat state.
- When frontend path/tool views disagree again, use repo-root shell verification under `/home/phantom/testcodes/SkylarkAI` as the source of truth before making more edits.
- Frontend bootstrap is now real and validated: `frontend/package.json` exists, `npm run build` and `npm run lint` are passing, and the local Vite app was started/opened at `http://localhost:5176/` for inspection.
- Update this tracker after every meaningful tranche or validation run.

