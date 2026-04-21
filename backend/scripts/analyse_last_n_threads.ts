/**
 * analyse_last_n_threads.ts
 * Finds the last N distinct thread_ids in LangGraph checkpoints and runs
 * debug_chat_analysis logic on each, printing a per-thread, per-conversation verdict.
 *
 * Usage: npx tsx scripts/analyse_last_n_threads.ts [N]
 * Default N = 6
 */

import { MongoClient, BSON } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri    = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';
const N      = parseInt(process.argv[2] || '6', 10);

const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function decodeCheckpointBuffer(raw: any): any {
    if (!raw) return null;
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(raw))                                  buf = raw;
    else if (raw?._bsontype === 'Binary' || raw?.buffer)       buf = Buffer.from(raw.buffer || raw.value(), 'binary');
    else if (raw?.type === 'Buffer' && Array.isArray(raw?.data)) buf = Buffer.from(raw.data);
    if (!buf) return null;
    try { return BSON.deserialize(buf); } catch { try { return JSON.parse(buf.toString('utf-8')); } catch { return null; } }
}

function parseToolResult(res: any) {
    let data: any = res;
    if (data?.content?.[0]?.text) { try { data = JSON.parse(data.content[0].text); } catch {} }
    const isError    = !!(data?.isError);
    const isInternal = !!(data?.capability && ['mcp.query_active_filters','mcp.clear_filters'].some((t: string) => data.capability?.includes(t)));
    const items      = isError ? -1 : (Array.isArray(data?.items) ? data.items.length : (data?.__ambiguity_stop ? 0 : -99));
    const filters    = data?.appliedFilters
        ? Object.entries(data.appliedFilters).filter(([,v]) => v != null && v !== false && v !== '').map(([k,v]) => `${k}=${v}`).join(', ')
        : '';
    return { items, filters, isError, isInternal };
}

