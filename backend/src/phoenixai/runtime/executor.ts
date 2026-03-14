import { readFile } from 'node:fs/promises';
import { MongoClient, ObjectId } from 'mongodb';
import type { PhoenixConversation, PhoenixConversationPatch } from '../persistence/conversations.js';
import { uploadJSONToGridFS, type GridFSUploadResult } from '../persistence/gridfs.js';
import { connectQueryMongo } from '../persistence/mongodb.js';
import { AMBIGUITY_RESOLVER_SYSTEM_PROMPT, KEYWORD_EXTRACTOR_SYSTEM_PROMPT, QUERY_GENERATION_SYSTEM_PROMPT } from '../prompts.js';
import {
    dedupByCanonical,
    retrieveChunksGrouped,
    type PhoenixRetrievedItem,
    type PhoenixRetrievalResult,
} from '../retrieval/index.js';
import { getCachedResponseId, saveCachedResponseId, saveStaticCachedResponseId } from '../persistence/prompt-cache.js';
import type {
    PhoenixQueryExecutionInput,
    PhoenixQueryStreamExecutionInput,
    PhoenixServiceResult,
} from '../services/phoenix-openai-response.js';
import { detectDualViewOpportunity } from '../utils/dual-view.js';
import type { PhoenixStreamEmitter } from './contracts.js';
import crypto from 'node:crypto';

export interface PhoenixResponseMessage {
    role: string;
    content: string;
}

export interface PhoenixResponseResult {
    content: string;
    usage?: unknown;
    raw?: unknown;
}

export interface PhoenixResponseStreamEvent {
    kind: 'start' | 'delta' | 'complete';
    provider?: string;
    purpose: string;
    model: string;
    rawType?: string;
    delta?: string;
    text?: string;
    sequence?: number;
    responseId?: string;
    usage?: unknown;
    raw?: unknown;
}

export type PhoenixResponseStreamEmitter = (event: PhoenixResponseStreamEvent) => void | Promise<void>;

export interface PhoenixResponseClient {
    provider?: string;
    createResponse(input: {
        messages: PhoenixResponseMessage[];
        purpose?: string;
        previousResponseId?: string;
        onStreamEvent?: PhoenixResponseStreamEmitter;
    }): Promise<PhoenixResponseResult>;
}

export interface PhoenixCollectionSchemaEntry extends Record<string, unknown> {
    CollectionName: string;
}

export interface PhoenixIntentCandidate {
    intent: string;
    canonicalId: string;
    score?: number;
}

export interface PhoenixSelectedIntent {
    intent: string;
    canonicalId: string;
}

export interface PhoenixResolvedCollections {
    targetCollections: string[];
    perIntent: Array<{ intent: string; canonicalId?: string; collections: string[] }>;
}

export interface PhoenixRuntimeExecutorDependencies {
    updateConversation(id: string, patch: PhoenixConversationPatch): Promise<PhoenixConversation | null>;
    responseClient?: PhoenixResponseClient;
    retrieveGroupedChunks?: typeof retrieveChunksGrouped;
    loadSchema?: () => Promise<PhoenixCollectionSchemaEntry[]>;
    resolveCollectionsFromKeywordsVector?: (keywords: readonly string[]) => Promise<string[]>;
    executePipeline?: (
        baseCollection: string,
        pipeline: readonly Record<string, unknown>[],
    ) => Promise<{ results: unknown[]; resultCount: number; executionTimeMs: number }>;
    uploadResults?: (
        data: unknown,
        filename: string,
        metadata: Record<string, unknown>,
        bucketName: string,
    ) => Promise<GridFSUploadResult>;
    enrichResults?: (results: unknown[]) => Promise<unknown[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!isRecord(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

const ALLOWED_STAGES = new Set([
    '$match', '$project', '$addFields', '$set', '$unset', '$limit', '$skip', '$sort',
    '$lookup', '$unwind', '$group', '$count', '$facet', '$replaceRoot', '$replaceWith',
    '$setWindowFields', '$unionWith'
]);

function validatePipeline(pipeline: readonly Record<string, unknown>[]): void {
    if (!Array.isArray(pipeline)) {
        throw new Error('Pipeline must be an array');
    }
    for (const stage of pipeline) {
        if (!isPlainObject(stage)) {
            throw new Error('Each pipeline stage must be an object');
        }
        const keys = Object.keys(stage);
        if (keys.length !== 1) {
            throw new Error('Each stage must have a single operator');
        }
        const op = keys[0] as string;
        if (!ALLOWED_STAGES.has(op)) {
            throw new Error(`Stage ${op} not allowed`);
        }
    }
}

function sanitizePipelineValue(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizePipelineValue(entry));
    }

    if (!isPlainObject(value)) return value;

    const nextValue: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        nextValue[key] = sanitizePipelineValue(entry);
    }

    if (isPlainObject(nextValue.$getField)) {
        nextValue.$getField = {
            ...nextValue.$getField,
            field: sanitizeGetFieldFieldExpression(nextValue.$getField.field),
        };
    }

    return nextValue;
}

function sanitizePipeline(p: readonly any[] | unknown): any[] {
    const pipeline = Array.isArray(p) ? p : [];
    return pipeline.map((stage) => {
        const op = Object.keys(stage || {})[0];
        if (!op) return null;

        let val = stage[op];

        if (op === '$limit') {
            const n = Number(val);
            if (!Number.isFinite(n) || n <= 0) return null; // drop invalid $limit
        } else if (op === '$skip') {
            const n = Number(val);
            if (!Number.isFinite(n) || n < 0) val = 0; // clamp
        } else if (op === '$facet' && val && typeof val === 'object') {
            const out: Record<string, any> = {};
            for (const k of Object.keys(val)) out[k] = sanitizePipeline(val[k]);
            val = out;
        } else if (op === '$lookup' && val?.pipeline) {
            val = { ...val, pipeline: sanitizePipeline(val.pipeline) };
        } else if (op === '$unionWith' && val?.pipeline) {
            val = { ...val, pipeline: sanitizePipeline(val.pipeline) };
        }

        // Deep value sanitization (includes $getField fix)
        val = sanitizePipelineValue(val);

        return { [op]: val };
    }).filter((s): s is Record<string, any> => s !== null);
}

function stripGridFSKeys(input: any): any {
    if (Array.isArray(input)) return input.map(stripGridFSKeys);
    if (isPlainObject(input)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(input)) {
            if (k === 'gridFSMetadata' || k === 'gridFSFileId') continue;
            out[k] = stripGridFSKeys(v);
        }
        return out;
    }
    return input;
}

function stripPrivateKeys(input: any): any {
    if (Array.isArray(input)) return input.map(stripPrivateKeys);
    if (isPlainObject(input)) {
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(input)) {
            if (typeof k === 'string' && k.startsWith('_') && k !== '_id') continue;
            out[k] = stripPrivateKeys(v);
        }
        return out;
    }
    return input;
}

function extractResponseTextCandidate(raw: unknown): string {
    if (typeof raw === 'string') return raw;
    if (isRecord(raw)) return extractResponseText(raw);
    return '';
}

async function emitStatus(
    onEvent: PhoenixStreamEmitter | undefined,
    stage: string,
    message: string,
    details?: Record<string, unknown>,
): Promise<void> {
    if (!onEvent) return;
    await onEvent({ event: 'status', data: { stage, message, ...(details ?? {}) } });
}

async function emitResult(
    onEvent: PhoenixStreamEmitter | undefined,
    data: unknown,
): Promise<void> {
    if (!onEvent) return;
    await onEvent({ event: 'result', data });
}

function createRuntimeLlmEmitter(
    onEvent: PhoenixStreamEmitter | undefined,
    context: Record<string, unknown> = {},
): PhoenixResponseStreamEmitter | undefined {
    if (!onEvent) return undefined;

    return async (event) => {
        await onEvent({ event: 'llm', data: { ...context, ...event } });
    };
}

function selectOpenAiResponseModel(purpose: string): string {
    return purpose === 'ambiguity' || purpose === 'intent' || purpose === 'keyword_extraction'
        ? (process.env.OPENAI_AMBIGUITY_MODEL || 'gpt-5-mini')
        : (process.env.OPENAI_QUERY_MODEL || 'gpt-5');
}

function resolveOpenAiReasoningEffort(purpose: string): string {
    return purpose === 'ambiguity'
        ? (process.env.OPENAI_REASONING_EFFORT || 'low')
        : 'none';
}

function extractResponseText(data: Record<string, unknown>): string {
    const directOutput = typeof data.output_text === 'string' ? data.output_text : '';
    if (directOutput) return directOutput;

    if (Array.isArray(data.output_text)) {
        const joinedOutputText = data.output_text
            .map((entry) => {
                if (typeof entry === 'string') return entry;
                if (!isRecord(entry)) return '';
                if (typeof entry.text === 'string') return entry.text;
                if (isRecord(entry.text) && typeof entry.text.value === 'string') return entry.text.value;
                if (typeof entry.value === 'string') return entry.value;
                return '';
            })
            .join('');
        if (joinedOutputText) return joinedOutputText;
    }

    const directText = typeof data.text === 'string' ? data.text : '';
    if (directText) return directText;

    if (isRecord(data.text) && typeof data.text.value === 'string') {
        return data.text.value;
    }

    const nestedResponse = isRecord(data.response) ? data.response : undefined;
    if (nestedResponse) {
        const nestedText = extractResponseText(nestedResponse);
        if (nestedText) return nestedText;
    }

    const output = Array.isArray(data.output) ? data.output : [];
    const parts: string[] = [];
    for (const item of output) {
        if (!isRecord(item) || !Array.isArray(item.content)) continue;
        let itemText = '';
        for (const segment of item.content) {
            if (!isRecord(segment)) continue;
            if (typeof segment.text === 'string') {
                itemText += segment.text;
                continue;
            }
            if (isRecord(segment.text) && typeof segment.text.value === 'string') {
                itemText += segment.text.value;
            }
        }
        if (itemText) parts.push(itemText);
    }

    return parts.join('');
}

export function extractResponseId(data: Record<string, unknown>): string | undefined {
    if (!data) return undefined;
    if (typeof data.response_id === 'string') return data.response_id;
    if (typeof data.id === 'string') return data.id;

    const nestedResponse = isRecord(data.response) ? data.response : undefined;
    if (nestedResponse && typeof nestedResponse.id === 'string') return nestedResponse.id;

    return undefined;
}

export function extractUsage(data: Record<string, unknown>): unknown {
    if (data.usage !== undefined) return data.usage;

    const nestedResponse = isRecord(data.response) ? data.response : undefined;
    return nestedResponse?.usage;
}

