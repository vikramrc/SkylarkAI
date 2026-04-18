/**
 * check_failure_query.ts
 * Targeted diagnostic: checks the last N turns of a thread for:
 *   1. Which tools ran on the "failure codes" query
 *   2. Whether failureCode/failureCategory were in the response
 *   3. Long-term buffer state (content, [MEMORY_BLOCK] presence)
 *   4. Conversation counter and summaryBuffer length
 *
 * Usage: npx tsx scripts/check_failure_query.ts [thread_id]
 */
import { MongoClient, BSON } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';
const C = { reset: '\x1b[0m', yellow: '\x1b[33m', green: '\x1b[32m', magenta: '\x1b[35m', cyan: '\x1b[36m', blue: '\x1b[34m', red: '\x1b[31m', dim: '\x1b[2m', bold: '\x1b[1m' };

function decodeCheckpointBuffer(raw: any): any {
    if (!raw) return null;
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(raw)) buf = raw;
    else if (raw?._bsontype === 'Binary' || raw?.buffer) buf = Buffer.from(raw.buffer || raw.value(), 'binary');
    else if (raw?.type === 'Buffer' && Array.isArray(raw?.data)) buf = Buffer.from(raw.data);
    if (!buf) return null;
    try { return BSON.deserialize(buf); } catch {
        try { return JSON.parse(buf.toString('utf-8')); } catch { return null; }
    }
}

function parseToolResult(res: any) {
    let data: any = res;
    if (data?.content?.[0]?.text) {
        try { data = JSON.parse(data.content[0].text); } catch { /* ignore */ }
    }
    const items: any[] = Array.isArray(data?.items) ? data.items : [];
    const itemCount = data?.isError ? -1 : items.length;
    const filters = data?.appliedFilters
        ? Object.entries(data.appliedFilters).filter(([,v]) => v != null && v !== false).map(([k,v]) => `${k}=${v}`).join(', ')
        : '';
    // Check for failure data in items
    const failureFields = items.slice(0, 3).map(item => ({
        failureCode: item.failureCode ?? '(missing)',
        failureCategory: item.failureCategory ?? '(missing)',
        isFailureEvent: item.isFailureEvent,
    }));
    return { itemCount, filters, failureFields, isError: data?.isError, errorMsg: data?.error || data?.message };
}