async function analyseThread(db: any, threadId: string): Promise<void> {
    const checkpoints = await db.collection('checkpoints')
        .find({ thread_id: threadId })
        .sort({ checkpoint_id: 1 })
        .toArray();

    if (checkpoints.length === 0) {
        console.log(`  ${C.dim}(no checkpoints)${C.reset}`);
        return;
    }

    // Group checkpoints into conversations by rawQuery boundary
    type Conv = {
        rawQuery: string;
        turns: Array<{ iter: number; tools: Array<{ name: string; items: number; filters: string; isError: boolean }>; clarifyingQ: string | null; verdict_hint: string }>;
    };

    const conversations: Conv[] = [];
    let currentConv: Conv | null = null;

    for (const cp of checkpoints) {
        const state = decodeCheckpointBuffer(cp.checkpoint);
        if (!state) continue;
        const wm: any = state.channel_values?.workingMemory;
        const rawQuery: string = wm?.queryContext?.rawQuery || '';
        const iter: number = state.channel_values?.iterationCount ?? 0;
        const toolResults: any[] = state.channel_values?.toolResults || [];
        const lastTurn: any = toolResults[toolResults.length - 1] || {};
        const ambiguousMatches: any[] = state.channel_values?.workingMemory?.sessionContext?.scope?.ambiguousMatches || [];
        const failedLabels: string[] = state.channel_values?.workingMemory?.sessionContext?.scope?.failedSessionLabels
            ? [...(state.channel_values.workingMemory.sessionContext.scope.failedSessionLabels as any)]
            : [];

        // New conversation boundary
        if (!currentConv || (rawQuery && rawQuery !== currentConv.rawQuery && iter <= 1)) {
            if (currentConv) conversations.push(currentConv);
            currentConv = { rawQuery: rawQuery || '(empty)', turns: [] };
        }

        // Parse tools from last turn
        const tools: any[] = [];
        for (const [key, val] of Object.entries(lastTurn)) {
            const r = parseToolResult(val);
            tools.push({ name: key, ...r });
        }

        // Clarifying question detection — look at messages
        const messages: any[] = state.channel_values?.activeMessages || state.channel_values?.messages || [];
        const lastAIMsg = [...messages].reverse().find((m: any) => m.type === 'ai' || m._type === 'ai');
        const content: string = lastAIMsg?.content || '';
        const clarifyingQ = (content.includes('?') && content.length < 400) ? content.substring(0, 200) : null;

        // Verdict hint
        let verdict_hint = 'normal';
        if (ambiguousMatches.length > 0)  verdict_hint = 'ambiguous';
        if (failedLabels.length > 0)       verdict_hint = 'dead-end';
        if (iter >= 7)                     verdict_hint = 'near-fail';

        currentConv!.turns.push({ iter, tools, clarifyingQ, verdict_hint });
    }
    if (currentConv) conversations.push(currentConv);

    // Print per-conversation
    conversations.forEach((conv, i) => {
        const maxIter = Math.max(...conv.turns.map(t => t.iter), 0);
        const allTools = conv.turns.flatMap(t => t.tools);
        const hasData  = allTools.some(t => t.items > 0);
        const hasError = allTools.some(t => t.isError);
        const hasHITL  = conv.turns.some(t => t.clarifyingQ);
        const hasDeadEnd = conv.turns.some(t => t.verdict_hint === 'dead-end');
        const hasAmbiguous = conv.turns.some(t => t.verdict_hint === 'ambiguous');

        // Loop detection
        const toolCounts: Record<string, number> = {};
        allTools.forEach(t => { const k = `${t.name}:${t.filters}`; toolCounts[k] = (toolCounts[k] || 0) + 1; });
        const loopedTool = Object.entries(toolCounts).find(([,c]) => c >= 3);

        let verdict: string;
        let color: string;
        if (loopedTool)                    { verdict = '🔁 LOOP'; color = C.red; }
        else if (maxIter >= 7 && !hasData) { verdict = '❌ FAIL'; color = C.red; }
        else if (hasHITL && !hasData)      { verdict = '🔶 HITL'; color = C.yellow; }
        else if (hasData)                  { verdict = '✅ PASS'; color = C.green; }
        else                               { verdict = '⚠️  WARN'; color = C.yellow; }

        const queryShort = conv.rawQuery.substring(0, 80);
        console.log(`  ${C.bold}Conv ${i+1}${C.reset} [iter=${maxIter}] ${color}${verdict}${C.reset}`);
        console.log(`    ${C.dim}Q: "${queryShort}${conv.rawQuery.length > 80 ? '...' : ''}"${C.reset}`);

        if (hasAmbiguous) console.log(`    ${C.magenta}⚡ ambiguousMatches was populated${C.reset}`);
        if (hasDeadEnd)   console.log(`    ${C.yellow}💀 failedSessionLabels detected (dead-end)${C.reset}`);
        if (hasHITL)      console.log(`    ${C.cyan}❓ HITL: "${conv.turns.find(t=>t.clarifyingQ)?.clarifyingQ?.substring(0,120)}"${C.reset}`);
        if (loopedTool)   console.log(`    ${C.red}🔁 Looped tool: ${loopedTool[0]} (${loopedTool[1]}x)${C.reset}`);

        const toolSummary = [...new Set(allTools.map(t => {
            const label = t.name.replace(/_iter\d+(_\d+)?$/, '');
            const itemStr = t.items === -99 ? '?' : t.items === -1 ? 'ERR' : `${t.items}`;
            return `${label}(${itemStr})`;
        }))].join(', ');
        if (toolSummary) console.log(`    ${C.dim}Tools: ${toolSummary}${C.reset}`);
        console.log();
    });
}

async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        // Find the last N distinct thread_ids ordered by most recent checkpoint
        const pipeline = [
            { $group: { _id: '$thread_id', lastId: { $max: '$_id' } } },
            { $sort: { lastId: -1 } },
            { $limit: N },
        ];
        const threads: any[] = await db.collection('checkpoints').aggregate(pipeline).toArray();

        if (threads.length === 0) {
            console.log('No checkpoints found in DB.');
            return;
        }

        console.log(`\n${C.bold}${C.cyan}═══ Last ${threads.length} Thread(s) — Conversation Health Report ═══${C.reset}\n`);

        for (let i = 0; i < threads.length; i++) {
            const threadId = threads[i]._id;
            const label = i === 0 ? ' (LATEST)' : ` (${i} thread(s) ago)`;
            console.log(`${C.bold}Thread ${i+1}${C.reset}${C.dim}${label}${C.reset}: ${C.yellow}${threadId}${C.reset}`);
            await analyseThread(db, threadId);
        }

        console.log(`${C.bold}${C.cyan}═══ End of Report ═══${C.reset}\n`);
    } finally {
        await client.close();
    }
}
main().catch(console.error);