async function processSseFrame(
    frame: string,
    onEvent: (eventName: string, dataText: string) => Promise<void>,
): Promise<void> {
    if (!frame.trim()) return;

    let eventName = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split(/\r?\n/)) {
        const line = rawLine.trimEnd();
        if (!line || line.startsWith(':')) continue;

        if (line.startsWith('event:')) {
            eventName = line.slice('event:'.length).trim();
            continue;
        }

        if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart());
        }
    }

    if (dataLines.length === 0) return;
    await onEvent(eventName, dataLines.join('\n'));
}

async function consumeSseStream(
    stream: ReadableStream<Uint8Array>,
    onEvent: (eventName: string, dataText: string) => Promise<void>,
): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

        let boundaryMatch = buffer.match(/\r?\n\r?\n/);
        while (boundaryMatch?.index !== undefined) {
            const frame = buffer.slice(0, boundaryMatch.index);
            buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
            await processSseFrame(frame, onEvent);
            boundaryMatch = buffer.match(/\r?\n\r?\n/);
        }

        if (done) break;
    }

    if (buffer.trim()) {
        await processSseFrame(buffer, onEvent);
    }
}

function formatOpenAiError(status: number, payload: unknown): Error {
    if (isRecord(payload)) {
        const message = isRecord(payload.error) ? payload.error.message : payload.message;
        return new Error(`OpenAI API error: ${status} - ${String(message ?? 'Unknown error')}`);
    }

    return new Error(`OpenAI API error: ${status} - ${String(payload ?? 'Unknown error')}`);
}

export function safeParseLLMJSON<T>(raw: unknown, fallback: T): T {
    try {
        let text = typeof raw === 'string' ? raw : raw ? String(raw) : '';
        if (!text) return fallback;

        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) text = fenced[1];
        text = text.trim();

        if (text.startsWith('```')) {
            text = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
        }

        let toParse = text;
        if (!(text.startsWith('{') && text.endsWith('}'))) {
            const firstBrace = text.indexOf('{');
            const lastBrace = text.lastIndexOf('}');
            if (firstBrace >= 0 && lastBrace >= firstBrace) {
                toParse = text.slice(firstBrace, lastBrace + 1);
            }
        }

        const parsed = tryParseJsonText<T>(toParse);
        if (parsed.success) return parsed.value;

        return repairMalformedJsonText<T>(toParse) ?? fallback;
    } catch {
        return fallback;
    }
}

type JsonTextParseResult<T> =
    | { success: true; value: T }
    | { success: false; error: unknown };

function tryParseJsonText<T>(text: string): JsonTextParseResult<T> {
    try {
        return { success: true, value: JSON.parse(text) as T };
    } catch (error) {
        return { success: false, error };
    }
}

function stripTrailingJsonCommas(text: string): string {
    return text.replace(/,\s*([}\]])/g, '$1');
}

function extractJsonParseErrorPosition(error: unknown): number | null {
    if (!(error instanceof Error)) return null;
    const match = error.message.match(/position (\d+)/i);
    return match ? Number.parseInt(match[1] ?? '', 10) : null;
}

function buildJsonRepairCandidates(text: string, position: number): string[] {
    const candidates = new Set<string>();
    const insertions = [']', '}', ','];

    for (let index = Math.max(0, position - 3); index <= Math.min(text.length, position + 3); index += 1) {
        const currentChar = text[index] ?? '';

        if ('{}[],'.includes(currentChar)) {
            candidates.add(text.slice(0, index) + text.slice(index + 1));
        }

        for (const insertion of insertions) {
            candidates.add(text.slice(0, index) + insertion + text.slice(index));
        }

        if ('{}[]'.includes(currentChar)) {
            for (const replacement of [']', '}', ',']) {
                if (replacement === currentChar) continue;
                candidates.add(text.slice(0, index) + replacement + text.slice(index + 1));
            }
        }
    }

    return Array.from(candidates).map((candidate) => stripTrailingJsonCommas(candidate));
}

function repairMalformedJsonText<T>(text: string): T | undefined {
    if (!text || text.length > 20_000) return undefined;

    const initialCandidate = stripTrailingJsonCommas(text);
    const initialParse = tryParseJsonText<T>(initialCandidate);
    if (initialParse.success) return initialParse.value;

    const queue: Array<{ text: string; depth: number; error: unknown }> = [
        { text: initialCandidate, depth: 0, error: initialParse.error },
    ];
    const visited = new Set<string>([initialCandidate]);
    const maxDepth = 4;
    const maxNodes = 2_000;
    let explored = 0;

    while (queue.length > 0 && explored < maxNodes) {
        const current = queue.shift();
        if (!current) break;
        explored += 1;

        if (current.depth >= maxDepth) continue;

        const errorPosition = extractJsonParseErrorPosition(current.error);
        if (errorPosition === null) continue;

        for (const candidate of buildJsonRepairCandidates(current.text, errorPosition)) {
            if (visited.has(candidate)) continue;
            visited.add(candidate);

            const candidateParse = tryParseJsonText<T>(candidate);
            if (candidateParse.success) return candidateParse.value;

            queue.push({
                text: candidate,
                depth: current.depth + 1,
                error: candidateParse.error,
            });
        }
    }

    return undefined;
}

export function normalizePrompt(prompt: string | readonly string[]): string {
    return Array.isArray(prompt) ? prompt.join('\n') : String(prompt ?? '');
}

