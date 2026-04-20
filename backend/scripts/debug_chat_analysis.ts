/**
 * debug_chat_analysis.ts
 * ──────────────────────────────────────────────────────────────────────────
 * Conversation-level health analysis of an entire LangGraph chat session.
 *
 * Groups all checkpoints by CONVERSATION BOUNDARY (rawQuery change = new
 * conversation) and produces a per-conversation verdict:
 *
 *   ✅ PASS       — Tools ran and returned data, AI answered
 *   🔶 HITL       — AI asked a clarifying question (ambiguity / dead-end)
 *   ⚠️  WARN       — All tools returned 0 items (genuine empty result)
 *   🔁 LOOP       — Same tool+params fired 3+ times, no new data
 *   ❌ FAIL       — Hit iter=8 cap, no substantive answer, or dead-end
 *
 * Usage:
 *   npx tsx scripts/debug_chat_analysis.ts [thread_id]
 *   # Omit thread_id to auto-use the most recent thread.
 *
 * Chain with find_latest_thread:
 *   npx tsx scripts/debug_chat_analysis.ts $(npx tsx scripts/find_latest_thread.ts 2>/dev/null)
 */

import { MongoClient, BSON } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri    = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';

const C = {
    reset:    '\x1b[0m',
    bold:     '\x1b[1m',
    dim:      '\x1b[2m',
    red:      '\x1b[31m',
    green:    '\x1b[32m',
    yellow:   '\x1b[33m',
    blue:     '\x1b[34m',
    magenta:  '\x1b[35m',
    cyan:     '\x1b[36m',
    white:    '\x1b[37m',
};

// ── Checkpoint Decoder ────────────────────────────────────────────────────
function decodeCheckpointBuffer(raw: any): any {
    if (!raw) return null;
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(raw))                                 buf = raw;
    else if (raw?._bsontype === 'Binary' || raw?.buffer)      buf = Buffer.from(raw.buffer || raw.value(), 'binary');
    else if (raw?.type === 'Buffer' && Array.isArray(raw?.data)) buf = Buffer.from(raw.data);
    if (!buf) return null;
    try { return BSON.deserialize(buf); }
    catch { try { return JSON.parse(buf.toString('utf-8')); } catch { return null; } }
}

// ── Tool Result Parser ────────────────────────────────────────────────────
function parseToolResult(res: any): { items: number; filters: string; isError: boolean; isInternal: boolean } {
    let data: any = res;
    if (data?.content?.[0]?.text) {
        try { data = JSON.parse(data.content[0].text); } catch {}
    }
    const isError    = !!(data?.isError);
    const isInternal = !!(data?.capability && ['mcp.query_active_filters','mcp.clear_filters'].some(t => data.capability?.includes(t)));
    const items      = isError ? -1 : (Array.isArray(data?.items) ? data.items.length : (data?.__ambiguity_stop ? 0 : -99));
    const filters    = data?.appliedFilters
        ? Object.entries(data.appliedFilters)
            .filter(([, v]) => v != null && v !== false && v !== '')
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')
        : '';
    return { items, filters, isError, isInternal };
}

// ── Verdict ───────────────────────────────────────────────────────────────
type Verdict = '✅ PASS' | '🔶 HITL' | '⚠️  WARN' | '🔁 LOOP' | '❌ FAIL';

interface ToolCall { name: string; items: number; filters: string; isError: boolean; iter: number }

function detectLoop(tools: ToolCall[]): { found: boolean; tool: string; count: number } {
    const counts: Record<string, number> = {};
    for (const t of tools) {
        // Strip _iterN suffix to group logically identical calls
        const baseName = t.name.replace(/_iter\d+(_\d+)?$/, '');
        const key = `${baseName}|${t.filters}`;
        counts[key] = (counts[key] || 0) + 1;
        if (counts[key] >= 3) return { found: true, tool: baseName, count: counts[key] };
    }
    return { found: false, tool: '', count: 0 };
}

