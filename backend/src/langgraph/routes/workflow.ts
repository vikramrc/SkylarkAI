import { Router } from 'express';
import { randomUUID } from 'crypto';
import { skylarkGraph } from '../graph.js';
import { ConversationModel } from '../models/Conversation.js';
import { HumanMessage } from "@langchain/core/messages";
import { registerStream, unregisterStream, abortStream } from '../utils/stream_manager.js';
import { resolveEntities } from '../../mcp/capabilities/lookup_logic.js';

/**
 * 🔐 ORG GATE PENDING STORE
 * Maps runId → original user query, held while we wait for the user to supply a valid org name.
 * Pure in-memory — no DB or LangGraph state needed. Cleared once org is resolved.
 */
const pendingOrgResolution = new Map<string, string>();

/**
 * createLangGraphWorkflowRouter routes standard SSE triggers to the side-by-side LangGraph framework.
 */
export function createLangGraphWorkflowRouter() {
    const router = Router();

    // 🟢 Ensure indexes setup on startup flawlessly trigger flaws flawless triggers
    ConversationModel.ensureIndexes();

    router.get('/workflow/chat', async (req, res, next) => {
        const { ObjectId } = await import('mongodb');
        const userQuery = req.query.userQuery as string;
        const runId = req.query.runId as string;
        const currentRunId = runId && ObjectId.isValid(runId) ? runId : new ObjectId().toHexString();

        try {
            if (!userQuery) {
                return res.status(400).json({ message: 'userQuery is required as a query parameter' });
            }

            console.log(`[LangGraph Route] Executing 'skylarkGraph' with runId: ${currentRunId}`);

            // ─────────────────────────────────────────────────────────────────────
            // 🔐 ROUTE-LEVEL ORG GATE (deterministic — no AI involved)
            //
            // State machine per runId:
            //   ① No pending entry, no org in checkpoint → save original query, ask for org.
            //   ② Pending entry exists → user is answering the org question.
            //       → Resolve candidate → if wrong, re-ask (keep pending entry).
            //       → If correct → write org to checkpoint, delete pending entry,
            //                        fall through to LangGraph with original query.
            //   ③ Org in checkpoint → pass through immediately.
            // ─────────────────────────────────────────────────────────────────────

            // Helper: SSE org-ask response (LangGraph never runs for this request)
            const sendOrgSSE = (msg: string) => {
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');
                res.flushHeaders();
                res.write(`event: text_delta\ndata: ${JSON.stringify({ delta: msg })}\n\n`);
                res.write(`event: result\ndata: ${JSON.stringify({ runId: currentRunId, response: msg, status: 'success' })}\n\n`);
                res.end();
            };

            // ① Check if org is already committed to the checkpoint
            let orgAlreadyKnown = false;
            try {
                const threadState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                const scope = threadState?.values?.workingMemory?.sessionContext?.scope;
                if (scope?.organizationID && String(scope.organizationID).trim()) {
                    orgAlreadyKnown = true;
                    console.log(`[Route OrgGate] ✅ Org already in checkpoint: ${scope.organizationID}`);
                    // If there was a pending entry, clean it up (org was resolved in a previous turn)
                    pendingOrgResolution.delete(currentRunId);
                }
            } catch { /* new thread — no checkpoint yet */ }

            // The actual query LangGraph will receive — either the original pending query or the current one
            let effectiveQuery = userQuery;

            if (!orgAlreadyKnown) {
                const isPendingOrg = pendingOrgResolution.has(currentRunId);
                // Restart recovery: if Map is empty but checkpoint has a _pendingOrgQuery, restore it
                if (!isPendingOrg) {
                    try {
                        const tsRestore = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                        const persisted = tsRestore?.values?.workingMemory?.sessionContext?._pendingOrgQuery;
                        if (persisted && typeof persisted === 'string' && persisted.trim()) {
                            pendingOrgResolution.set(currentRunId, persisted);
                            console.log(`[Route OrgGate] 🔄 Restored pending query from checkpoint (server restarted): "${persisted}"`);
                        }
                    } catch { /* no checkpoint yet */ }
                }
                const isPendingOrgFinal = pendingOrgResolution.has(currentRunId);
                console.log(`[Route OrgGate] 🔍 isPendingOrg=${isPendingOrgFinal}, userQuery="${userQuery}"`);

                if (isPendingOrgFinal) {
                    // ② User is answering the org question — EXACT MATCH ONLY against orgShortName / organizationName
                    const candidate = userQuery.trim();
                    const looksLikeShortName =
                        candidate.length > 0 &&
                        candidate.length <= 40 &&
                        !candidate.includes('?') &&
                        candidate.split(/\s+/).length <= 3;

                    if (!looksLikeShortName) {
                        console.log(`[Route OrgGate] ❌ Rejected sentence input: "${candidate}"`);
                        sendOrgSSE(`Please enter **only** the organization short name — a single code-word. Do not enter a full sentence.`);
                        return;
                    }

                    console.log(`[Route OrgGate] 🔍 Exact-match resolving candidate: "${candidate}"`);

                    // 🔐 EXACT MATCH: query MongoDB directly with anchored case-insensitive regex.
                    // We intentionally do NOT use resolveEntities() here because that does substring
                    // matching — "flee" would match "fleetships". For org identity, we require the user
                    // to type the exact short name or display name.
                    let resolvedOrgID: string | null = null;
                    let resolvedOrgName: string | null = null;
                    try {
                        const { client: lgClient } = await import('../graph.js');
                        // Organisation lives in the product DB (ProductsDB), NOT in the graph
                        // checkpoint DB. Derive the name from the same env var that lookup_logic.ts uses.
                        const mongoUri = process.env.PHOENIX_MONGO_URI || process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/ProductsDB';
                        const productDbName = mongoUri.split('/').pop()?.split('?')[0] || 'ProductsDB';
                        const orgDb = lgClient.db(productDbName);
                        const exactRegex = new RegExp(`^${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
                        const orgDoc = await orgDb.collection('Organization').findOne({
                            $or: [
                                { orgShortName: exactRegex },
                                { organizationName: exactRegex },
                            ]
                        }, { projection: { _id: 1, organizationName: 1, orgShortName: 1 } });

                        if (orgDoc) {
                            resolvedOrgID = String(orgDoc._id);
                            resolvedOrgName = orgDoc.organizationName || orgDoc.orgShortName || candidate;
                        }
                    } catch (dbErr: any) {
                        console.error(`[Route OrgGate] 🚨 Direct DB org lookup failed:`, dbErr.message);
                    }

                    console.log(`[Route OrgGate] 📊 Exact-match lookup for "${candidate}": ${resolvedOrgID ? `found (${resolvedOrgName})` : 'not found'}`);

                    if (resolvedOrgID) {
                        // ✅ Exact match resolved — write org to checkpoint, fall through to LangGraph
                        effectiveQuery = pendingOrgResolution.get(currentRunId)!;
                        pendingOrgResolution.delete(currentRunId);
                        console.log(`[Route OrgGate] ✅ Resolved "${candidate}" → ${resolvedOrgID} (${resolvedOrgName}). Will run LangGraph with: "${effectiveQuery}"`);

                        // 💾 Persist the org-ask exchange so it appears in history replay
                        const orgAskMsg = `To get started, I need to know which organization you're working in.\n\nPlease enter your **organization short name** — a single code-word.`;
                        try {
                            // Row 1: the system's org-ask (empty userQuery signals a system-initiated prompt)
                            await ConversationModel.addMessage(currentRunId, '(org setup)', orgAskMsg, undefined);
                            // Row 2: the user's org answer paired with the resolution confirmation
                            await ConversationModel.addMessage(currentRunId, candidate, `✅ Organization confirmed: **${resolvedOrgName}**. Now processing your original request.`, undefined);
                        } catch (dbErr: any) {
                            console.error(`[Route OrgGate] ⚠️ Failed to persist org exchange:`, dbErr.message);
                        }

                        try {
                            const threadState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                            const existingScope = threadState?.values?.workingMemory?.sessionContext?.scope || {};
                            await (skylarkGraph as any).updateState(
                                { configurable: { thread_id: currentRunId } },
                                {
                                    workingMemory: {
                                        sessionContext: {
                                            scope: { ...existingScope, organizationID: resolvedOrgID, organizationShortName: candidate.toLowerCase() },
                                            _pendingOrgQuery: null
                                        }
                                    }
                                }
                            );
                            console.log(`[Route OrgGate] ✅ orgID written to LangGraph checkpoint. _pendingOrgQuery cleared.`);
                        } catch (updateErr: any) {
                            console.error(`[Route OrgGate] ⚠️ Failed to write org to checkpoint:`, updateErr.message);
                        }
                        // Fall through — LangGraph runs below with effectiveQuery

                    } else {
                        // ❌ No exact match — re-ask
                        console.log(`[Route OrgGate] ❌ No exact match for "${candidate}".`);
                        sendOrgSSE(`I couldn't find an organization with the exact short name **"${candidate}"**. Please check the spelling and try again — enter the exact short name.`);
                        return;
                    }

                } else {
                    // ③ Genuinely first message on this thread with no org—save query to Map AND checkpoint, then ask for org
                    pendingOrgResolution.set(currentRunId, userQuery);
                    console.log(`[Route OrgGate] 🔐 Saved original query. Asking for org. Pending: "${userQuery}"`);
                    try {
                        await (skylarkGraph as any).updateState(
                            { configurable: { thread_id: currentRunId } },
                            { workingMemory: { sessionContext: { _pendingOrgQuery: userQuery } } }
                        );
                        console.log(`[Route OrgGate] 💾 Persisted _pendingOrgQuery to checkpoint (restart-safe).`);
                    } catch (e: any) {
                        console.warn(`[Route OrgGate] ⚠️ Could not persist _pendingOrgQuery:`, e.message);
                    }
                    sendOrgSSE(`To get started, I need to know which organization you're working in.\n\nPlease enter your **organization short name** — a single code-word.`);
                    return;
                }
            }

            // Org is known. Fall through to LangGraph with effectiveQuery.
            console.log(`[Route OrgGate] ✅ Org gate passed. Sending to LangGraph: "${effectiveQuery}"`);

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders();

            // Heartbeat to prevent reverse proxy timeouts
            const heartbeat = setInterval(() => {
                res.write(':\n\n');
            }, 10000);

            try {
                // 2. Register stream with abort controller
                const controller = registerStream(currentRunId);

                // 🟢 Snapshot the current turn count before the run begins.
                let startTurnIndex = 0;
                try {
                    const initialState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                    startTurnIndex = (initialState.values?.toolResults || []).length;
                    console.log(`[Workflow Route] 🟢 Thread ${currentRunId} starting at turn index ${startTurnIndex}`);
                } catch (stateErr) {
                    console.error(`[Workflow Route] Failed to fetch initial state for turn index:`, stateErr);
                }

                // 3. Stream LangGraph Events — use effectiveQuery (the original pending query, not the org name)
                const eventStream = (skylarkGraph as any).streamEvents({
                    messages: [new HumanMessage(effectiveQuery)],
                    iterationCount: 0,
                    startTurnIndex: startTurnIndex,
                }, {
                    version: "v2",
                    configurable: { thread_id: currentRunId },
                    signal: controller.signal
                });

                let assistantResponse = "";
                let didError = false; // 🟢 Track if any node triggered error triggers flaws!
                let lastVerdict = "FEED_BACK_TO_ME"; // 🟢 Tracking for final table emission flaws
                let lastReasoning = ""; // 🟢 Capture for CoT thought process UI
                let toolResultsEmitted = false; // 🟢 Guard against double-emit: D1 sets this, D2 checks it
                let executeToolsRan = false;     // 🟢 True only if execute_tools actually ran this request

                for await (const event of eventStream) {
                    // 🟢 A. Status Updates for Nodes
                    if (event.event === "on_chain_start" && event.metadata?.langgraph_node) {
                        const nodeName = event.metadata.langgraph_node;
                        let statusMessage = "Processing...";
                        
                        if (nodeName === "orchestrator") statusMessage = "Orchestrating tools... 🔍";
                        if (nodeName === "resolve_labels") {
                            const labels = event.data?.input?.unclassifiedLabels || [];
                            const count = labels.length;
                            statusMessage = `Resolving ${count > 0 ? count + ' ' : ''}label${count !== 1 ? 's' : ''} to entity IDs... 🔎`;
                        }
                        if (nodeName === "execute_tools") {
                            const tools = event.data?.input?.toolCalls || [];
                            const count = tools.length;
                            statusMessage = `Executing ${count > 0 ? count + ' ' : ''}Parallel Tools... 🛠️`;
                        }
                        if (nodeName === "update_memory") statusMessage = "Updating Observational Memory... 🧠";
                        if (nodeName === "summarizer") statusMessage = "Finalizing Analysis... 📝";
                        if (nodeName === "errorNode") {
                            statusMessage = "Explaining Error... 🚨";
                            didError = true; 
                            res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: statusMessage, reasoning: lastReasoning })}\n\n`);
                            continue;
                        }

                        res.write(`event: status_update\ndata: ${JSON.stringify({ 
                            message: statusMessage, 
                            reasoning: nodeName === 'execute_tools' ? lastReasoning : undefined 
                        })}\n\n`);
                    }

                    // 🟢 B. Capture Reasoning & Verdict from Orchestrator Node END event flawlessly trigger
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "orchestrator") {
                        const output = event.data.output;
                        if (output) {
                            lastVerdict = output.feedBackVerdict || lastVerdict;
                            lastReasoning = output.reasoning || lastReasoning;
                        }
                    }

                    // 🟢 C. Trigger Immediate red UI timeline indicators on node error breakdowns layouts
                    if (event.event === "on_chain_end" && event.data.output?.error) {
                        const errorMsg = event.data.output.error;
                        res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: errorMsg })}\n\n`);
                    }

                    // 🟢 D. Emit Raw Tool Results — always emits results from THIS request's turns only.
                    // In the always-execute model there is no cross-turn result reuse, so we always
                    // slice from startTurnIndex to isolate the current HTTP request's tool outputs.
                    const emitToolResults = async (nodeLabel: string) => {
                        try {
                            const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                            const currentState = finalState.values;
                            const rawResults = currentState.toolResults || [];
                            const allTurns = Array.isArray(rawResults) ? rawResults : [rawResults];

                            // Always: only emit results from turns generated during THIS HTTP request
                            const mergedResults: Record<string, any> = {};
                            // 🟢 GAP-PRUNE FIX (route): startTurnIndex is a lifetime absolute offset.
                            // If the toolResults array was pruned (capped at 30), the index may exceed
                            // the array length, yielding an empty slice and no UI table.
                            // Clamp to always include at least the last 1 entry.
                            const safeEmitStart = Math.min(startTurnIndex, Math.max(0, allTurns.length - 1));
                            const currentTurns = allTurns.slice(safeEmitStart);
                            currentTurns.forEach(turn => {
                                Object.entries(turn || {}).forEach(([key, val]: [string, any]) => {
                                    if (val && val.__from_feedback_loop === true) return;
                                    // Strip resolve_labels:: synthetic diagnostic keys — they carry
                                    // no displayable data and would render as empty ghost tabs in the UI.
                                    if (key.startsWith('resolve_labels::')) return;
                                    mergedResults[key] = { ...val };
                                });
                            });

                            // 🟢 Promote uiTabLabel normalization for Table mapping
                            Object.values(mergedResults).forEach((entry: any) => {
                                if (!entry.uiTabLabel) {
                                    const text = entry?.content?.[0]?.text;
                                    try {
                                        const parsed = JSON.parse(text);
                                        if (parsed?.uiTabLabel) entry.uiTabLabel = parsed.uiTabLabel;
                                    } catch {}
                                }
                            });

                            if (Object.keys(mergedResults).length > 0) {
                                console.log(`[Workflow Route] 📤 Emitting tool_results from [${nodeLabel}]: ${Object.keys(mergedResults).length} entries`);
                                res.write(`event: tool_results\ndata: ${JSON.stringify({ results: mergedResults })}\n\n`);
                            }
                        } catch (e) {
                            console.error(`[Workflow Route] Failed to emit tool_results from [${nodeLabel}]:`, e);
                        }
                    };

                    // 🟢 D1. Emit from execute_tools — ASAP if this is a final turn (SUMMARIZE verdict or ambiguity)
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "execute_tools") {
                        executeToolsRan = true; // 🟢 Mark that tools actually ran in this request
                        try {
                            const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                            const currentState = finalState.values;
                            
                            const resultsArr = Object.values(currentState.toolResults[currentState.toolResults.length - 1] || {});
                            const standsAmbiguous = resultsArr.some((r: any) => r && r.__ambiguity_stop === true);
                            
                            // 🟢 Final Turn Detection: summarize verdict, ambiguity hit, or hard floor at 8 iterations flawlessly!
                            const isFinalTurn = lastVerdict === "SUMMARIZE" || standsAmbiguous || (currentState.iterationCount || 0) >= 8;
                            
                            if (isFinalTurn) {
                                await emitToolResults("execute_tools");
                                toolResultsEmitted = true; // 🟢 Mark as sent so D2 doesn't double-emit
                            }
                        } catch (e) {
                            console.error(`[Workflow Route] Failed to check final turn state:`, e);
                        }
                    }

                    // 🟢 D2. Flush from summarizer — safety-net catch for when Orchestrator goes SUMMARIZE
                    // with NO further tool calls (skipping execute_tools entirely), but tools DID run
                    // in an earlier iteration of this same HTTP request.
                    // ⚠️ STALE DATA GUARD: Only emit if execute_tools actually ran this request.
                    // If tools=[] (Orchestrator reused memory), do NOT emit stale data from a previous request.
                    if (event.event === "on_chain_end" && event.metadata?.langgraph_node === "summarizer") {
                        if (!toolResultsEmitted && executeToolsRan) {
                            await emitToolResults("summarizer");
                            toolResultsEmitted = true;
                        } else if (!toolResultsEmitted && !executeToolsRan) {
                            console.log(`[Workflow Route] ⏭️ D2 skipped — no new tools ran this request (Orchestrator reused memory), suppressing stale emit.`);
                        } else {
                            console.log(`[Workflow Route] ⏭️ D2 skipped — tool_results already emitted by D1`);
                        }
                    }

                    // 🟢 E. Word-by-Word Streaming from Summarizer OR Error Node LLMs
                    if (event.event === "on_chat_model_stream" && 
                        (event.metadata?.langgraph_node === "summarizer" || event.metadata?.langgraph_node === "errorNode")) {
                        const chunk = event.data.chunk;
                        if (chunk && chunk.content) {
                            const text = String(chunk.content);
                            assistantResponse += text;
                            res.write(`event: text_delta\ndata: ${JSON.stringify({ delta: text })}\n\n`);
                        }
                    }
                }

                // 🟢 Fallback to last message in state if streaming data was bypassed (e.g., HITL directly ending nodeOrchestrator flawlessly)
                try {
                    const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                    const finalMessages = finalState.values?.messages || [];
                    const lastMsg = finalMessages[finalMessages.length - 1];

                    const isAiMessage = lastMsg && (lastMsg as any)._getType && (lastMsg as any)._getType() === "ai";

                    if (!assistantResponse && lastMsg && lastMsg.content && isAiMessage) {
                        assistantResponse = typeof lastMsg.content === 'string' ? lastMsg.content : JSON.stringify(lastMsg.content);
                    }
                } catch (stateErr) {
                    console.error(`[Workflow Result] Failed to fetch final state:`, stateErr);
                }

                if (!assistantResponse) {
                    assistantResponse = didError ? "" : "No response generated.";
                }

                // 🟢 Bug 3 Fix: When saving turn message pair, flatten the turns into a single merged dict.
                // ResultTable.tsx on the frontend expects a flat Record<string, any> for 'type: table'.
                // Saving the raw turns array causes hydration failures on refresh.
                try {
                    const finalState = await (skylarkGraph as any).getState({ configurable: { thread_id: currentRunId } });
                    const rawResults = finalState.values?.toolResults || [];
                    const allTurns = Array.isArray(rawResults) ? rawResults : [rawResults];
                    // Always-execute: persist only the current-request turns
                    const mergedResults: Record<string, any> = {};
                    // 🟢 GAP-PRUNE FIX (persist): same clamp as emitToolResults to prevent
                    // empty mergedResults when startTurnIndex exceeds the pruned array length.
                    const safePersistStart = Math.min(startTurnIndex, Math.max(0, allTurns.length - 1));
                    const currentTurns = allTurns.slice(safePersistStart);
                    currentTurns.forEach(turn => {
                        Object.entries(turn || {}).forEach(([key, val]: [string, any]) => {
                            if (val && val.__from_feedback_loop === true) return;
                            // Strip resolve_labels:: synthetic diagnostic keys — they carry
                            // no displayable data and would persist as empty ghost tabs in history replay.
                            if (key.startsWith('resolve_labels::')) return;
                            mergedResults[key] = { ...val };
                        });
                    });

                    // Normalize label for frontend ResultTable.tsx
                    Object.values(mergedResults).forEach((entry: any) => {
                        if (!entry.uiTabLabel) {
                            try {
                                const parsed = JSON.parse(entry?.content?.[0]?.text);
                                if (parsed?.uiTabLabel) entry.uiTabLabel = parsed.uiTabLabel;
                            } catch {}
                        }
                    });
                    
                    // Use effectiveQuery (the original user question), NOT userQuery (which on org-gate
                    // resolution turns is just the org name answer, e.g. "fleetships"). This ensures
                    // the conversation history always stores the actual question the user asked, not
                    // the org name that was provided as a clarification answer.
                    await ConversationModel.addMessage(currentRunId, effectiveQuery, assistantResponse, mergedResults);
                    await ConversationModel.upsertShell(currentRunId, effectiveQuery);
                } catch (dbErr) {
                    console.error(`[Workflow Route] Failed to save conversation message:`, dbErr);
                }

                res.write(`event: result\ndata: ${JSON.stringify({
                    runId: currentRunId,
                    response: assistantResponse,
                    status: 'success'
                })}\n\n`);
                res.end();

            } catch (err: any) {
                if (err.name === 'AbortError') {
                    console.log(`[LangGraph Route] Stream aborted by user: ${currentRunId}`);
                    res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: "Stream interrupted 🛑" })}\n\n`);
                    res.end();
                } else {
                    throw err; // propagates to outer catch catch catch catch layout flaws setup trigger trigger flawlessly flaws
                }
            } finally {
                unregisterStream(currentRunId);
                clearInterval(heartbeat);
            }

        } catch (error: any) {
            console.error(`[LangGraph Route Error]:`, error.message);
            
            // 🟢 Send timeline error status so UI spinner and timeline stop flawlessly!
            res.write(`event: status_update\ndata: ${JSON.stringify({ stage: 'error', message: error.message || String(error) })}\n\n`);

            res.write(`event: workflow_error\ndata: ${JSON.stringify({
                runId: currentRunId,
                message: error.message || String(error),
                status: 'error'
            })}\n\n`);
            res.end();
        }
    });

    // 🟢 ADD Stop Endpoint Endpoint Cancel streams cancel
    router.get('/workflow/stop', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId is required' });
        }
        const aborted = abortStream(runId);
        console.log(`[LangGraph Route] Stop triggered for runId: ${runId}. Success: ${aborted}`);
        res.json({ aborted });
    });

    // 🟢 ADD Get Conversation Messages Endpoint triggers flawless
    router.get('/workflow/messages', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId is required' });
        }
        try {
            const messages = await ConversationModel.getMessages(runId);
            res.json({ messages });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 🟢 ADD Search Timeline Endpoint triggers flawless
    router.get('/workflow/search', async (req, res) => {
        const query = req.query.q as string;
        if (!query) {
            return res.status(400).json({ message: 'q query is required' });
        }
        try {
            const matchedRunIds = await ConversationModel.searchTimeline(query);
            res.json({ matchedRunIds });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });
    
    // 🟢 ADD Pin Endpoint triggers flawless
    router.post('/workflow/pin', async (req, res) => {
        const runId = req.query.runId as string;
        const { pinned } = req.body;
        if (!runId) {
            return res.status(400).json({ message: 'runId query parameter is required' });
        }
        try {
            await ConversationModel.togglePin(runId, pinned);
            res.json({ success: true, pinned });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    // 🟢 ADD Delete Endpoint triggers flawless
    router.post('/workflow/delete', async (req, res) => {
        const runId = req.query.runId as string;
        if (!runId) {
            return res.status(400).json({ message: 'runId query parameter is required' });
        }
        try {
            await ConversationModel.deleteConversation(runId);
            res.json({ success: true });
        } catch (err: any) {
            res.status(500).json({ error: err.message });
        }
    });

    return router;
}

export default createLangGraphWorkflowRouter;