export function calculatePromptHash(prompt: string | readonly string[]): string {
    const text = normalizePrompt(prompt);
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function calculateCacheKey(purpose: string, promptHash: string): string {
    return `phx:${purpose}:${promptHash.slice(0, 16)}`;
}


function sanitizeGetFieldFieldExpression(field: unknown): unknown {
    if (typeof field === 'string') {
        return field.startsWith('$') ? { $ifNull: [field, ''] } : field;
    }

    if (isRecord(field)) {
        return '$ifNull' in field ? field : { $ifNull: [field, ''] };
    }

    return '';
}

function normalizeGeneratedQuery(raw: unknown): Record<string, unknown> {
    const fallback: Record<string, unknown> = { base_collection: '', pipeline: [] };
    const parsed = safeParseLLMJSON<Record<string, unknown>>(raw, fallback);
    const generatedQuery = isRecord(parsed) ? { ...parsed } : { ...fallback };
    const baseCollection = typeof generatedQuery.base_collection === 'string' ? generatedQuery.base_collection : '';
    
    // Apply nested sanitization and security whitelisting
    const pipeline = sanitizePipeline(generatedQuery.pipeline);
    try {
        validatePipeline(pipeline);
    } catch (e) {
        console.error('[Security] Pipeline validation failed:', e instanceof Error ? e.message : e);
        return fallback; // Return empty if malicious operators found
    }

    return {
        ...generatedQuery,
        base_collection: baseCollection,
        pipeline,
    };
}

function scoreGeneratedQuery(generatedQuery: Record<string, unknown>): number {
    const baseCollection = typeof generatedQuery.base_collection === 'string' ? generatedQuery.base_collection.trim() : '';
    const pipeline = Array.isArray(generatedQuery.pipeline) ? generatedQuery.pipeline : [];
    return (baseCollection ? 1 : 0) + (pipeline.length > 0 ? 1 : 0);
}

function parseGeneratedQueryResponse(response: PhoenixResponseResult): Record<string, unknown> {
    const contentCandidate = normalizeGeneratedQuery(response.content);
    const rawText = extractResponseTextCandidate(response.raw);
    const rawCandidate = rawText ? normalizeGeneratedQuery(rawText) : { base_collection: '', pipeline: [] };
    const contentScore = scoreGeneratedQuery(contentCandidate);
    const rawScore = scoreGeneratedQuery(rawCandidate);

    if (rawScore === 2 || rawScore > contentScore) {
        return rawCandidate;
    }

    return contentCandidate;
}

function snippetForDebug(value: string, maxLength = 400): string {
    if (value.length <= maxLength) return value;
    const half = Math.max(80, Math.floor(maxLength / 2));
    return `${value.slice(0, half)} … ${value.slice(-half)}`;
}

function summarizeDebugShape(value: unknown, depth = 0): unknown {
    if (depth >= 2) {
        if (Array.isArray(value)) return `[array:${value.length}]`;
        if (isRecord(value)) return `[object:${Object.keys(value).length}]`;
        return value;
    }

    if (typeof value === 'string') {
        return { type: 'string', length: value.length, snippet: snippetForDebug(value, 240) };
    }

    if (Array.isArray(value)) {
        return value.slice(0, 6).map((entry) => summarizeDebugShape(entry, depth + 1));
    }

    if (isRecord(value)) {
        const summary: Record<string, unknown> = {};
        for (const key of Object.keys(value).slice(0, 12)) {
            summary[key] = summarizeDebugShape(Reflect.get(value, key), depth + 1);
        }
        return summary;
    }

    return value;
}

function logMalformedGeneratedQueryDebug(response: PhoenixResponseResult): void {
    const rawText = extractResponseTextCandidate(response.raw);
    const contentCandidate = normalizeGeneratedQuery(response.content);
    const rawCandidate = rawText ? normalizeGeneratedQuery(rawText) : { base_collection: '', pipeline: [] };
    const contentPipeline = Array.isArray(contentCandidate.pipeline) ? contentCandidate.pipeline.length : 0;
    const rawPipeline = Array.isArray(rawCandidate.pipeline) ? rawCandidate.pipeline.length : 0;

    console.error('[PhoenixGenerationDebug] malformed generated query', JSON.stringify({
        contentLength: response.content.length,
        rawTextLength: rawText.length,
        contentScore: scoreGeneratedQuery(contentCandidate),
        rawScore: scoreGeneratedQuery(rawCandidate),
        contentBaseCollection: typeof contentCandidate.base_collection === 'string' ? contentCandidate.base_collection : '',
        rawBaseCollection: typeof rawCandidate.base_collection === 'string' ? rawCandidate.base_collection : '',
        contentPipelineLength: contentPipeline,
        rawPipelineLength: rawPipeline,
        contentSnippet: snippetForDebug(response.content),
        rawTextSnippet: snippetForDebug(rawText),
        rawShape: summarizeDebugShape(response.raw),
    }));
}

function cleanResultsForClient(results: unknown[]): unknown[] {
    return stripPrivateKeys(stripGridFSKeys(results)) as unknown[];
}

type PhoenixEnrichmentDisplayResolver = string | ((doc: Record<string, unknown>) => unknown);

type PhoenixEnrichmentFetchDocuments = (
    collection: string,
    ids: readonly ObjectId[],
    projection: Record<string, 1>,
) => Promise<Array<Record<string, unknown>>>;

type PhoenixEnrichmentFetchFormsByActivityWorkHistoryIds = (
    activityWorkHistoryIds: readonly ObjectId[],
) => Promise<Array<Record<string, unknown>>>;

type PhoenixEnrichmentFetchComponentActivitiesByActivityIds = (
    activityIds: readonly ObjectId[],
) => Promise<Array<Record<string, unknown>>>;

type PhoenixEnrichmentFetchActivityWorkHistoryEventsByActivityWorkHistoryIds = (
    activityWorkHistoryIds: readonly ObjectId[],
) => Promise<Array<Record<string, unknown>>>;

interface PhoenixActivityWorkHistoryAuxiliaryData {
    awhToActivity: ReadonlyMap<string, string>;
    activityToMachinery: ReadonlyMap<string, string>;
    componentByActivity: ReadonlyMap<string, string>;
    compMachById: ReadonlyMap<string, string>;
    machineryNameById: ReadonlyMap<string, unknown>;
    componentNameById: ReadonlyMap<string, unknown>;
    awhHasAttachments: ReadonlyMap<string, boolean>;
}

const OBJECT_ID_HEX_REGEX = /^[a-fA-F0-9]{24}$/;

const LEGACY_ENRICHMENT_MAPPING: Record<string, { collection: string; display: PhoenixEnrichmentDisplayResolver }> = {
    // Core PMS mappings
    activityID: { collection: 'Activity', display: 'description' },
    maintenanceScheduleID: { collection: 'MaintenanceSchedule', display: 'shortName' },
    organizationID: { collection: 'Organization', display: 'orgShortName' },
    componentID: { collection: 'Component', display: 'componentName' },
    machineryID: { collection: 'Machinery', display: 'machineryName' },
    vesselID: { collection: 'Vessel', display: 'vesselName' },
    formTemplateID: { collection: 'FormTemplate', display: 'name' },
    performedBy: { collection: 'User', display: (doc) => doc.firstName && doc.lastName ? `${doc.firstName} ${doc.lastName}` : (doc.email || 'System') },
    fromLocationID: { collection: 'InventoryLocation', display: 'locationName' },
    partID: { collection: 'InventoryPart', display: 'partName' },
    toLocationID: { collection: 'InventoryLocation', display: 'locationName' },
    uploadedBy: { collection: 'User', display: 'email' },
    validatedBy: { collection: 'User', display: 'email' },
    createdBy: { collection: 'User', display: 'email' },
    updatedBy: { collection: 'User', display: 'email' },
    approvedBy: { collection: 'User', display: 'email' },
    documentMetadataID: {
        collection: 'DocumentMetadata',
        display: (doc) => doc.originalFileName ?? doc.documentName ?? 'Unnamed Document',
    },
    documentTypeID: {
        collection: 'DocumentType',
        display: (doc) => doc.typeName ?? doc.name ?? 'Unspecified Type',
    },
    // Exhaustive registry additions (ported from PhoenixAI)
    crewMemberID: { collection: 'CrewMember', display: (doc) => doc.firstName && doc.lastName ? `${doc.firstName} ${doc.lastName}` : doc.email },
    assignedTo: { collection: 'User', display: 'email' },
    workflowStatusID: { collection: 'WorkflowStatus', display: 'statusName' },
    shiftPatternID: { collection: 'ShiftPattern', display: 'patternName' },
    voyageID: { collection: 'Voyage', display: 'voyageNumber' },
    portID: { collection: 'Port', display: 'portName' },
    countryID: { collection: 'Country', display: 'countryName' },
    currencyID: { collection: 'Currency', display: 'currencyCode' },
    costCenterID: { collection: 'CostCenter', display: 'name' },
    budgetID: { collection: 'Budget', display: 'name' },
    accountCodeID: { collection: 'AccountCode', display: 'code' },
    requisitionID: { collection: 'Requisition', display: 'requisitionNo' },
    purchaseOrderID: { collection: 'PurchaseOrder', display: 'poNumber' },
    invoiceID: { collection: 'Invoice', display: 'invoiceNo' },
    vendorID: { collection: 'Vendor', display: 'vendorName' },
};

const COLLECTION_ALIAS = new Map<string, string>([
    ['form', 'forms'],
    ['forms', 'forms'],
    ['activityworkhistory', 'ActivityWorkHistory'],
    ['activityworkhistoryevent', 'ActivityWorkHistoryEvent'],
    ['inventorylocation', 'InventoryLocation'],
    ['inventorypart', 'InventoryPart'],
    ['documentmetadata', 'DocumentMetadata'],
    ['documenttype', 'DocumentType'],
    ['maintenanceschedule', 'MaintenanceSchedule'],
]);

const DISPLAY_BY_COLLECTION = new Map<string, PhoenixEnrichmentDisplayResolver>();
for (const { collection, display } of Object.values(LEGACY_ENRICHMENT_MAPPING)) {
    if (!DISPLAY_BY_COLLECTION.has(collection)) {
        DISPLAY_BY_COLLECTION.set(collection, display);
    }
}
DISPLAY_BY_COLLECTION.set('forms', 'name');

function toObjectIdString(value: unknown): string | null {
    if (value instanceof ObjectId) {
        return value.toHexString();
    }

    const normalized = typeof value === 'string'
        ? value
        : value === null || value === undefined
            ? ''
            : String(value);
    return OBJECT_ID_HEX_REGEX.test(normalized) ? normalized : null;
}

function canonicalizeCollectionToken(token: string): string | null {
    const normalized = token.trim();
    if (!normalized) return null;

    const alias = COLLECTION_ALIAS.get(normalized.toLowerCase());
    if (alias) return alias;
    if (normalized.toLowerCase().includes('activityworkhistoryevent')) return 'ActivityWorkHistoryEvent';
    if (normalized.toLowerCase().includes('activityworkhistory')) return 'ActivityWorkHistory';
    if (/[A-Z]/.test(normalized)) return normalized;
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function collectionFromIdKey(key: string): string | null {
    const mapped = LEGACY_ENRICHMENT_MAPPING[key];
    if (mapped) return mapped.collection;

    const match = key.match(/^([A-Za-z][A-Za-z0-9]*)_ID$/);
    return match?.[1] ? canonicalizeCollectionToken(match[1]) : null;
}

function entityKeyForCollection(collection: string): string {
    return collection.charAt(0).toLowerCase() + collection.slice(1) + 'Id';
}

function entityKeyForIdField(key: string, collection: string): string {
    if (LEGACY_ENRICHMENT_MAPPING[key]) {
        return key.endsWith('ID') ? key.replace(/ID$/, 'Id') : key;
    }

    return entityKeyForCollection(collection);
}

function physicalCollectionName(collection: string): string {
    switch (collection) {
        case 'Form': return 'forms';
        default: return collection;
    }
}

function buildProjection(display: PhoenixEnrichmentDisplayResolver): Record<string, 1> {
    if (typeof display === 'string') {
        return { [display]: 1, organizationID: 1 };
    }

    return {
        organizationID: 1,
        originalFileName: 1,
        documentName: 1,
        typeName: 1,
        name: 1,
        email: 1,
    };
}

function resolveDisplayValue(display: PhoenixEnrichmentDisplayResolver, doc: Record<string, unknown>): unknown {
    if (typeof display === 'function') {
        return display(doc);
    }

    return doc[display];
}

function ensureSourceMeta(row: Record<string, unknown>): { sourceMeta: Record<string, unknown>; entities: Record<string, unknown> } {
    const sourceMeta = isPlainObject(row.sourceMeta) ? row.sourceMeta : {};
    const entities = isPlainObject(sourceMeta.entities) ? sourceMeta.entities : {};
    sourceMeta.entities = entities;
    row.sourceMeta = sourceMeta;
    return { sourceMeta, entities };
}

function addIdsToCollection(collections: Map<string, Set<string>>, collection: string, value: unknown): void {
    if (Array.isArray(value)) {
        for (const item of value) addIdsToCollection(collections, collection, item);
        return;
    }

    const normalized = toObjectIdString(value);
    if (!normalized) return;
    if (!collections.has(collection)) collections.set(collection, new Set());
    collections.get(collection)?.add(normalized);
}

function getSourceMetaActivityWorkHistoryId(value: unknown): string | null {
    if (!isPlainObject(value) || !isPlainObject(value.sourceMeta) || !isPlainObject(value.sourceMeta.entities)) {
        return null;
    }

    return toObjectIdString(value.sourceMeta.entities.activityWorkHistoryId);
}

function collectActivityWorkHistoryIdsFromSourceMeta(value: unknown, collections: Map<string, Set<string>>): void {
    if (Array.isArray(value)) {
        for (const item of value) collectActivityWorkHistoryIdsFromSourceMeta(item, collections);
        return;
    }

    if (!isPlainObject(value)) return;

    addIdsToCollection(collections, 'ActivityWorkHistory', getSourceMetaActivityWorkHistoryId(value));

    for (const nested of Object.values(value)) {
        collectActivityWorkHistoryIdsFromSourceMeta(nested, collections);
    }
}

function setTypeFromSourceMeta(row: Record<string, unknown>): void {
    if (typeof row.type === 'string' && row.type.length > 0) return;
    if (!isPlainObject(row.sourceMeta) || !isPlainObject(row.sourceMeta.entities)) return;

    const entities = row.sourceMeta.entities;
    if (entities.documentMetadataId) row.type = 'document';
    else if (entities.formId) row.type = 'form';
    else if (entities.activityWorkHistoryEventId) row.type = 'activity-work-history-event';
    else if (entities.activityWorkHistoryId) row.type = 'activity-work-history';
}

async function defaultEnrichmentFetchDocuments(
    collection: string,
    ids: readonly ObjectId[],
    projection: Record<string, 1>,
): Promise<Array<Record<string, unknown>>> {
    const db = await connectQueryMongo();
    return db.collection(physicalCollectionName(collection))
        .find({ _id: { $in: [...ids] } })
        .project(projection)
        .toArray() as Promise<Array<Record<string, unknown>>>;
}

async function defaultEnrichmentFetchFormsByActivityWorkHistoryIds(
    activityWorkHistoryIds: readonly ObjectId[],
): Promise<Array<Record<string, unknown>>> {
    if (activityWorkHistoryIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection('forms')
        .find({
            activityWorkHistoryID: { $in: [...activityWorkHistoryIds] },
        })
        .project({
            _id: 1,
            organizationID: 1,
            activityWorkHistoryID: 1,
            formTemplateID: 1,
            name: 1,
            status: 1,
            submittedAt: 1,
            committedAt: 1,
        })
        .toArray() as Promise<Array<Record<string, unknown>>>;
}

async function defaultEnrichmentFetchComponentActivitiesByActivityIds(
    activityIds: readonly ObjectId[],
): Promise<Array<Record<string, unknown>>> {
    if (activityIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection('ComponentActivity')
        .find({
            activityIDs: { $in: [...activityIds] },
        })
        .project({
            activityIDs: 1,
            componentID: 1,
        })
        .toArray() as Promise<Array<Record<string, unknown>>>;
}

async function defaultEnrichmentFetchActivityWorkHistoryEventsByActivityWorkHistoryIds(
    activityWorkHistoryIds: readonly ObjectId[],
): Promise<Array<Record<string, unknown>>> {
    if (activityWorkHistoryIds.length === 0) {
        return [];
    }

    const db = await connectQueryMongo();

    return db
        .collection('ActivityWorkHistoryEvent')
        .find({
            activityWorkHistoryID: { $in: [...activityWorkHistoryIds] },
        })
        .project({
            activityWorkHistoryID: 1,
            documents: 1,
            files: 1,
            attachments: 1,
            documentIDs: 1,
        })
        .toArray() as Promise<Array<Record<string, unknown>>>;
}

function activityWorkHistoryEventHasAttachments(event: Record<string, unknown>): boolean {
    return ['documents', 'files', 'attachments', 'documentIDs']
        .some((key) => Array.isArray(event[key]) && event[key].length > 0);
}

function mapMinimalValidatedForm(
    form: Record<string, unknown>,
    fallbackOrganizationId: string | null,
): Record<string, unknown> | null {
    const formId = toObjectIdString(form._id);
    const formTemplateId = toObjectIdString(form.formTemplateID);
    if (!formTemplateId) {
        return null;
    }

    const sourceMeta: Record<string, unknown> = {
        entities: {
            formTemplateId,
            ...(formId ? { formId } : {}),
        },
    };

    const organizationId = toObjectIdString(form.organizationID) ?? fallbackOrganizationId;
    if (organizationId) {
        sourceMeta.organizationID = organizationId;
    }

    return {
        formTemplateID: formTemplateId,
        validatedAt: form.committedAt ?? form.submittedAt ?? null,
        ...(formId ? { _id: formId } : {}),
        ...(typeof form.name === 'string' ? { name: form.name } : {}),
        ...(typeof form.status === 'string' ? { status: form.status } : {}),
        sourceMeta,
    };
}

async function enrichActivityWorkHistoryValidatedForms(
    results: unknown[],
    fetchDocuments: PhoenixEnrichmentFetchDocuments,
    fetchFormsByActivityWorkHistoryIds: PhoenixEnrichmentFetchFormsByActivityWorkHistoryIds,
    awhOrganizationById: ReadonlyMap<string, string>,
): Promise<void> {
    const rows: Array<Record<string, unknown>> = [];
    const collectRows = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) collectRows(item);
            return;
        }

        if (!isPlainObject(value)) return;

        if (getSourceMetaActivityWorkHistoryId(value)) {
            rows.push(value);
        }

        for (const nested of Object.values(value)) {
            collectRows(nested);
        }
    };

    collectRows(results);
    if (rows.length === 0) {
        return;
    }

    const activityWorkHistoryIds = Array.from(new Set(
        rows
            .map((row) => getSourceMetaActivityWorkHistoryId(row))
            .filter((id): id is string => id !== null),
    ));
    if (activityWorkHistoryIds.length === 0) {
        return;
    }

    const formDocs = await fetchFormsByActivityWorkHistoryIds(activityWorkHistoryIds.map((id) => new ObjectId(id)));
    const formsByParent = new Map<string, Array<Record<string, unknown>>>();
    const templateIds = new Set<string>();

    for (const form of formDocs) {
        const awhId = toObjectIdString(form.activityWorkHistoryID);
        const formTemplateId = toObjectIdString(form.formTemplateID);
        if (!awhId || !formTemplateId) {
            continue;
        }

        templateIds.add(formTemplateId);
        const bucket = formsByParent.get(awhId);
        if (bucket) bucket.push(form);
        else formsByParent.set(awhId, [form]);
    }

    const templateDocs = templateIds.size > 0
        ? await fetchDocuments('FormTemplate', [...templateIds].map((id) => new ObjectId(id)), {
            name: 1,
            description: 1,
            sections: 1,
            fields: 1,
        })
        : [];
    const templateById = new Map<string, Record<string, unknown>>();
    for (const template of templateDocs) {
        const templateId = toObjectIdString(template._id);
        if (!templateId) continue;
        templateById.set(templateId, template);
    }

    const formByAwhAndTemplate = new Map<string, Record<string, unknown>>();
    for (const form of formDocs) {
        const awhId = toObjectIdString(form.activityWorkHistoryID);
        const templateId = toObjectIdString(form.formTemplateID);
        if (!awhId || !templateId) continue;
        formByAwhAndTemplate.set(`${awhId}:${templateId}`, form);
    }

    for (const row of rows) {
        const awhId = getSourceMetaActivityWorkHistoryId(row);
        if (!awhId) continue;

        const rowSourceMeta = ensureSourceMeta(row).sourceMeta;
        const fallbackOrganizationId = toObjectIdString(rowSourceMeta.organizationID) ?? awhOrganizationById.get(awhId) ?? null;

        if (!Array.isArray(row.validatedForms)) {
            const minimalForms = (formsByParent.get(awhId) ?? [])
                .map((form) => mapMinimalValidatedForm(form, fallbackOrganizationId))
                .filter((form): form is Record<string, unknown> => form !== null);

            if (minimalForms.length > 0) {
                row.validatedForms = minimalForms;
                row.awh_hasForms = true;
            } else if (row.awh_hasForms !== false) {
                row.awh_hasForms = false;
            }
        }

        if (!Array.isArray(row.validatedForms)) {
            continue;
        }

        for (const validatedForm of row.validatedForms) {
            if (!isPlainObject(validatedForm)) continue;

            const { sourceMeta, entities } = ensureSourceMeta(validatedForm);
            const templateId = toObjectIdString(entities.formTemplateId ?? validatedForm.formTemplateID);
            if (!templateId) continue;

            entities.formTemplateId = templateId;
            const matchingForm = formByAwhAndTemplate.get(`${awhId}:${templateId}`);
            const template = templateById.get(templateId);

            if (matchingForm) {
                const formId = toObjectIdString(matchingForm._id);
                if (formId) {
                    validatedForm._id = formId;
                    entities.formId = formId;
                }
                if (typeof matchingForm.name === 'string' && matchingForm.name.length > 0) {
                    validatedForm.name = matchingForm.name;
                }
                if (typeof matchingForm.status === 'string') {
                    validatedForm.status = matchingForm.status;
                }
                if (matchingForm.submittedAt !== undefined) {
                    validatedForm.submittedAt = matchingForm.submittedAt;
                }
                if (matchingForm.committedAt !== undefined) {
                    validatedForm.committedAt = matchingForm.committedAt;
                }

                const organizationId = toObjectIdString(matchingForm.organizationID) ?? fallbackOrganizationId;
                if (organizationId && !sourceMeta.organizationID) {
                    sourceMeta.organizationID = organizationId;
                }
            }

            if (template) {
                if (typeof template.name === 'string' && template.name.length > 0) {
                    validatedForm.formTemplateID = template.name;
                    if (typeof validatedForm.name !== 'string' || validatedForm.name.length === 0) {
                        validatedForm.name = template.name;
                    }
                }

                validatedForm.templateSnapshot = {
                    ...(typeof template.name === 'string' ? { name: template.name } : {}),
                    ...(template.description !== undefined ? { description: template.description } : {}),
                    sections: Array.isArray(template.sections) ? template.sections : [],
                    fields: Array.isArray(template.fields) ? template.fields : [],
                };
            }
        }
    }
}

function attachActivityWorkHistoryAuxiliaryFields(
    value: unknown,
    auxiliary: PhoenixActivityWorkHistoryAuxiliaryData,
): void {
    if (Array.isArray(value)) {
        for (const item of value) {
            attachActivityWorkHistoryAuxiliaryFields(item, auxiliary);
        }
        return;
    }

    if (!isPlainObject(value)) {
        return;
    }

    const awhId = getSourceMetaActivityWorkHistoryId(value);
    if (awhId) {
        const activityId = auxiliary.awhToActivity.get(awhId);
        let machineryId = activityId ? auxiliary.activityToMachinery.get(activityId) : undefined;
        const componentId = activityId ? auxiliary.componentByActivity.get(activityId) : undefined;

        if (!machineryId && componentId) {
            machineryId = auxiliary.compMachById.get(componentId);
        }

        const machineryName = machineryId ? auxiliary.machineryNameById.get(machineryId) : undefined;
        const componentName = componentId ? auxiliary.componentNameById.get(componentId) : undefined;

        if (machineryName !== undefined && value.machinery_ID === undefined) {
            value.machinery_ID = machineryName;
        }
        if (componentName !== undefined && value.component_ID === undefined) {
            value.component_ID = componentName;
        }
        if (value.awh_hasAttachments === undefined) {
            value.awh_hasAttachments = auxiliary.awhHasAttachments.get(awhId) === true;
        }
    }

    for (const nested of Object.values(value)) {
        attachActivityWorkHistoryAuxiliaryFields(nested, auxiliary);
    }
}

/**
 * Cleans Mongo results, extracts a dynamic schema map, and formats as JSONL.
 * Ported and enhanced for token efficiency and schema "warm-up".
 */
export function prepareMongoForLLM(data: any[]) {
    if (!Array.isArray(data)) return { schemaHint: '[]', jsonlData: '' };

    // 1. Prune empty values to save tokens
    const pruneEmpty = (obj: any): any => {
        if (obj === null || obj === undefined) return undefined;
        if (Array.isArray(obj)) {
            const filtered = obj.map(pruneEmpty).filter((val) => val !== undefined);
            return filtered.length > 0 ? filtered : undefined;
        }
        if (typeof obj === 'object') {
            const prunedObj: Record<string, any> = {};
            for (const [key, value] of Object.entries(obj)) {
                const prunedVal = pruneEmpty(value);
                if (prunedVal !== undefined) prunedObj[key] = prunedVal;
            }
            return Object.keys(prunedObj).length > 0 ? prunedObj : undefined;
        }
        return obj;
    };

    // 2. Extract deep keys for the Schema Hint with basic type info
    const extractKeys = (obj: any, prefix = ''): string[] => {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return [];
        return Object.keys(obj).flatMap((k) => {
            const value = obj[k];
            const fullPath = prefix ? `${prefix}.${k}` : k;
            
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return [fullPath, ...extractKeys(value, fullPath)];
            }
            
            // Add basic type hint
            const type = value === null ? 'null' : Array.isArray(value) ? 'Array' : typeof value;
            return [`${fullPath}:${type}`];
        });
    };

    const cleanedData = data.map(pruneEmpty).filter(Boolean);

    // 3. Generate the Schema Hint and JSONL
    // Depth-first unique keys
    const allKeys = Array.from(new Set(cleanedData.flatMap((doc) => extractKeys(doc))));
    const schemaHint = `[${allKeys.join(', ')}]`;
    const jsonlData = cleanedData.map((doc) => JSON.stringify(doc)).join('\n');

    return { schemaHint, jsonlData };
}