function computeVerdict(tools: ToolCall[], hitlRequired: boolean, maxIter: number, hasAmbiguity: boolean): Verdict {
    if (hitlRequired || hasAmbiguity) return '🔶 HITL';

    const loop     = detectLoop(tools);
    if (loop.found)  return '🔁 LOOP';
    if (maxIter >= 7) return '❌ FAIL';

    const realTools = tools.filter(t => !t.isError && t.items !== -99);
    if (realTools.length === 0) return '✅ PASS'; // memory re-surface — valid
    const allZero   = realTools.every(t => t.items === 0);
    const hasData   = realTools.some(t => t.items > 0);

    if (hasData)    return '✅ PASS';
    if (allZero)    return '⚠️  WARN';
    return '❌ FAIL';
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        // Resolve thread_id — strip any injected env lines from piped output
        const rawArg   = (process.argv[2] || '').replace(/\[dotenv.*\]/g, '').trim();
        const threadId: string = rawArg ||
            (await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } }))?.thread_id;

        if (!threadId) { console.error('No thread ID found.'); process.exit(1); }

        console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗`);
        console.log(`║  SkylarkAI Chat Health Analysis                                  ║`);
        console.log(`║  Thread: ${threadId.padEnd(56)}║`);
        console.log(`╚══════════════════════════════════════════════════════════════════╝${C.reset}\n`);

        const rawCheckpoints = await db.collection('checkpoints')
            .find({ thread_id: threadId })
            .sort({ _id: 1 })
            .toArray();

        console.log(`${C.dim}Total checkpoints loaded: ${rawCheckpoints.length}${C.reset}\n`);

        // Decode all checkpoints
        const checkpoints: { cv: any; iter: number; verdict: string; hitlReq: boolean }[] = [];
        for (const cp of rawCheckpoints) {
            const bufSrc = cp.checkpoint?.buffer ?? cp.checkpoint;
            const d = decodeCheckpointBuffer(bufSrc);
            if (!d) continue;
            const cv      = d.channel_values || {};
            const iter    = cv.iterationCount ?? -1;
            const verdict = cv.feedBackVerdict ?? '';
            const hitlReq = !!(cv.hitl_required);
            checkpoints.push({ cv, iter, verdict, hitlReq });
        }

        if (checkpoints.length === 0) {
            console.error('Could not decode any checkpoints.');
            return;
        }

        // ── Group checkpoints into CONVERSATIONS ──────────────────────────
        // Strategy: a NEW conversation starts when rawQuery changes AND iter resets to 0.
        // We scan all checkpoints and record conversation boundaries.
        interface ConvGroup {
            query:          string;
            toolResults:    ToolCall[];
            maxIter:        number;
            hitlRequired:   boolean;
            hasAmbiguity:   boolean;
            ambigLabels:    string[];
            deadEndLabels:  string[];
            activeFilters:  Record<string, any>;
        }

        const convGroups: ConvGroup[] = [];
        let current: ConvGroup | null = null;
        let prevQuery  = '';
        let prevTrLen  = 0;

        for (const { cv, iter, hitlReq } of checkpoints) {
            const qc       = cv.workingMemory?.queryContext || {};
            const rawQuery = (qc.rawQuery || '').trim();
            const trArr: any[] = Array.isArray(cv.toolResults) ? cv.toolResults : [];

            // Detect new conversation: rawQuery changed and iter is low (0 or 1 = fresh start)
            const isNewConv = rawQuery && rawQuery !== prevQuery && iter <= 1;
            if (isNewConv) {
                if (current) convGroups.push(current);
                current = {
                    query:         rawQuery,
                    toolResults:   [],
                    maxIter:       0,
                    hitlRequired:  false,
                    hasAmbiguity:  false,
                    ambigLabels:   [],
                    deadEndLabels: [],
                    activeFilters: {},
                };
                prevQuery = rawQuery;
                prevTrLen = trArr.length;
            }

            if (!current) continue;

            // Update maxIter
            if (iter > current.maxIter) current.maxIter = iter;

            // Update hitlRequired
            if (hitlReq) current.hitlRequired = true;

            // Extract NEW tool results added since last checkpoint
            if (trArr.length > prevTrLen) {
                const newTurns = trArr.slice(prevTrLen);
                newTurns.forEach((turn: any, idx: number) => {
                    Object.entries(turn || {}).forEach(([name, res]) => {
                        if (name === '__requestCycleId') return;
                        const parsed = parseToolResult(res as any);
                        if (parsed.items === -99) return; // skip non-item tools
                        current!.toolResults.push({ name, ...parsed, iter: prevTrLen + idx });
                    });
                });
                prevTrLen = trArr.length;
            }

            // Update scope info from latest checkpoint
            const scope = cv.workingMemory?.sessionContext?.scope || {};
            const ambig = (scope.ambiguousMatches || []) as any[];
            if (ambig.length > 0) {
                current.hasAmbiguity = true;
                current.ambigLabels  = ambig.map((m: any) => m.label);
            }
            current.activeFilters = qc.activeFilters || {};
        }

        // Push last conversation
        if (current) convGroups.push(current);

        if (convGroups.length === 0) {
            console.error('No conversations detected.');
            return;
        }

        // ── Print per-conversation report ─────────────────────────────────
        let passes = 0, hitls = 0, warns = 0, fails = 0, loops = 0;

        convGroups.forEach((conv, i) => {
            const loop    = detectLoop(conv.toolResults);
            const verdict = computeVerdict(conv.toolResults, conv.hitlRequired, conv.maxIter, conv.hasAmbiguity);

            if (verdict === '✅ PASS') passes++;
            else if (verdict === '🔶 HITL') hitls++;
            else if (verdict === '⚠️  WARN') warns++;
            else if (verdict === '🔁 LOOP') { loops++; fails++; }
            else fails++;

            const vColor = verdict.includes('PASS') ? C.green
                         : verdict.includes('HITL') ? C.yellow
                         : verdict.includes('WARN') ? C.yellow
                         : C.red;

            console.log(`${C.bold}${C.white}━━━ Conversation ${i + 1} ${vColor}${verdict}${C.reset}`);
            console.log(`${C.green}  Query  :${C.reset} ${conv.query.length > 110 ? conv.query.substring(0, 110) + '…' : conv.query}`);

            if (conv.toolResults.length > 0) {
                console.log(`${C.blue}  Tools  :${C.reset}`);

                // Group by base tool name + filters to surface loops clearly
                const grouped: Record<string, { items: number; count: number; isError: boolean }> = {};
                conv.toolResults.forEach(t => {
                    const baseName = t.name.replace(/_iter\d+(_\d+)?$/, '');
                    const key = `${baseName}|${t.filters}`;
                    if (!grouped[key]) grouped[key] = { items: t.items, count: 0, isError: t.isError };
                    grouped[key].count++;
                    if (t.items > 0) grouped[key].items = t.items;
                });

                Object.entries(grouped).forEach(([key, g]) => {
                    const [toolName, filters] = key.split('|');
                    const loopTag   = g.count >= 3 ? ` ${C.red}[LOOP ×${g.count}]${C.reset}` : (g.count > 1 ? ` ${C.yellow}[×${g.count}]${C.reset}` : '');
                    const itemColor = g.isError ? C.red : (g.items === 0 ? C.yellow : C.green);
                    const itemStr   = g.isError ? '❌ ERROR' : `${g.items} items`;
                    const filterStr = filters ? ` ${C.dim}[${filters}]${C.reset}` : '';
                    console.log(`    • ${toolName}: ${itemColor}${itemStr}${C.reset}${filterStr}${loopTag}`);
                });
            } else {
                console.log(`${C.dim}  Tools  : (none — memory re-surface)${C.reset}`);
            }

            if (conv.ambigLabels.length > 0) {
                console.log(`${C.yellow}  ⚠ Ambiguous: ${conv.ambigLabels.join(', ')}${C.reset}`);
            }
            if (loop.found) {
                console.log(`${C.red}  ❌ LOOP detected: "${loop.tool}" called ×${loop.count} with same params${C.reset}`);
            }
            if (conv.maxIter >= 6) {
                console.log(`${C.red}  ⚠ iter=${conv.maxIter} (approaching/at hard cap 8)${C.reset}`);
            }
            if (Object.keys(conv.activeFilters).length > 0) {
                console.log(`${C.magenta}  Filters : ${JSON.stringify(conv.activeFilters)}${C.reset}`);
            }

            console.log('');
        });

        // ── Summary ───────────────────────────────────────────────────────
        const total = convGroups.length;
        console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════════╗`);
        console.log(`║  CHAT HEALTH SUMMARY                                             ║`);
        console.log(`║  Total Conversations : ${String(total).padEnd(43)}║`);
        console.log(`║  ✅ PASS             : ${String(passes).padEnd(43)}║`);
        console.log(`║  🔶 HITL (clarif.)  : ${String(hitls).padEnd(43)}║`);
        console.log(`║  ⚠️  WARN (0 items)  : ${String(warns).padEnd(43)}║`);
        console.log(`║  ❌ FAIL / LOOP      : ${String(fails).padEnd(43)}║`);
        const pct = total > 0 ? Math.round(((passes + hitls) / total) * 100) : 0;
        console.log(`║  Health Score        : ${String(`${pct}%`).padEnd(43)}║`);
        console.log(`╚══════════════════════════════════════════════════════════════════╝${C.reset}\n`);

    } catch (err) {
        console.error('Script error:', err);
    } finally {
        await client.close();
    }
}

main();