async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);
        const threadId = process.argv[2] ||
            (await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } }))?.thread_id;
        if (!threadId) { console.error('No thread ID found.'); process.exit(1); }

        console.log(`${C.cyan}[Diagnostic] Thread: ${threadId}${C.reset}`);

        const checkpoints = await db.collection('checkpoints')
            .find({ thread_id: threadId })
            .sort({ _id: 1 })
            .toArray();
        console.log(`${C.dim}Total checkpoints: ${checkpoints.length}${C.reset}\n`);

        // ── Find the LAST checkpoint and extract memory state ──────────────────
        let lastSessionCtx: any = null;
        let lastQueryCtx: any = null;
        let prevToolResultsLen = 0;

        // Collect "failure code" related turns
        const failureTurns: { idx: number; tools: any; query: string }[] = [];

        checkpoints.forEach((cp: any, i: number) => {
            const bufSrc = cp.checkpoint?.buffer ?? cp.checkpoint;
            const decoded = decodeCheckpointBuffer(bufSrc);
            if (!decoded) return;

            const wm = decoded.channel_values?.workingMemory || {};
            const qc = wm.queryContext || {};
            const sc = wm.sessionContext || {};
            const toolResults: any[] = decoded.channel_values?.toolResults || [];

            lastSessionCtx = sc;
            lastQueryCtx = qc;

            const currentTurnResults = toolResults.length > prevToolResultsLen
                ? toolResults[toolResults.length - 1]
                : null;
            prevToolResultsLen = toolResults.length;

            // Flag turns related to failure codes
            const rawQ: string = qc.rawQuery || '';
            if (rawQ.toLowerCase().includes('failure') && currentTurnResults) {
                failureTurns.push({ idx: i, tools: currentTurnResults, query: rawQ });
            }
        });

        // ── MEMORY STATE ──────────────────────────────────────────────────────
        console.log(`${C.bold}${C.yellow}════ MEMORY STATE (Latest Checkpoint) ════${C.reset}`);

        const convCount = lastSessionCtx?.humanConversationCount ?? 0;
        const bufLen = lastSessionCtx?.summaryBuffer?.length ?? 0;
        const lt: string = lastSessionCtx?.longTermBuffer || '';

        console.log(`\n${C.green}  humanConversationCount : ${convCount}${C.reset}`);
        console.log(`${C.green}  summaryBuffer.length   : ${bufLen}${C.reset}`);
        console.log(`${C.green}  Compression triggered  : ${convCount >= 20 || bufLen < 20 && lt ? 'YES (longTerm has content)' : bufLen >= 20 ? 'SHOULD TRIGGER NEXT TURN' : 'NO (< 20 entries)'}${C.reset}`);

        console.log(`\n${C.cyan}  ── Long Term Buffer ──${C.reset}`);
        if (lt) {
            const hasMemoryBlock = lt.includes('[MEMORY_BLOCK]');
            console.log(`  Length           : ${lt.length} chars`);
            console.log(`  [MEMORY_BLOCK]   : ${hasMemoryBlock ? C.red + 'YES ⚠️  (tags present — bug not yet cleared from DB)' + C.reset : C.green + 'NO ✅ (clean prose)' + C.reset}`);
            console.log(`  Preview:\n    ${lt.substring(0, 400).replace(/\n/g, '\n    ')}`);
        } else {
            console.log(`  ${C.dim}(empty — longTerm compression not yet triggered)${C.reset}`);
        }

        console.log(`\n${C.cyan}  ── Summary Buffer (last 3 entries) ──${C.reset}`);
        const buf: any[] = lastSessionCtx?.summaryBuffer ?? [];
        if (buf.length === 0) {
            console.log(`  ${C.dim}(empty)${C.reset}`);
        } else {
            buf.slice(-3).forEach((e: any) => {
                console.log(`\n  [Conv ${e.conversationIndex}] Q: ${String(e.q).substring(0, 100)}`);
                console.log(`               A: ${String(e.a).substring(0, 100)}...`);
            });
        }

        // ── FAILURE CODE QUERY TURNS ──────────────────────────────────────────
        console.log(`\n${C.bold}${C.yellow}════ FAILURE CODE QUERY TURNS (${failureTurns.length} found) ════${C.reset}`);
        if (failureTurns.length === 0) {
            console.log(`  ${C.red}No turns with 'failure' in the query AND tool results found.${C.reset}`);
            console.log(`  ${C.dim}This means either: (a) the tool was never called, or (b) all turns had empty results.${C.reset}`);
        }

        failureTurns.slice(-6).forEach(({ idx, tools, query }) => {
            console.log(`\n${C.yellow}  ── Checkpoint #${idx} ──${C.reset}`);
            console.log(`  ${C.dim}Query: ${query.substring(0, 100)}...${C.reset}`);
            Object.entries(tools || {}).forEach(([name, res]) => {
                const { itemCount, filters, failureFields, isError, errorMsg } = parseToolResult(res);
                if (isError) {
                    console.log(`  ${C.red}• ${name}: ❌ ERROR — ${errorMsg}${C.reset}`);
                } else {
                    console.log(`  ${C.blue}• ${name}: ${itemCount} item(s) [${filters || 'no filters'}]${C.reset}`);
                    if (failureFields.length > 0) {
                        failureFields.forEach((f, i) => {
                            const fcStatus = f.failureCode === '(missing)' ? C.red + '(missing from projection)' + C.reset : C.green + f.failureCode + C.reset;
                            const catStatus = f.failureCategory === '(missing)' ? C.red + '(missing from projection)' + C.reset : C.green + f.failureCategory + C.reset;
                            console.log(`    Item[${i}]: failureCode=${fcStatus}, failureCategory=${catStatus}, isFailureEvent=${f.isFailureEvent}`);
                        });
                    }
                }
            });
        });

        // ── ACTIVE FILTERS in last checkpoint ─────────────────────────────────
        console.log(`\n${C.bold}${C.yellow}════ ACTIVE FILTERS (Latest Checkpoint) ════${C.reset}`);
        console.log(JSON.stringify(lastQueryCtx?.activeFilters ?? {}, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

main();