export async function enrichHumanReadableResults(
    results: unknown[],
    fetchDocuments: PhoenixEnrichmentFetchDocuments = defaultEnrichmentFetchDocuments,
    fetchFormsByActivityWorkHistoryIds: PhoenixEnrichmentFetchFormsByActivityWorkHistoryIds = defaultEnrichmentFetchFormsByActivityWorkHistoryIds,
    fetchComponentActivitiesByActivityIds?: PhoenixEnrichmentFetchComponentActivitiesByActivityIds,
    fetchActivityWorkHistoryEventsByActivityWorkHistoryIds?: PhoenixEnrichmentFetchActivityWorkHistoryEventsByActivityWorkHistoryIds,
): Promise<unknown[]> {
    if (!Array.isArray(results) || results.length === 0) {
        return results;
    }

    try {
        const fetchComponentActivities: PhoenixEnrichmentFetchComponentActivitiesByActivityIds = fetchComponentActivitiesByActivityIds
            ?? (fetchDocuments === defaultEnrichmentFetchDocuments
                ? defaultEnrichmentFetchComponentActivitiesByActivityIds
                : async () => []);
        const fetchActivityWorkHistoryEvents: PhoenixEnrichmentFetchActivityWorkHistoryEventsByActivityWorkHistoryIds = fetchActivityWorkHistoryEventsByActivityWorkHistoryIds
            ?? (fetchDocuments === defaultEnrichmentFetchDocuments
                ? defaultEnrichmentFetchActivityWorkHistoryEventsByActivityWorkHistoryIds
                : async () => []);
        const idsByCollection = new Map<string, Set<string>>();

        const collectIds = (value: unknown, inMeta = false): void => {
            if (Array.isArray(value)) {
                for (const item of value) collectIds(item, inMeta);
                return;
            }

            if (!isPlainObject(value)) return;

            for (const [key, nested] of Object.entries(value)) {
                if (!inMeta) {
                    const collection = collectionFromIdKey(key);
                    if (collection) addIdsToCollection(idsByCollection, collection, nested);
                }

                collectIds(nested, inMeta || key === 'sourceMeta');
            }
        };

        collectIds(results);
        collectActivityWorkHistoryIdsFromSourceMeta(results, idsByCollection);

        const displayByCollection = new Map<string, Map<string, unknown>>();
        const docsByCollection = new Map<string, Map<string, Record<string, unknown>>>();
        const awhDisplayById = new Map<string, unknown>();
        const awhOrganizationById = new Map<string, string>();
        const awhToActivity = new Map<string, string>();
        const activityToMachinery = new Map<string, string>();
        const componentByActivity = new Map<string, string>();
        const compMachById = new Map<string, string>();
        const machineryNameById = new Map<string, unknown>();
        const componentNameById = new Map<string, unknown>();
        const awhHasAttachments = new Map<string, boolean>();
        const activityWorkHistoryIds = [...(idsByCollection.get('ActivityWorkHistory') ?? new Set<string>())]
            .map((id) => new ObjectId(id));

        if (activityWorkHistoryIds.length > 0) {
            const awhDocs = await fetchDocuments('ActivityWorkHistory', activityWorkHistoryIds, {
                activityID: 1,
                organizationID: 1,
            });
            const activityIds = [...new Set(
                awhDocs
                    .map((doc) => toObjectIdString(doc.activityID))
                    .filter((value): value is string => value !== null),
            )].map((id) => new ObjectId(id));
            const activityDocs = activityIds.length > 0
                ? await fetchDocuments('Activity', activityIds, { description: 1, activityName: 1, organizationID: 1, machineryID: 1 })
                : [];
            const activityById = new Map<string, Record<string, unknown>>();

            for (const doc of activityDocs) {
                const id = toObjectIdString(doc._id);
                if (!id) continue;
                activityById.set(id, doc);

                const machineryId = toObjectIdString(doc.machineryID);
                if (machineryId) {
                    activityToMachinery.set(id, machineryId);
                }
            }

            const componentActivityDocs = activityIds.length > 0
                ? await fetchComponentActivities(activityIds)
                : [];

            for (const componentActivity of componentActivityDocs) {
                const componentId = toObjectIdString(componentActivity.componentID);
                if (!componentId || !Array.isArray(componentActivity.activityIDs)) {
                    continue;
                }

                for (const rawActivityId of componentActivity.activityIDs) {
                    const activityId = toObjectIdString(rawActivityId);
                    if (!activityId || componentByActivity.has(activityId)) {
                        continue;
                    }
                    componentByActivity.set(activityId, componentId);
                }
            }

            const componentIds = [...new Set(componentByActivity.values())]
                .map((id) => new ObjectId(id));
            const componentDocs = componentIds.length > 0
                ? await fetchDocuments('Component', componentIds, { componentName: 1, machineryID: 1 })
                : [];

            for (const doc of componentDocs) {
                const id = toObjectIdString(doc._id);
                if (!id) continue;

                if (doc.componentName !== undefined) {
                    componentNameById.set(id, doc.componentName);
                }

                const machineryId = toObjectIdString(doc.machineryID);
                if (machineryId) {
                    compMachById.set(id, machineryId);
                }
            }

            const machineryIds = [...new Set([
                ...activityToMachinery.values(),
                ...compMachById.values(),
            ])].map((id) => new ObjectId(id));
            const machineryDocs = machineryIds.length > 0
                ? await fetchDocuments('Machinery', machineryIds, { machineryName: 1 })
                : [];

            for (const doc of machineryDocs) {
                const id = toObjectIdString(doc._id);
                if (!id) continue;

                if (doc.machineryName !== undefined) {
                    machineryNameById.set(id, doc.machineryName);
                }
            }

            for (const doc of awhDocs) {
                const awhId = toObjectIdString(doc._id);
                if (!awhId) continue;

                const activityId = toObjectIdString(doc.activityID);
                if (activityId) {
                    awhToActivity.set(awhId, activityId);
                }

                const activityDoc = activityId ? activityById.get(activityId) : undefined;
                const display = activityDoc?.description ?? activityDoc?.activityName;
                if (display !== undefined) {
                    awhDisplayById.set(awhId, display);
                }

                const orgId = toObjectIdString(doc.organizationID) ?? toObjectIdString(activityDoc?.organizationID);
                if (orgId) {
                    awhOrganizationById.set(awhId, orgId);
                }
            }

            const activityWorkHistoryEventDocs = await fetchActivityWorkHistoryEvents(activityWorkHistoryIds);
            for (const eventDoc of activityWorkHistoryEventDocs) {
                const awhId = toObjectIdString(eventDoc.activityWorkHistoryID);
                if (!awhId || !activityWorkHistoryEventHasAttachments(eventDoc)) {
                    continue;
                }

                awhHasAttachments.set(awhId, true);
            }
        }

        for (const [collection, ids] of idsByCollection.entries()) {
            if (collection === 'ActivityWorkHistory') continue;

            const display = DISPLAY_BY_COLLECTION.get(collection);
            if (!display || ids.size === 0) continue;

            const docs = await fetchDocuments(
                collection,
                [...ids].map((id) => new ObjectId(id)),
                buildProjection(display),
            );
            const displayMap = new Map<string, unknown>();
            const docMap = new Map<string, Record<string, unknown>>();

            for (const doc of docs) {
                const id = toObjectIdString(doc._id);
                if (!id) continue;

                docMap.set(id, doc);
                const displayValue = resolveDisplayValue(display, doc);
                if (displayValue !== undefined) {
                    displayMap.set(id, displayValue);
                }
            }

            displayByCollection.set(collection, displayMap);
            docsByCollection.set(collection, docMap);
        }

        const replace = (value: unknown, inMeta = false): void => {
            if (Array.isArray(value)) {
                for (const item of value) replace(item, inMeta);
                return;
            }

            if (!isPlainObject(value)) return;

            for (const [key, nested] of Object.entries(value)) {
                if (!inMeta) {
                    const collection = collectionFromIdKey(key);
                    if (collection) {
                        const entityKey = entityKeyForIdField(key, collection);
                        const transformOne = (candidate: unknown): unknown => {
                            const id = toObjectIdString(candidate);
                            if (!id) return candidate;

                            const { sourceMeta, entities } = ensureSourceMeta(value);
                            entities[entityKey] = id;

                            if (collection === 'ActivityWorkHistory') {
                                const orgId = awhOrganizationById.get(id);
                                if (!sourceMeta.organizationID && orgId) {
                                    sourceMeta.organizationID = orgId;
                                }
                                return awhDisplayById.get(id) ?? candidate;
                            }

                            if (collection === 'Organization' && !sourceMeta.organizationID) {
                                sourceMeta.organizationID = id;
                            }

                            const doc = docsByCollection.get(collection)?.get(id);
                            const derivedOrgId = toObjectIdString(doc?.organizationID);
                            if (!sourceMeta.organizationID && derivedOrgId) {
                                sourceMeta.organizationID = derivedOrgId;
                            }

                            return displayByCollection.get(collection)?.get(id) ?? candidate;
                        };

                        value[key] = Array.isArray(nested) ? nested.map(transformOne) : transformOne(nested);
                    }
                }

                replace(value[key], inMeta || key === 'sourceMeta');
            }

            if (!inMeta) {
                setTypeFromSourceMeta(value);
            }
        };

        replace(results);
        attachActivityWorkHistoryAuxiliaryFields(results, {
            awhToActivity,
            activityToMachinery,
            componentByActivity,
            compMachById,
            machineryNameById,
            componentNameById,
            awhHasAttachments,
        });
        await enrichActivityWorkHistoryValidatedForms(
            results,
            fetchDocuments,
            fetchFormsByActivityWorkHistoryIds,
            awhOrganizationById,
        );
        return results;
    } catch {
        return results;
    }
}

