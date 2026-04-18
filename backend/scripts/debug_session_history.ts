/**
 * debug_session_history.ts
 * Stem-to-stern analysis of a LangGraph conversation thread.
 *
 * Decodes BSON checkpoints and shows, per turn:
 *   - User query (rawQuery)
 *   - Active filters held in memory (activeFilters)
 *   - Tool calls and item counts for THAT turn
 *   - Diagnostic hints from Shadow Checks (diagnosticHint / string summary)
 *   - AI insight sentence (lastTurnInsight)
 *
 * Usage:
 *   npx tsx scripts/debug_session_history.ts [thread_id]
 *   # Omit thread_id to use the most recent thread.
 *
 * To pipe thread_id from find_latest_thread:
 *   npx tsx scripts/debug_session_history.ts $(npx tsx scripts/find_latest_thread.ts 2>/dev/null)
 */
import { MongoClient, BSON } from 'mongodb';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const uri = process.env.SKYLARK_MONGODB_URI || 'mongodb://localhost:27017/SkylarkDB';
const dbName = uri.split('/').pop()?.split('?')[0] || 'SkylarkDB';
const C = { reset: '\x1b[0m', yellow: '\x1b[33m', green: '\x1b[32m', magenta: '\x1b[35m', cyan: '\x1b[36m', blue: '\x1b[34m', red: '\x1b[31m', dim: '\x1b[2m' };

function decodeCheckpointBuffer(raw: any): any {
    if (!raw) return null;
    // LangGraph stores checkpoints as BSON Binary or plain Buffer
    let buf: Buffer | null = null;
    if (Buffer.isBuffer(raw)) {
        buf = raw;
    } else if (raw?._bsontype === 'Binary' || raw?.buffer) {
        buf = Buffer.from(raw.buffer || raw.value(), 'binary');
    } else if (raw?.type === 'Buffer' && Array.isArray(raw?.data)) {
        buf = Buffer.from(raw.data);
    }
    if (!buf) return null;

    // Try BSON first, fall back to JSON
    try {
        return BSON.deserialize(buf);
    } catch {
        try {
            return JSON.parse(buf.toString('utf-8'));
        } catch {
            return null;
        }
    }
}

function parseToolResult(res: any): { items: number; appliedFilters: string; diagnosticHint: string } {
    let data: any = res;
    // Unwrap MCP tool content envelope
    if (data?.content?.[0]?.text) {
        try { data = JSON.parse(data.content[0].text); } catch { /* ignore */ }
    }
    const items = Array.isArray(data?.items) ? data.items.length : (data?.isError ? -1 : 0);
    const filters = data?.appliedFilters
        ? Object.entries(data.appliedFilters).filter(([, v]) => v != null && v !== false).map(([k, v]) => `${k}=${v}`).join(', ')
        : '';
    // Shadow Check diagnostic hint — can live in summary.diagnosticHint (object summary) or
    // directly in summary (string summary, for queryBlockedJobs / queryTemporaryFixes).
    const diagnosticHint: string =
        (typeof data?.summary?.diagnosticHint === 'string' ? data.summary.diagnosticHint : '') ||
        (typeof data?.summary === 'string' && data.summary.startsWith('0 items') ? data.summary : '');
    return { items, appliedFilters: filters, diagnosticHint };
}

async function main() {
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db(dbName);

        const threadId = process.argv[2] ||
            (await db.collection('checkpoints').findOne({}, { sort: { _id: -1 } }))?.thread_id;

        if (!threadId) { console.error('No thread ID found.'); process.exit(1); }

        console.log(`${C.cyan}[Debugger] Analyzing Thread: ${threadId}${C.reset}\n`);

        const checkpoints = await db.collection('checkpoints')
            .find({ thread_id: threadId })
            .sort({ _id: 1 })
            .toArray();

        console.log(`${C.dim}Total checkpoints found: ${checkpoints.length}${C.reset}\n`);

        let prevToolResults: any = null;

        checkpoints.forEach((cp: any, i: number) => {
            const bufSrc = cp.checkpoint?.buffer ?? cp.checkpoint;
            const decoded = decodeCheckpointBuffer(bufSrc);
            if (!decoded) return;

            const wm = decoded.channel_values?.workingMemory || {};
            const qc = wm.queryContext || {};
            const toolResults: any[] = decoded.channel_values?.toolResults || [];

            // Identify THIS turn's new tool results vs previous checkpoint
            const currentTurnResults = toolResults.length > (prevToolResults?.length ?? 0)
                ? toolResults[toolResults.length - 1]
                : null;
            prevToolResults = toolResults;

            const hasContent = qc.rawQuery || Object.keys(qc.activeFilters || {}).length > 0 || currentTurnResults;
            if (!hasContent) return; // Skip empty/init checkpoints

            console.log(`${C.yellow}━━━ TURN ${i} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);

            if (qc.rawQuery) {
                console.log(`${C.green}  Query   :${C.reset} ${qc.rawQuery}`);
            }

            const activeFilters = qc.activeFilters || {};
            const filterStr = Object.keys(activeFilters).length
                ? JSON.stringify(activeFilters)
                : '(none)';
            console.log(`${C.magenta}  Filters :${C.reset} ${filterStr}`);

            if (currentTurnResults && typeof currentTurnResults === 'object') {
                console.log(`${C.blue}  Tools   :${C.reset}`);
                Object.entries(currentTurnResults).forEach(([name, res]) => {
                    const { items, appliedFilters, diagnosticHint } = parseToolResult(res);
                    const itemStr = items === -1 ? '❌ FAILED' : `${items} items`;
                    const filterPart = appliedFilters ? ` [${appliedFilters}]` : '';
                    const hintPart = diagnosticHint ? `\n    ${C.red}⚠ Shadow:${C.reset} ${diagnosticHint}` : '';
                    console.log(`    • ${name}: ${itemStr}${filterPart}${hintPart}`);
                });
            }

            if (qc.lastTurnInsight) {
                console.log(`${C.cyan}  Insight :${C.reset} ${qc.lastTurnInsight.substring(0, 250)}`);
            }
            if (qc.isBroadScope) {
                console.log(`${C.yellow}  ⚠ Broad Scope Mode ACTIVE${C.reset}`);
            }
            console.log('');
        });

    } catch (err) {
        console.error(err);
    } finally {
        await client.close();
    }
}

main();