export function buildIntentCandidatesFromRag(rag: PhoenixRetrievalResult, maxCandidates = 12): PhoenixIntentCandidate[] {
    const mapping = [...rag.mapping_rules].sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, maxCandidates);
    const byIntent = new Map<string, PhoenixIntentCandidate>();

    for (const item of mapping) {
        const intent = String(item.metadata.intent ?? '');
        const canonicalId = String(item.metadata.canonicalId ?? '');
        if (!intent || !canonicalId) continue;

        const key = intent.toLowerCase();
        const existing = byIntent.get(key);
        const candidate: PhoenixIntentCandidate = { intent, canonicalId, score: item.score };
        if (!existing || (candidate.score || 0) > (existing.score || 0)) {
            byIntent.set(key, candidate);
        }
    }

    return Array.from(byIntent.values());
}

export function simpleSelectIntentsFallback(candidates: readonly PhoenixIntentCandidate[]): PhoenixSelectedIntent[] {
    return [...candidates]
        .sort((left, right) => (right.score || 0) - (left.score || 0))
        .slice(0, 3)
        .map(({ intent, canonicalId }) => ({ intent, canonicalId }));
}

export async function resolveCollectionsFromSelected(selected: readonly PhoenixSelectedIntent[]): Promise<PhoenixResolvedCollections> {
    const mongoUri = process.env.MONGODB_ATLAS_URI || '';
    const dbName = process.env.MONGODB_ATLAS_DB_NAME || 'pms_rag';
    if (!mongoUri) return { targetCollections: [], perIntent: [] };

    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
        const canonicalCollection = client.db(dbName).collection('canonical');
        const targetCollections = new Set<string>();
        const perIntent: PhoenixResolvedCollections['perIntent'] = [];

        for (const selection of selected) {
            if (!ObjectId.isValid(selection.canonicalId)) continue;

            const doc = await canonicalCollection.findOne({ _id: new ObjectId(selection.canonicalId) });
            const payload = isRecord(doc) && Array.isArray(doc.payload) ? doc.payload : [];
            const collections = new Set<string>();

            for (const entry of payload) {
                if (!isRecord(entry) || String(entry.intent ?? '').toLowerCase() !== selection.intent.toLowerCase()) continue;
                const mapsTo = Array.isArray(entry.maps_to) ? entry.maps_to : [];
                for (const mapping of mapsTo) {
                    if (!isRecord(mapping)) continue;
                    const collection = String(mapping.collection ?? '').trim();
                    if (!collection) continue;
                    collections.add(collection);
                    targetCollections.add(collection);
                }
            }

            perIntent.push({
                intent: selection.intent,
                canonicalId: selection.canonicalId,
                collections: Array.from(collections),
            });
        }

        return { targetCollections: Array.from(targetCollections), perIntent };
    } finally {
        await client.close();
    }
}

export function resolveCollectionsFromSelectedQdrant(
    selected: readonly PhoenixSelectedIntent[],
    mappingRules: readonly PhoenixRetrievedItem[] = [],
): PhoenixResolvedCollections {
    const targetCollections = new Set<string>();
    const perIntent: PhoenixResolvedCollections['perIntent'] = [];

    for (const selection of selected) {
        const intent = selection.intent.toLowerCase();
        if (!intent) continue;

        const collections = new Set<string>();
        for (const rule of mappingRules) {
            if (String(rule.metadata.intent ?? '').toLowerCase() !== intent) continue;

            const mapsTo = Array.isArray(rule.metadata.maps_to) ? rule.metadata.maps_to : [];
            for (const mapping of mapsTo) {
                if (!isRecord(mapping)) continue;
                const collection = String(mapping.collection ?? '').trim();
                if (!collection) continue;
                collections.add(collection);
                targetCollections.add(collection);
            }

            const fallbackCollections = Array.isArray(rule.metadata.target_collections) ? rule.metadata.target_collections : [];
            for (const collection of fallbackCollections) {
                const normalized = String(collection).trim();
                if (!normalized) continue;
                collections.add(normalized);
                targetCollections.add(normalized);
            }
        }

        perIntent.push({
            intent: selection.intent,
            collections: Array.from(collections),
        });
    }

    return { targetCollections: Array.from(targetCollections), perIntent };
}

let schemaCache: Promise<PhoenixCollectionSchemaEntry[]> | null = null;

export async function loadPmsCollectionsVectorSchema(): Promise<PhoenixCollectionSchemaEntry[]> {
    if (!schemaCache) {
        schemaCache = readFile(new URL('../../../seed/pms_collections_vector_schema.json', import.meta.url), 'utf8')
            .then((content) => JSON.parse(content) as unknown)
            .then((value) => {
                if (!Array.isArray(value)) return [];
                return value
                    .filter((item): item is PhoenixCollectionSchemaEntry => isRecord(item) && typeof item.CollectionName === 'string')
                    .map((item) => {
                        if (item.CollectionName === 'Form') {
                            return {
                                ...item,
                                CollectionName: 'forms',
                                Description: typeof item.Description === 'string' 
                                    ? item.Description.replace(/Form(?!Template|Sequence)/g, 'forms') 
                                    : item.Description
                            };
                        }
                        return item;
                    });
            });
    }

    return schemaCache;
}

function extractCollectionNamesFromPayload(payload: unknown): string[] {
    if (!isRecord(payload)) return [];

    const candidates = [payload.collectionName, payload.CollectionName, payload.collection];
    return candidates
        .map((value) => String(value ?? '').trim())
        .filter((value, index, array) => value.length > 0 && array.indexOf(value) === index);
}

async function resolveCollectionsFromKeywordsVectorQdrant(keywords: readonly string[]): Promise<string[]> {
    const terms = Array.from(new Set(keywords.map((keyword) => String(keyword).trim()).filter((keyword) => keyword.length > 0)));
    if (terms.length === 0) return [];

    const { OpenAIEmbeddings } = await import('@langchain/openai');
    const { QdrantClient } = await import('@qdrant/js-client-rest');
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const qdrantApiKey = process.env.QDRANT_API_KEY || undefined;
    const collectionName = process.env.INDEX_NAME_PMS_COLLECTIONS || 'pms_collections_vector_index';
    const topK = Number(process.env.RAG_TOPK || 8);
    const embeddings = new OpenAIEmbeddings({
        model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
    });
    const client = new QdrantClient({
        url: qdrantUrl,
        ...(qdrantApiKey ? { apiKey: qdrantApiKey } : {}),
    });
    const resolved = new Set<string>();

    for (const term of terms) {
        const vector = await embeddings.embedQuery(term.toLowerCase());
        const searchResults = await client.search(collectionName, {
            vector,
            limit: Math.min(topK, 5),
            with_payload: true,
        });

        for (const hit of searchResults) {
            for (const collection of extractCollectionNamesFromPayload(hit.payload)) {
                resolved.add(collection);
            }
        }
    }

    return Array.from(resolved);
}

async function resolveCollectionsFromKeywordsVectorMongoDB(keywords: readonly string[]): Promise<string[]> {
    const mongoUri = process.env.MONGODB_ATLAS_URI || '';
    if (!mongoUri) return [];

    const terms = Array.from(new Set(keywords.map((keyword) => String(keyword).trim()).filter((keyword) => keyword.length > 0)));
    if (terms.length === 0) return [];

    const dbName = process.env.MONGODB_ATLAS_DB_NAME || 'pms_rag';
    const collectionName = process.env.INDEX_NAME_PMS_COLLECTIONS || 'pms_collections_vector_index';
    const indexName = process.env.INDEX_NAME_PMS_COLLECTIONS || 'pms_collections_vector_index';
    const topK = Number(process.env.RAG_TOPK || 8);
    const client = new MongoClient(mongoUri);
    await client.connect();

    try {
        const collection = client.db(dbName).collection(collectionName);
        const { OpenAIEmbeddings } = await import('@langchain/openai');
        const { MongoDBAtlasVectorSearch } = await import('@langchain/mongodb');
        const embeddings = new OpenAIEmbeddings({
            model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small',
        });
        const vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
            collection: collection as never,
            indexName,
            textKey: 'text',
            embeddingKey: 'embedding',
        });
        const resolved = new Set<string>();

        for (const term of terms) {
            const hits = await vectorStore.similaritySearchWithScore(term.toLowerCase(), Math.min(topK, 5));
            for (const [doc] of hits as unknown as Array<[Record<string, unknown>, number]>) {
                for (const collectionNameValue of extractCollectionNamesFromPayload(doc.metadata)) {
                    resolved.add(collectionNameValue);
                }
            }
        }

        return Array.from(resolved);
    } finally {
        await client.close();
    }
}

async function resolveCollectionsFromKeywordsVector(keywords: readonly string[]): Promise<string[]> {
    return process.env.USE_QDRANT_VECTOR_DB === 'true'
        ? resolveCollectionsFromKeywordsVectorQdrant(keywords)
        : resolveCollectionsFromKeywordsVectorMongoDB(keywords);
}

function matchKeywordsToSchemaCollections(keywords: readonly string[], schema: readonly PhoenixCollectionSchemaEntry[]): string[] {
    const matched = new Set<string>();
    for (const keyword of keywords) {
        const needle = keyword.toLowerCase();
        const schemaMatch = schema.find((entry) => entry.CollectionName.toLowerCase() === needle);
        if (schemaMatch) matched.add(schemaMatch.CollectionName);
    }
    return Array.from(matched);
}

export function narrowSchemaForAmbiguity(
    schema: readonly PhoenixCollectionSchemaEntry[],
    rag: PhoenixRetrievalResult,
    extractedKeywords: readonly string[],
): PhoenixCollectionSchemaEntry[] {
    const ragCollections = new Set<string>();

    for (const rule of rag.mapping_rules) {
        const targetCollections = Array.isArray(rule.metadata.target_collections) ? rule.metadata.target_collections : [];
        for (const collection of targetCollections) ragCollections.add(String(collection));

        const mapsTo = Array.isArray(rule.metadata.maps_to) ? rule.metadata.maps_to : [];
        for (const mapping of mapsTo) {
            if (!isRecord(mapping)) continue;
            const collection = String(mapping.collection ?? '').trim();
            if (collection) ragCollections.add(collection);
        }
    }

    for (const collection of ['Organization', 'User']) ragCollections.add(collection);
    for (const match of matchKeywordsToSchemaCollections(extractedKeywords, schema)) ragCollections.add(match);

    const proximityMap: Record<string, string[]> = {
        Budget: ['BudgetCode', 'BudgetAllocation', 'BudgetTransaction', 'BudgetAuditLog', 'BudgetAllocationAuditLog'],
        ActivityWorkHistory: ['ActivityWorkHistoryAuditLog', 'DocumentFile', 'SearchableTag'],
        PurchaseOrder: ['PurchaseOrderAuditLog', 'PurchaseOrderLineItem', 'ReplenishOrder'],
        CrewMember: ['CrewAssignment', 'CrewCompetencySignal', 'WorkRestRecord'],
    };

    for (const collection of Array.from(ragCollections)) {
        for (const cousin of proximityMap[collection] ?? []) {
            if (schema.some((entry) => entry.CollectionName === cousin)) ragCollections.add(cousin);
        }
    }

    for (const collection of ['Organization', 'User', 'Vessel', 'VesselMachinery', 'DocumentType', 'SfiCode']) {
        ragCollections.add(collection);
    }

    const narrowed = schema.filter((entry) => ragCollections.has(entry.CollectionName));
    return narrowed.length > 0 ? narrowed : [...schema];
}

function buildTechnicalFallbackCollections(items: readonly PhoenixRetrievedItem[]): string[] {
    return Array.from(new Set(items
        .map((item) => String(item.metadata.collection ?? '').trim())
        .filter((collection) => collection.length > 0)));
}

function applyTargetCollectionHeuristics(
    normalizedRequest: string,
    baseCollections: readonly string[],
    ambiguityKeywords: readonly string[],
    schema: readonly PhoenixCollectionSchemaEntry[],
): string[] {
    const collections = new Set<string>(baseCollections);
    for (const collection of matchKeywordsToSchemaCollections(ambiguityKeywords, schema)) {
        collections.add(collection);
    }

    if (/\btag\w*/i.test(normalizedRequest)) collections.add('SearchableTag');
    if (/\bform\w*/i.test(normalizedRequest)) {
        collections.add('FormTemplate');
        collections.add('forms');
    }
    if (collections.has('ActivityWorkHistory')) {
        collections.add('FormTemplateActivityMapping');
        collections.add('FormTemplateVesselMapping');
    }
    if (/\bdocument\s*type\b/i.test(normalizedRequest) || /\bdocument\w*/i.test(normalizedRequest)) {
        collections.add('DocumentMetadata');
        collections.add('DocumentType');
        collections.add('DocumentFile');
    }
    collections.add('User');

    return Array.from(collections).filter((collection) => !/^(vendor|role)$/i.test(collection));
}

function getKeywordExtractorPrompt(): string {
    const parsed = safeParseLLMJSON<{ system_prompt?: unknown }>(KEYWORD_EXTRACTOR_SYSTEM_PROMPT, {});
    return typeof parsed.system_prompt === 'string' ? parsed.system_prompt : KEYWORD_EXTRACTOR_SYSTEM_PROMPT;
}

function getQueryGenerationPrompt(): string {
    return normalizePrompt(QUERY_GENERATION_SYSTEM_PROMPT);
}

async function executePipelineConsoleNormalized(
    baseCollection: string,
    pipeline: readonly Record<string, unknown>[],
): Promise<{ results: unknown[]; resultCount: number; executionTimeMs: number }> {
    const physicalBase = physicalCollectionName(baseCollection);
    
    // Deep security and hygiene (ported from PhoenixAI)
    const sanitized = sanitizePipeline(pipeline);
    validatePipeline(sanitized as Record<string, unknown>[]);

    const connection = await connectQueryMongo();
    if (!connection) throw new Error('Mongo connection not ready');

    const coll = connection.collection(physicalBase);
    const t0 = Date.now();
    const results = await coll.aggregate(sanitized, { allowDiskUse: true }).toArray();
    const dt = Date.now() - t0;
    
    // Result hygiene (strip technical keys)
    const cleanResults = cleanResultsForClient(results);

    return { results: cleanResults, resultCount: cleanResults.length, executionTimeMs: dt };
}

function shouldRetryOnEmptyResults(): boolean {
    const value = String(process.env.PHOENIX_RETRY_ON_EMPTY_RESULTS ?? process.env.PHX_RETRY_ON_EMPTY_RESULTS ?? '').toLowerCase();
    return ['1', 'true', 'yes', 'on'].includes(value);
}

export function createOpenAiResponseClient(): PhoenixResponseClient {
    return {
        provider: 'openai',
        async createResponse({ messages, purpose = 'default', previousResponseId, onStreamEvent }) {
            const apiKey = process.env.OPENAI_API_KEY;
            if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is required');

            const selectedModel = selectOpenAiResponseModel(purpose);
            const systemInstructions = messages
                .filter((message) => message.role.toLowerCase() === 'system')
                .map((message) => message.content)
                .join('\n\n');
            const userInput = messages
                .filter((message) => message.role.toLowerCase() !== 'system')
                .map((message) => message.content)
                .join('\n\n');
            const input = [];

            if (systemInstructions) input.push({ role: 'system', content: [{ type: 'input_text', text: systemInstructions }] });
            if (userInput) input.push({ role: 'user', content: [{ type: 'input_text', text: userInput }] });

            const cacheKey = calculateCacheKey(purpose, calculatePromptHash(systemInstructions));
            const requestBody = {
                model: selectedModel,
                input,
                reasoning: { effort: resolveOpenAiReasoningEffort(purpose) },
                ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
                prompt_cache_key: cacheKey,
            };

            console.log(`[phx-client] Request: purpose=${purpose}, model=${selectedModel}, cacheKey=${cacheKey}, prevId=${previousResponseId || 'none'}`);

            if (onStreamEvent) {
                const response = await fetch('https://api.openai.com/v1/responses', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ ...requestBody, stream: true }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    try {
                        throw formatOpenAiError(response.status, JSON.parse(errorText) as unknown);
                    } catch (error) {
                        if (error instanceof Error && error.message.startsWith('OpenAI API error:')) throw error;
                        throw formatOpenAiError(response.status, errorText);
                    }
                }

                if (!response.body) {
                    throw new Error('OpenAI API stream closed without a response body');
                }

                let content = '';
                let usage: unknown;
                let raw: unknown;
                let responseId: string | undefined;
                let sequence = 0;
                let completionEmitted = false;

                await onStreamEvent({
                    kind: 'start',
                    provider: 'openai',
                    purpose,
                    model: selectedModel,
                    rawType: 'request.created',
                    ...(previousResponseId ? { raw: { previousResponseId } } : {}),
                });

                await consumeSseStream(response.body, async (eventName, dataText) => {
                    if (dataText === '[DONE]') return;

                    let payload: unknown = dataText;
                    try {
                        payload = JSON.parse(dataText) as unknown;
                    } catch {
                        payload = dataText;
                    }

                    if (!isRecord(payload)) {
                        return;
                    }

                    const rawType = typeof payload.type === 'string' ? payload.type : eventName;
                    responseId = extractResponseId(payload) ?? responseId;
                    const nextUsage = extractUsage(payload);
                    if (nextUsage !== undefined) usage = nextUsage;

                    if (rawType === 'error') {
                        throw formatOpenAiError(response.status, payload);
                    }

                    if (rawType === 'response.output_text.delta') {
                        const delta = typeof payload.delta === 'string' ? payload.delta : '';
                        if (!delta) return;

                        sequence += 1;
                        content += delta;
                        await onStreamEvent({
                            kind: 'delta',
                            provider: 'openai',
                            purpose,
                            model: selectedModel,
                            rawType,
                            delta,
                            sequence,
                            ...(responseId ? { responseId } : {}),
                            raw: payload,
                        });
                        return;
                    }

                    if (rawType === 'response.output_text.done') {
                        const finalText = extractResponseText(payload);
                        if (finalText) {
                            content = finalText;
                        }
                        return;
                    }

                    if (rawType === 'response.completed') {
                        raw = isRecord(payload.response) ? payload.response : payload;
                        const finalText = extractResponseText(payload);
                        if (finalText) {
                            content = finalText;
                        }

                        completionEmitted = true;
                        await onStreamEvent({
                            kind: 'complete',
                            provider: 'openai',
                            purpose,
                            model: selectedModel,
                            rawType,
                            text: content,
                            ...(responseId ? { responseId } : {}),
                            ...(usage !== undefined ? { usage } : {}),
                            raw: payload,
                        });
                    }
                });

                if (!completionEmitted) {
                    await onStreamEvent({
                        kind: 'complete',
                        provider: 'openai',
                        purpose,
                        model: selectedModel,
                        rawType: 'stream.closed',
                        text: content,
                        ...(responseId ? { responseId } : {}),
                        ...(usage !== undefined ? { usage } : {}),
                        raw,
                    });
                }

                return { content, usage, raw: raw ?? { streamed: true, responseId } };
            }

            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            const data = await response.json() as Record<string, unknown>;
            if (!response.ok) {
                console.error(`[phx-client] Error: status=${response.status}, error=${JSON.stringify(data)}`);
                throw formatOpenAiError(response.status, data);
            }

            const responseId = extractResponseId(data);
            console.log(`[phx-client] Response: status=${response.status}, responseId=${responseId || 'unknown'}`);
            return { content: extractResponseText(data), usage: data.usage, raw: data };

        },
    };
}

function buildFallbackConversation(startedConversation: PhoenixConversation, patch: PhoenixConversationPatch): PhoenixServiceResult {
    const merged = Object.fromEntries(Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== undefined));
    return {
        ...startedConversation,
        ...merged,
        conversationId: startedConversation.conversationId,
    };
}

function toServiceResult(conversation: PhoenixConversation): PhoenixServiceResult {
    return {
        ...(conversation as unknown as Record<string, unknown>),
        conversationId: conversation.conversationId,
        ...(conversation.resolvedQuery !== undefined ? { resolvedQuery: conversation.resolvedQuery } : {}),
    };
}

async function runPhoenixQuery(
    input: PhoenixQueryExecutionInput,
    dependencies: PhoenixRuntimeExecutorDependencies,
    onEvent?: PhoenixStreamEmitter,
): Promise<PhoenixServiceResult> {
    const responseClient = dependencies.responseClient ?? createOpenAiResponseClient();
    const retrieveGroupedChunks = dependencies.retrieveGroupedChunks ?? retrieveChunksGrouped;
    const loadSchema = dependencies.loadSchema ?? loadPmsCollectionsVectorSchema;
    const resolveKeywordCollections = dependencies.resolveCollectionsFromKeywordsVector ?? resolveCollectionsFromKeywordsVector;
    const executePipeline = dependencies.executePipeline ?? executePipelineConsoleNormalized;
    const uploadResults = dependencies.uploadResults ?? uploadJSONToGridFS;
    const enrichResults = dependencies.enrichResults ?? enrichHumanReadableResults;
    const { userQuery, startedConversation } = input;

    await emitStatus(onEvent, 'keywords', 'Extracting Phoenix keywords');
    let extractedKeywords: string[] = [];
    try {
        const keywordPrompt = getKeywordExtractorPrompt();
        // Use a static global key for provider prefix caching
        const keywordCacheKey = 'skylark:keyword_extraction:v1';
        const keywordPromptHash = calculatePromptHash(keywordPrompt);

        const keywordStreamEmitter = createRuntimeLlmEmitter(onEvent, { stage: 'keyword_extraction' });
        const keywordResponse = await responseClient.createResponse({
            messages: [
                { role: 'system', content: keywordPrompt },
                { role: 'user', content: userQuery },
            ],
            purpose: 'keyword_extraction',
            ...(keywordStreamEmitter ? { onStreamEvent: keywordStreamEmitter } : {}),
        });

        const keywordResponseId = extractResponseId(keywordResponse.raw as Record<string, unknown>);
        if (keywordResponseId) {
            await saveStaticCachedResponseId(keywordCacheKey, keywordResponseId, keywordPromptHash, 'keyword_extraction', '[DirectQuery-phx-cache]');
        }

        const keywordJson = safeParseLLMJSON<{ keywords?: unknown }>(keywordResponse.content, {});
        extractedKeywords = Array.isArray(keywordJson.keywords)
            ? keywordJson.keywords.map((keyword) => String(keyword).trim()).filter((keyword) => keyword.length > 0)
            : [];
    } catch {
        extractedKeywords = [];
    }

    await emitStatus(onEvent, 'retrieval', 'Retrieving Phoenix RAG context');
    const rag = await retrieveGroupedChunks(userQuery, extractedKeywords);
    const schema = await loadSchema();
    const narrowedSchema = narrowSchemaForAmbiguity(schema, rag, extractedKeywords);

    await emitStatus(onEvent, 'ambiguity', 'Resolving ambiguity against narrowed schema');
    const ambiguityModel = selectOpenAiResponseModel('ambiguity');
    const ambiguityStaticPrompt = AMBIGUITY_RESOLVER_SYSTEM_PROMPT;
    const ambiguityDynamicContext = `Injected schema:\n${JSON.stringify(narrowedSchema)}`;
    
    // Use a static global key for provider prefix caching
    const ambiguityCacheKey = 'skylark:ambiguity:v1';
    const ambiguityPromptHash = calculatePromptHash(ambiguityStaticPrompt);
    
    const ambiguityStreamEmitter = createRuntimeLlmEmitter(onEvent, { stage: 'ambiguity' });
    const ambiguityResponse = await responseClient.createResponse({
        messages: [
            { role: 'system', content: ambiguityStaticPrompt },
            { role: 'system', content: ambiguityDynamicContext },
            { role: 'user', content: JSON.stringify({ user_query: userQuery }) },
        ],
        purpose: 'ambiguity',
        ...(ambiguityStreamEmitter ? { onStreamEvent: ambiguityStreamEmitter } : {}),
    });

    const ambiguityResponseId = extractResponseId(ambiguityResponse.raw as Record<string, unknown>);
    // We still save to our internal registry for technical tracking, but provider caching is the goal.
    if (ambiguityResponseId) {
        await saveStaticCachedResponseId(ambiguityCacheKey, ambiguityResponseId, ambiguityPromptHash, 'ambiguity', '[DirectQuery-phx-cache]');
    }

    let ambiguityJson = safeParseLLMJSON<Record<string, unknown>>(ambiguityResponse.content, {
        is_ambiguous: false,
        normalized_request: userQuery,
    });

    if (!isRecord(ambiguityJson)) {
        ambiguityJson = { is_ambiguous: false, normalized_request: userQuery };
    }

    const normalizedRequest = typeof ambiguityJson.normalized_request === 'string' && ambiguityJson.normalized_request.length > 0
        ? ambiguityJson.normalized_request
        : userQuery;

    if (ambiguityJson.is_ambiguous === true) {
        const patch: PhoenixConversationPatch = {
            status: 'ambiguous',
            clarifyingQuestions: Array.isArray(ambiguityJson.clarifying_questions) ? ambiguityJson.clarifying_questions : [],
            assumptions: Array.isArray(ambiguityJson.suggestions) ? ambiguityJson.suggestions : [],
            resolvedQuery: normalizedRequest,
            ambiguityDetails: ambiguityJson, // Include the full JSON as requested
        };
        
        await emitResult(onEvent, patch);
        
        const updated = await dependencies.updateConversation(startedConversation.conversationId, patch);
        return updated ? toServiceResult(updated) : buildFallbackConversation(startedConversation, patch);
    }

    const selectedIntents = simpleSelectIntentsFallback(buildIntentCandidatesFromRag(rag, 12));
    const resolvedCollections = process.env.USE_QDRANT_VECTOR_DB === 'true'
        ? resolveCollectionsFromSelectedQdrant(selectedIntents, rag.mapping_rules)
        : await resolveCollectionsFromSelected(selectedIntents);
    const ambiguityKeywords = Array.isArray(ambiguityJson.keywords)
        ? ambiguityJson.keywords.map((keyword) => String(keyword).trim()).filter((keyword) => keyword.length > 0)
        : [];
    let keywordResolvedCollections: string[] = [];
    try {
        keywordResolvedCollections = await resolveKeywordCollections(ambiguityKeywords);
    } catch {
        keywordResolvedCollections = [];
    }
    const baseCollections = resolvedCollections.targetCollections.length > 0
        ? resolvedCollections.targetCollections
        : buildTechnicalFallbackCollections(rag.technical_structure_fields);
    const targetCollections = applyTargetCollectionHeuristics(
        normalizedRequest,
        Array.from(new Set([...baseCollections, ...keywordResolvedCollections])),
        ambiguityKeywords,
        schema,
    );
    const businessContext = dedupByCanonical(rag.business_context);
    const preparedExecutionMetadata = {
        stage: 'prepared',
        extractedKeywords,
        ambiguityKeywords,
        keywordResolvedCollections,
        narrowedSchemaCount: narrowedSchema.length,
        rag: {
            businessContextCount: rag.business_context.length,
            businessContextDedupedCount: businessContext.length,
            technicalFieldCount: rag.technical_structure_fields.length,
            domainLogicCount: rag.domain_logic_rules.length,
            mappingRuleCount: rag.mapping_rules.length,
            allowedFieldsWhitelist: rag.allowed_fields_whitelist,
        },
    };
    const processingPatch: PhoenixConversationPatch = {
        status: 'processing',
        resolvedQuery: normalizedRequest,
        selectedIntents,
        targetCollections,
        executionMetadata: preparedExecutionMetadata,
    };

    await dependencies.updateConversation(startedConversation.conversationId, processingPatch);
    const preparedMetadataBase = preparedExecutionMetadata;
    const maxRetries = 1;
    const retryOnEmptyResults = shouldRetryOnEmptyResults();
    let retryCount = 0;
    let baseCollection = '';
    let generatedQuery: Record<string, unknown> = {
        base_collection: '',
        pipeline: [],
    };

    try {
        let results: unknown[] = [];
        let resultCount = 0;
        let executionTimeMs = 0;

        while (retryCount <= maxRetries) {
            const attempt = retryCount + 1;

            await emitStatus(
                onEvent,
                'generation',
                retryCount === 0 ? 'Generating Phoenix Mongo pipeline' : 'Re-analyzing Phoenix query after retry condition',
                { messageKey: retryCount === 0 ? 'status.generating_query' : 'status.re_analyzing', attempt },
            );

            const generationModel = selectOpenAiResponseModel('generation');
            const generationStaticPrompt = getQueryGenerationPrompt();
            const generationDynamicContext = JSON.stringify({
                user_query: normalizedRequest,
                business_context_snippet: '', // TODO: Inject business context if needed
                collections: narrowedSchema, // Using narrowedSchema as collections info
            });

            // Use a static global key for provider prefix caching
            const generationCacheKey = 'skylark:query_generation:v1';
            const generationPromptHash = calculatePromptHash(generationStaticPrompt);

            const generationStreamEmitter = createRuntimeLlmEmitter(onEvent, { stage: 'generation', attempt });
            const generationResponse = await responseClient.createResponse({
                messages: [
                    { role: 'system', content: generationStaticPrompt },
                    { role: 'user', content: generationDynamicContext },
                ],
                purpose: 'generation',
                ...(generationStreamEmitter ? { onStreamEvent: generationStreamEmitter } : {}),
            });

            const generationResponseId = extractResponseId(generationResponse.raw as Record<string, unknown>);
            if (generationResponseId) {
                // saveStaticCachedResponseId ensures 30-day TTL for static key tracking
                await saveStaticCachedResponseId(generationCacheKey, generationResponseId, generationPromptHash, 'generation', '[DirectQuery-phx-cache]');
            }

            generatedQuery = parseGeneratedQueryResponse(generationResponse);

            baseCollection = typeof generatedQuery.base_collection === 'string' ? generatedQuery.base_collection : '';
            const sanitizedPipeline = Array.isArray(generatedQuery.pipeline) ? generatedQuery.pipeline : [];

            if (!baseCollection || sanitizedPipeline.length === 0) {
                if (retryCount < maxRetries) {
                    retryCount += 1;
                    continue;
                }

                logMalformedGeneratedQueryDebug(generationResponse);
                throw new Error('MALFORMED_LLM_QUERY_JSON');
            }

            await emitStatus(onEvent, 'execute', 'Executing generated Phoenix query', {
                messageKey: 'status.executing_query',
                attempt,
            });

            let execution: { results: unknown[]; resultCount: number; executionTimeMs: number };
            try {
                execution = await executePipeline(baseCollection, sanitizedPipeline);
            } catch (error) {
                if (retryCount < maxRetries) {
                    retryCount += 1;
                    continue;
                }

                throw error;
            }

            if (retryOnEmptyResults && execution.results.length === 0 && retryCount < maxRetries) {
                retryCount += 1;
                continue;
            }

            await emitStatus(onEvent, 'execute', 'Enriching Phoenix query results', {
                messageKey: 'status.enriching_results',
                attempt,
            });
            const enrichedResults = await enrichResults(execution.results);
            results = Array.isArray(enrichedResults) ? enrichedResults : execution.results;
            resultCount = execution.resultCount;
            executionTimeMs = execution.executionTimeMs;

            break;
        }

        const cleanedResults = cleanResultsForClient(results);
        const dualViewConfig = detectDualViewOpportunity(cleanedResults, baseCollection);
        let resultsRef: PhoenixConversationPatch['resultsRef'] | undefined;

        try {
            const upload = await uploadResults(
                cleanedResults,
                `phoenix_results_${startedConversation.conversationId}.json`,
                {
                    conversationId: String(startedConversation.conversationId),
                    role: 'results',
                },
                'fs',
            );

            resultsRef = {
                gridFSFileId: upload.fileId,
                filename: upload.filename,
                contentType: upload.contentType,
                bucketName: upload.bucketName,
                storedAt: new Date(),
            };
        } catch {
            resultsRef = undefined;
        }

        const completedPatch: PhoenixConversationPatch = {
            status: 'completed',
            resolvedQuery: normalizedRequest,
            selectedIntents,
            generatedQuery,
            targetCollections,
            ...(resultsRef === undefined ? {} : { resultsRef }),
            executionMetadata: {
                ...preparedMetadataBase,
                stage: 'completed',
                resultCount,
                executionTimeMs,
            },
            ...(dualViewConfig.available ? { dualViewConfig } : {}),
        };

        const completedConversation = await dependencies.updateConversation(startedConversation.conversationId, completedPatch);
        const completedResult: PhoenixServiceResult = {
            ...(completedConversation ? toServiceResult(completedConversation) : buildFallbackConversation(startedConversation, completedPatch)),
            results: cleanedResults,
            ...(dualViewConfig.available ? { dualViewConfig } : {}),
        };

        if (onEvent) {
            await onEvent({ event: 'result', data: completedResult });
            await onEvent({ event: 'end', data: { ok: true } });
        }

        return completedResult;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const errorPatch: PhoenixConversationPatch = {
            status: 'error',
            resolvedQuery: normalizedRequest,
            selectedIntents,
            generatedQuery,
            targetCollections,
            executionMetadata: {
                ...preparedMetadataBase,
                stage: 'error',
                error: message,
                attempts: retryCount + 1,
            },
        };

        await dependencies.updateConversation(startedConversation.conversationId, errorPatch);
        throw error;
    }
}

export function createPhoenixRuntimeExecutor(dependencies: PhoenixRuntimeExecutorDependencies) {
    return {
        async executeQuery(input: PhoenixQueryExecutionInput): Promise<PhoenixServiceResult> {
            return runPhoenixQuery(input, dependencies);
        },
        async executeQueryStream(input: PhoenixQueryStreamExecutionInput): Promise<PhoenixServiceResult> {
            return runPhoenixQuery(input, dependencies, input.onEvent);
        },
    };
}