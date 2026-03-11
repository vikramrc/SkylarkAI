import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupByCanonical, type PhoenixRetrievalResult } from '../retrieval/index.js';
import {
    buildIntentCandidatesFromRag,
    createOpenAiResponseClient,
    createPhoenixRuntimeExecutor,
    enrichHumanReadableResults,
    narrowSchemaForAmbiguity,
    resolveCollectionsFromSelectedQdrant,
    safeParseLLMJSON,
    sanitizePipeline,
    type PhoenixCollectionSchemaEntry,
    type PhoenixResponseClient,
} from './executor.js';

function makeConversation() {
    return {
        conversationId: '507f1f77bcf86cd799439011',
        userQuery: 'show overdue maintenance',
        originalQuery: 'show overdue maintenance',
        isPinned: false,
        deleted: false,
    };
}

function makeRagResult(): PhoenixRetrievalResult {
    return {
        business_context: [
            { text: 'bc-1', score: 0.7, metadata: { canonicalId: 'canon-1', intent: 'overdue activities' } },
            { text: 'bc-2', score: 0.9, metadata: { canonicalId: 'canon-1', intent: 'overdue activities' } },
        ],
        technical_structure_fields: [
            { text: 'field-1', score: 0.8, metadata: { collection: 'ActivityWorkHistory', field_path: 'activityId' } },
        ],
        domain_logic_rules: [],
        mapping_rules: [
            {
                text: 'map-1',
                score: 0.9,
                metadata: {
                    intent: 'overdue activities',
                    canonicalId: '507f1f77bcf86cd799439012',
                    target_collections: ['ActivityWorkHistory'],
                    maps_to: [{ collection: 'ActivityWorkHistory' }],
                },
            },
            {
                text: 'map-2',
                score: 0.5,
                metadata: {
                    intent: 'overdue activities',
                    canonicalId: '507f1f77bcf86cd799439013',
                    target_collections: ['Form'],
                    maps_to: [{ collection: 'Form' }],
                },
            },
        ],
        vector_hits: [],
        allowed_fields_whitelist: ['activityId'],
    };
}

const schema: PhoenixCollectionSchemaEntry[] = [
    { CollectionName: 'ActivityWorkHistory' },
    { CollectionName: 'ActivityWorkHistoryAuditLog' },
    { CollectionName: 'DocumentFile' },
    { CollectionName: 'SearchableTag' },
    { CollectionName: 'Organization' },
    { CollectionName: 'User' },
    { CollectionName: 'Vessel' },
    { CollectionName: 'VesselMachinery' },
    { CollectionName: 'DocumentType' },
    { CollectionName: 'SfiCode' },
    { CollectionName: 'FormTemplateActivityMapping' },
    { CollectionName: 'FormTemplateVesselMapping' },
];

test('safeParseLLMJSON handles fenced JSON responses', () => {
    const parsed = safeParseLLMJSON('```json\n{"keywords":["overdue maintenance"]}\n```', { keywords: [] as string[] });
    assert.deepEqual(parsed, { keywords: ['overdue maintenance'] });
});

test('safeParseLLMJSON repairs near-valid generated query JSON with nested bracket noise', () => {
    const validQuery = {
        base_collection: 'DocumentMetadata',
        pipeline: [{
            $addFields: {
                resolvedFieldName: {
                    $let: {
                        vars: {
                            expiryMatches: {
                                $filter: {
                                    input: [],
                                    as: 'f',
                                    cond: { $and: [{ $eq: [1, 1] }, { $or: [{ $eq: [2, 2] }, { $eq: [3, 3] }] }] },
                                },
                            },
                            validMatches: {
                                $filter: {
                                    input: [],
                                    as: 'f',
                                    cond: { $and: [{ $eq: [4, 4] }, { $or: [{ $eq: [5, 5] }, { $eq: [6, 6] }] }] },
                                },
                            },
                        },
                        in: null,
                    },
                },
            },
        }],
    };
    const malformed = JSON.stringify(validQuery).replace('"vars":{"expiryMatches"', '"vars":{}"expiryMatches"');
    assert.notEqual(malformed, JSON.stringify(validQuery));
    assert.throws(() => JSON.parse(malformed));

    const parsed = safeParseLLMJSON<Record<string, unknown>>(malformed, { base_collection: '', pipeline: [] });

    assert.deepEqual(parsed, validQuery);
});

test('createOpenAiResponseClient joins segmented finalized output text without injecting newlines', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    const previousQueryModel = process.env.OPENAI_QUERY_MODEL;
    const previousFetch = globalThis.fetch;
    const finalText = '{"base_collection":"DocumentMetadata","pipeline":[{"$match":{"documentName":{"$regex":"certificate","$options":"i"}}}]}';
    const splitIndex = finalText.indexOf('Name');
    const responsePayload = {
        id: 'resp_segmented',
        output: [{
            content: [
                { type: 'output_text', text: finalText.slice(0, splitIndex) },
                { type: 'output_text', text: finalText.slice(splitIndex) },
            ],
        }],
        usage: { total_tokens: 21 },
    };

    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_QUERY_MODEL = 'gpt-5.4';
    globalThis.fetch = (async () => new Response(JSON.stringify(responsePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    })) as typeof fetch;

    try {
        const client = createOpenAiResponseClient();
        const result = await client.createResponse({
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'user prompt' },
            ],
            purpose: 'generation',
        });

        assert.equal(result.content, finalText);
        assert.deepEqual(result.raw, responsePayload);
    } finally {
        globalThis.fetch = previousFetch;
        if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousApiKey;
        if (previousQueryModel === undefined) delete process.env.OPENAI_QUERY_MODEL;
        else process.env.OPENAI_QUERY_MODEL = previousQueryModel;
    }
});

test('sanitizePipeline drops invalid limits and recursively normalizes nested pipelines', () => {
    const sanitized = sanitizePipeline([
        { $match: { status: 'open' } },
        { $limit: 0 },
        { $skip: -5 },
        {
            $facet: {
                forms: [
                    { $limit: -1 },
                    { $skip: 'bad' },
                    { $match: { archived: false } },
                ],
            },
        },
        {
            $lookup: {
                from: 'activities',
                as: 'activity',
                pipeline: [
                    { $limit: -3 },
                    { $skip: -2 },
                    { $match: { active: true } },
                ],
            },
        },
        {
            $unionWith: {
                coll: 'forms',
                pipeline: [
                    { $limit: 3 },
                ],
            },
        },
    ]);

    assert.deepEqual(sanitized, [
        { $match: { status: 'open' } },
        { $skip: 0 },
        {
            $facet: {
                forms: [
                    { $skip: 0 },
                    { $match: { archived: false } },
                ],
            },
        },
        {
            $lookup: {
                from: 'activities',
                as: 'activity',
                pipeline: [
                    { $skip: 0 },
                    { $match: { active: true } },
                ],
            },
        },
        {
            $unionWith: {
                coll: 'forms',
                pipeline: [
                    { $limit: 3 },
                ],
            },
        },
    ]);
});

test('sanitizePipeline guards nested dynamic $getField field expressions that can resolve to missing', () => {
    const sanitized = sanitizePipeline([
        {
            $addFields: {
                resolvedExpiryRaw: {
                    $cond: [
                        { $ne: ['$resolvedFieldName', null] },
                        {
                            $getField: {
                                field: '$resolvedFieldName',
                                input: '$customMetadata',
                            },
                        },
                        null,
                    ],
                },
            },
        },
    ]);

    assert.deepEqual(sanitized, [
        {
            $addFields: {
                resolvedExpiryRaw: {
                    $cond: [
                        { $ne: ['$resolvedFieldName', null] },
                        {
                            $getField: {
                                field: { $ifNull: ['$resolvedFieldName', ''] },
                                input: '$customMetadata',
                            },
                        },
                        null,
                    ],
                },
            },
        },
    ]);
});

test('enrichHumanReadableResults replaces bounded ids with labels while preserving canonical ids and organization context', async () => {
    const awhId = '507f1f77bcf86cd799439099';
    const activityId = '507f1f77bcf86cd799439055';
    const orgId = '507f1f77bcf86cd799439077';
    const formId = '507f1f77bcf86cd799439066';
    const results = [
        { title: 'Row A', activityWorkHistory_ID: awhId },
        { title: 'Row B', Form_ID: formId },
        { title: 'Row C', organizationID: orgId },
    ];
    const fetchCalls: Array<{ collection: string; ids: string[]; projection: Record<string, 1> }> = [];

    const enriched = await enrichHumanReadableResults(results, async (collection, ids, projection) => {
        fetchCalls.push({ collection, ids: ids.map((id) => id.toHexString()), projection });

        switch (collection) {
            case 'ActivityWorkHistory':
                return [{ _id: awhId, activityID: activityId, organizationID: orgId }];
            case 'Activity':
                return [{ _id: activityId, description: 'Overdue pump maintenance', organizationID: orgId }];
            case 'Form':
                return [{ _id: formId, name: 'Permit To Work' }];
            case 'Organization':
                return [{ _id: orgId, orgShortName: 'Atlas Marine' }];
            default:
                return [];
        }
    }, async () => []);

    assert.deepEqual(enriched, [
        {
            title: 'Row A',
            activityWorkHistory_ID: 'Overdue pump maintenance',
            sourceMeta: {
                entities: {
                    activityWorkHistoryId: awhId,
                },
                organizationID: orgId,
            },
            type: 'activity-work-history',
            awh_hasAttachments: false,
            awh_hasForms: false,
        },
        {
            title: 'Row B',
            Form_ID: 'Permit To Work',
            sourceMeta: {
                entities: {
                    formId: formId,
                },
            },
            type: 'form',
        },
        {
            title: 'Row C',
            organizationID: 'Atlas Marine',
            sourceMeta: {
                entities: {
                    organizationId: orgId,
                },
                organizationID: orgId,
            },
        },
    ]);
    assert.deepEqual(fetchCalls, [
        {
            collection: 'ActivityWorkHistory',
            ids: [awhId],
            projection: { activityID: 1, organizationID: 1 },
        },
        {
            collection: 'Activity',
            ids: [activityId],
            projection: { description: 1, activityName: 1, organizationID: 1, machineryID: 1 },
        },
        {
            collection: 'Form',
            ids: [formId],
            projection: { name: 1, organizationID: 1 },
        },
        {
            collection: 'Organization',
            ids: [orgId],
            projection: { orgShortName: 1, organizationID: 1 },
        },
    ]);
});

test('enrichHumanReadableResults falls back to original results when fetch fails', async () => {
    const results = [{ title: 'Row A', activityWorkHistory_ID: '507f1f77bcf86cd799439099' }];

    const enriched = await enrichHumanReadableResults(results, async () => {
        throw new Error('Mongo unavailable');
    });

    assert.equal(enriched, results);
    assert.deepEqual(enriched, [{ title: 'Row A', activityWorkHistory_ID: '507f1f77bcf86cd799439099' }]);
});

test('enrichHumanReadableResults backfills and enriches AWH validatedForms with form and template metadata', async () => {
    const awhId = '507f1f77bcf86cd799439099';
    const activityId = '507f1f77bcf86cd799439055';
    const orgId = '507f1f77bcf86cd799439077';
    const formId = '507f1f77bcf86cd799439066';
    const templateId = '507f1f77bcf86cd799439088';
    const submittedAt = '2026-03-10T00:00:00.000Z';
    const committedAt = '2026-03-11T00:00:00.000Z';
    const templateSections = [{ id: 'section-1', name: 'Checks' }];
    const templateFields = [{ id: 'field-1', label: 'Pressure' }];
    const results = [{ title: 'Row A', activityWorkHistory_ID: awhId }];
    const fetchCalls: Array<{ collection: string; ids: string[]; projection: Record<string, 1> }> = [];
    const formFetchCalls: string[][] = [];

    const enriched = await enrichHumanReadableResults(
        results,
        async (collection, ids, projection) => {
            fetchCalls.push({ collection, ids: ids.map((id) => id.toHexString()), projection });

            switch (collection) {
                case 'ActivityWorkHistory':
                    return [{ _id: awhId, activityID: activityId, organizationID: orgId }];
                case 'Activity':
                    return [{ _id: activityId, description: 'Overdue pump maintenance', organizationID: orgId }];
                case 'FormTemplate':
                    return [{
                        _id: templateId,
                        name: 'PTW Template',
                        description: 'Template description',
                        sections: templateSections,
                        fields: templateFields,
                    }];
                default:
                    return [];
            }
        },
        async (activityWorkHistoryIds) => {
            formFetchCalls.push(activityWorkHistoryIds.map((id) => id.toHexString()));
            return [{
                _id: formId,
                organizationID: orgId,
                activityWorkHistoryID: awhId,
                formTemplateID: templateId,
                name: 'Hot Work Permit',
                status: 'submitted',
                submittedAt,
                committedAt,
            }];
        },
    );

    assert.deepEqual(enriched, [{
        title: 'Row A',
        activityWorkHistory_ID: 'Overdue pump maintenance',
        sourceMeta: {
            entities: {
                activityWorkHistoryId: awhId,
            },
            organizationID: orgId,
        },
        type: 'activity-work-history',
        awh_hasAttachments: false,
        awh_hasForms: true,
        validatedForms: [{
            _id: formId,
            formTemplateID: 'PTW Template',
            validatedAt: committedAt,
            name: 'Hot Work Permit',
            status: 'submitted',
            submittedAt,
            committedAt,
            sourceMeta: {
                organizationID: orgId,
                entities: {
                    formId,
                    formTemplateId: templateId,
                },
            },
            templateSnapshot: {
                name: 'PTW Template',
                description: 'Template description',
                sections: templateSections,
                fields: templateFields,
            },
        }],
    }]);
    assert.deepEqual(formFetchCalls, [[awhId]]);
    assert.deepEqual(fetchCalls, [
        {
            collection: 'ActivityWorkHistory',
            ids: [awhId],
            projection: { activityID: 1, organizationID: 1 },
        },
        {
            collection: 'Activity',
            ids: [activityId],
            projection: { description: 1, activityName: 1, organizationID: 1, machineryID: 1 },
        },
        {
            collection: 'FormTemplate',
            ids: [templateId],
            projection: { name: 1, description: 1, sections: 1, fields: 1 },
        },
    ]);
});

test('enrichHumanReadableResults burns in awh_hasForms=false when runtime AWH enrichment finds no forms', async () => {
    const awhId = '507f1f77bcf86cd799439099';
    const activityId = '507f1f77bcf86cd799439055';
    const orgId = '507f1f77bcf86cd799439077';
    const results = [{ title: 'Row A', activityWorkHistory_ID: awhId }];
    const fetchCalls: Array<{ collection: string; ids: string[]; projection: Record<string, 1> }> = [];

    const enriched = await enrichHumanReadableResults(
        results,
        async (collection, ids, projection) => {
            fetchCalls.push({ collection, ids: ids.map((id) => id.toHexString()), projection });

            switch (collection) {
                case 'ActivityWorkHistory':
                    return [{ _id: awhId, activityID: activityId, organizationID: orgId }];
                case 'Activity':
                    return [{ _id: activityId, description: 'Overdue pump maintenance', organizationID: orgId }];
                default:
                    return [];
            }
        },
        async () => [],
    );

    assert.deepEqual(enriched, [{
        title: 'Row A',
        activityWorkHistory_ID: 'Overdue pump maintenance',
        sourceMeta: {
            entities: {
                activityWorkHistoryId: awhId,
            },
            organizationID: orgId,
        },
        type: 'activity-work-history',
        awh_hasAttachments: false,
        awh_hasForms: false,
    }]);
    assert.deepEqual(fetchCalls, [
        {
            collection: 'ActivityWorkHistory',
            ids: [awhId],
            projection: { activityID: 1, organizationID: 1 },
        },
        {
            collection: 'Activity',
            ids: [activityId],
            projection: { description: 1, activityName: 1, organizationID: 1, machineryID: 1 },
        },
    ]);
});

test('enrichHumanReadableResults attaches AWH auxiliary labels and attachment flags for direct and sourceMeta-only rows', async () => {
    const awhId = '507f1f77bcf86cd799439099';
    const activityId = '507f1f77bcf86cd799439055';
    const orgId = '507f1f77bcf86cd799439077';
    const componentId = '507f1f77bcf86cd799439044';
    const machineryId = '507f1f77bcf86cd799439033';
    const results = [
        { title: 'Row A', activityWorkHistory_ID: awhId },
        { title: 'Row B', sourceMeta: { entities: { activityWorkHistoryId: awhId } } },
    ];
    const fetchCalls: Array<{ collection: string; ids: string[]; projection: Record<string, 1> }> = [];
    const componentActivityFetchCalls: string[][] = [];
    const eventFetchCalls: string[][] = [];

    const enriched = await enrichHumanReadableResults(
        results,
        async (collection, ids, projection) => {
            fetchCalls.push({ collection, ids: ids.map((id) => id.toHexString()), projection });

            switch (collection) {
                case 'ActivityWorkHistory':
                    return [{ _id: awhId, activityID: activityId, organizationID: orgId }];
                case 'Activity':
                    return [{ _id: activityId, description: 'Overdue pump maintenance', organizationID: orgId }];
                case 'Component':
                    return [{ _id: componentId, componentName: 'Fuel Pump', machineryID: machineryId }];
                case 'Machinery':
                    return [{ _id: machineryId, machineryName: 'Main Engine' }];
                default:
                    return [];
            }
        },
        async () => [],
        async (activityIds) => {
            componentActivityFetchCalls.push(activityIds.map((id) => id.toHexString()));
            return [{ activityIDs: [activityId], componentID: componentId }];
        },
        async (activityWorkHistoryIds) => {
            eventFetchCalls.push(activityWorkHistoryIds.map((id) => id.toHexString()));
            return [{ activityWorkHistoryID: awhId, attachments: [{ name: 'photo.jpg' }] }];
        },
    );

    assert.deepEqual(enriched, [
        {
            title: 'Row A',
            activityWorkHistory_ID: 'Overdue pump maintenance',
            sourceMeta: {
                entities: {
                    activityWorkHistoryId: awhId,
                },
                organizationID: orgId,
            },
            type: 'activity-work-history',
            machinery_ID: 'Main Engine',
            component_ID: 'Fuel Pump',
            awh_hasAttachments: true,
            awh_hasForms: false,
        },
        {
            title: 'Row B',
            sourceMeta: {
                entities: {
                    activityWorkHistoryId: awhId,
                },
            },
            type: 'activity-work-history',
            machinery_ID: 'Main Engine',
            component_ID: 'Fuel Pump',
            awh_hasAttachments: true,
            awh_hasForms: false,
        },
    ]);
    assert.deepEqual(componentActivityFetchCalls, [[activityId]]);
    assert.deepEqual(eventFetchCalls, [[awhId]]);
    assert.deepEqual(fetchCalls, [
        {
            collection: 'ActivityWorkHistory',
            ids: [awhId],
            projection: { activityID: 1, organizationID: 1 },
        },
        {
            collection: 'Activity',
            ids: [activityId],
            projection: { description: 1, activityName: 1, organizationID: 1, machineryID: 1 },
        },
        {
            collection: 'Component',
            ids: [componentId],
            projection: { componentName: 1, machineryID: 1 },
        },
        {
            collection: 'Machinery',
            ids: [machineryId],
            projection: { machineryName: 1 },
        },
    ]);
});

test('prep helpers preserve Phoenix intent and collection narrowing behavior', () => {
    const rag = makeRagResult();
    const candidates = buildIntentCandidatesFromRag(rag, 12);
    assert.deepEqual(candidates, [{ intent: 'overdue activities', canonicalId: '507f1f77bcf86cd799439012', score: 0.9 }]);

    const resolved = resolveCollectionsFromSelectedQdrant([{ intent: 'overdue activities', canonicalId: 'ignored' }], rag.mapping_rules);
    assert.deepEqual(resolved, {
        targetCollections: ['ActivityWorkHistory', 'Form'],
        perIntent: [{ intent: 'overdue activities', collections: ['ActivityWorkHistory', 'Form'] }],
    });

    const narrowed = narrowSchemaForAmbiguity(schema, rag, ['activityworkhistory']);
    assert.deepEqual(
        narrowed.map((entry) => entry.CollectionName),
        ['ActivityWorkHistory', 'ActivityWorkHistoryAuditLog', 'DocumentFile', 'SearchableTag', 'Organization', 'User', 'Vessel', 'VesselMachinery', 'DocumentType', 'SfiCode'],
    );
});

test('dedupByCanonical keeps the highest scoring business context item', () => {
    const deduped = dedupByCanonical(makeRagResult().business_context);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.score, 0.9);
});

test('runtime executor updates conversation as ambiguous when ambiguity remains', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":true,"clarifying_questions":["Which vessel?"],"suggestions":["show overdue maintenance for vessel atlas"],"normalized_request":"show overdue maintenance"}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    const result = await executor.executeQuery({ userQuery: 'show overdue maintenance', startedConversation: makeConversation() });
    assert.equal(result.status, 'ambiguous');
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0], {
        status: 'ambiguous',
        clarifyingQuestions: ['Which vessel?'],
        assumptions: ['show overdue maintenance for vessel atlas'],
        resolvedQuery: 'show overdue maintenance',
    });
});

test('runtime executor completes generation, execution, persistence, and streaming finalization', async () => {
    const emittedEvents: string[] = [];
    const statusEvents: string[] = [];
    const updates: Array<Record<string, unknown>> = [];
    const uploads: Array<Record<string, unknown>> = [];
    const previousUseQdrant = process.env.USE_QDRANT_VECTOR_DB;
    process.env.USE_QDRANT_VECTOR_DB = 'true';
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":["tag"]}' },
        { content: '{"base_collection":"forms","pipeline":[{"$match":{"status":"open"}},{"$limit":0},{"$skip":-2},{"$lookup":{"from":"activities","as":"activity","pipeline":[{"$limit":0},{"$skip":-1},{"$match":{"active":true}}]}}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    try {
        const executor = createPhoenixRuntimeExecutor({
            responseClient,
            retrieveGroupedChunks: async () => makeRagResult(),
            loadSchema: async () => schema,
            resolveCollectionsFromKeywordsVector: async () => ['SearchableTag'],
            async executePipeline(baseCollection, pipeline) {
                assert.equal(baseCollection, 'forms');
                assert.deepEqual(pipeline, [
                    { $match: { status: 'open' } },
                    { $skip: 0 },
                    {
                        $lookup: {
                            from: 'activities',
                            as: 'activity',
                            pipeline: [
                                { $skip: 0 },
                                { $match: { active: true } },
                            ],
                        },
                    },
                ]);

                return {
                    results: [
                        {
                            title: 'Form A',
                            _internal: 'hide-me',
                            sourceMeta: {
                                entities: {
                                    activityWorkHistoryId: '507f1f77bcf86cd799439099',
                                },
                            },
                            gridFSMetadata: { x: 1 },
                            nested: {
                                gridFSFileId: 'gridfs-1',
                                visible: true,
                                _secret: 'remove-me',
                            },
                        },
                        {
                            title: 'Form B',
                            activityWorkHistory_ID: '507f1f77bcf86cd799439099',
                            _private: 'remove-me-too',
                        },
                    ],
                    resultCount: 2,
                    executionTimeMs: 12,
                };
            },
            async uploadResults(data, filename, metadata, bucketName) {
                uploads.push({ data, filename, metadata, bucketName });
                return {
                    fileId: 'gridfs-file-1',
                    filename,
                    contentType: 'application/json',
                    bucketName,
                    metadata,
                };
            },
            async enrichResults(results) {
                return results;
            },
            async updateConversation(_id, patch) {
                updates.push(patch as Record<string, unknown>);
                return { ...makeConversation(), ...patch };
            },
        });

        const result = await executor.executeQueryStream({
            userQuery: 'show overdue maintenance',
            startedConversation: makeConversation(),
            onEvent: async ({ event, data }) => {
                emittedEvents.push(event);
                if (event === 'status' && typeof data === 'object' && data !== null) {
                    const stage = Reflect.get(data, 'stage');
                    if (typeof stage === 'string') statusEvents.push(stage);
                }
            },
        });

        assert.equal(result.status, 'completed');
        assert.deepEqual(statusEvents, ['keywords', 'retrieval', 'ambiguity', 'generation', 'execute', 'execute']);
        assert.deepEqual(emittedEvents, ['status', 'status', 'status', 'status', 'status', 'status', 'result', 'end']);
        assert.deepEqual(result.targetCollections, ['ActivityWorkHistory', 'Form', 'SearchableTag', 'FormTemplateActivityMapping', 'FormTemplateVesselMapping', 'User']);
        assert.deepEqual(result.selectedIntents, [{ intent: 'overdue activities', canonicalId: '507f1f77bcf86cd799439012' }]);
        assert.deepEqual(result.results, [
            {
                title: 'Form A',
                sourceMeta: {
                    entities: {
                        activityWorkHistoryId: '507f1f77bcf86cd799439099',
                    },
                },
                nested: {
                    visible: true,
                },
            },
            {
                title: 'Form B',
                activityWorkHistory_ID: '507f1f77bcf86cd799439099',
            },
        ]);
        assert.equal(typeof result.dualViewConfig, 'object');
        assert.equal((result.dualViewConfig as { available?: boolean }).available, true);
        assert.equal(updates.length, 2);
        assert.equal('results' in updates[1]!, false);
        assert.deepEqual(updates[1]?.generatedQuery, {
            base_collection: 'forms',
            pipeline: [
                { $match: { status: 'open' } },
                { $skip: 0 },
                {
                    $lookup: {
                        from: 'activities',
                        as: 'activity',
                        pipeline: [
                            { $skip: 0 },
                            { $match: { active: true } },
                        ],
                    },
                },
            ],
        });
        assert.equal((updates[1]?.resultsRef as { gridFSFileId?: string })?.gridFSFileId, 'gridfs-file-1');
        assert.deepEqual(uploads, [{
            data: result.results,
            filename: 'phoenix_results_507f1f77bcf86cd799439011.json',
            metadata: {
                conversationId: '507f1f77bcf86cd799439011',
                role: 'results',
            },
            bucketName: 'fs',
        }]);
        assert.deepEqual(result.executionMetadata, {
            stage: 'completed',
            extractedKeywords: ['activityworkhistory'],
            ambiguityKeywords: ['tag'],
            keywordResolvedCollections: ['SearchableTag'],
            narrowedSchemaCount: 10,
            rag: {
                businessContextCount: 2,
                businessContextDedupedCount: 1,
                technicalFieldCount: 1,
                domainLogicCount: 0,
                mappingRuleCount: 2,
                allowedFieldsWhitelist: ['activityId'],
            },
            resultCount: 2,
            executionTimeMs: 12,
        });
        assert.deepEqual(updates[0]?.executionMetadata, {
            stage: 'prepared',
            extractedKeywords: ['activityworkhistory'],
            ambiguityKeywords: ['tag'],
            keywordResolvedCollections: ['SearchableTag'],
            narrowedSchemaCount: 10,
            rag: {
                businessContextCount: 2,
                businessContextDedupedCount: 1,
                technicalFieldCount: 1,
                domainLogicCount: 0,
                mappingRuleCount: 2,
                allowedFieldsWhitelist: ['activityId'],
            },
        });
        assert.equal('nextStep' in (result.executionMetadata as Record<string, unknown>), false);
    } finally {
        if (previousUseQdrant === undefined) delete process.env.USE_QDRANT_VECTOR_DB;
        else process.env.USE_QDRANT_VECTOR_DB = previousUseQdrant;
    }
});

test('runtime executor forwards llm stream events with stage context', async () => {
    const llmEvents: Array<Record<string, unknown>> = [];
    const responsesByPurpose: Record<string, { content: string }> = {
        keyword_extraction: { content: '{"keywords":["activityworkhistory"]}' },
        ambiguity: { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":["tag"]}' },
        generation: { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"open"}}]}' },
    };

    const responseClient: PhoenixResponseClient = {
        async createResponse({ purpose = 'default', onStreamEvent }) {
            await onStreamEvent?.({
                kind: 'start',
                provider: 'openai',
                purpose,
                model: 'gpt-5.4',
            });
            await onStreamEvent?.({
                kind: 'delta',
                provider: 'openai',
                purpose,
                model: 'gpt-5.4',
                delta: `${purpose}-delta`,
            });
            await onStreamEvent?.({
                kind: 'complete',
                provider: 'openai',
                purpose,
                model: 'gpt-5.4',
                text: `${purpose}-complete`,
                responseId: `${purpose}-response`,
            });

            const next = responsesByPurpose[purpose];
            assert.ok(next, `unexpected purpose: ${purpose}`);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline() {
            return {
                results: [{ _id: 'row-1', status: 'open' }],
                resultCount: 1,
                executionTimeMs: 5,
            };
        },
        async uploadResults(_data, filename, metadata, bucketName) {
            return {
                fileId: 'gridfs-file-llm-stream',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async enrichResults(results) {
            return results;
        },
        async updateConversation(_id, patch) {
            return { ...makeConversation(), ...patch };
        },
    });

    const result = await executor.executeQueryStream({
        userQuery: 'show overdue maintenance',
        startedConversation: makeConversation(),
        onEvent: async ({ event, data }) => {
            if (event === 'llm' && typeof data === 'object' && data !== null) {
                llmEvents.push(data as Record<string, unknown>);
            }
        },
    });

    assert.equal(result.status, 'completed');
    assert.ok(llmEvents.some((event) => event.stage === 'keywords' && event.kind === 'start' && event.purpose === 'keyword_extraction'));
    assert.ok(llmEvents.some((event) => event.stage === 'keywords' && event.kind === 'delta'));
    assert.ok(llmEvents.some((event) => event.stage === 'keywords' && event.kind === 'complete'));
    assert.ok(llmEvents.some((event) => event.stage === 'ambiguity' && event.kind === 'start' && event.purpose === 'ambiguity'));
    assert.ok(llmEvents.some((event) => event.stage === 'ambiguity' && event.kind === 'delta'));
    assert.ok(llmEvents.some((event) => event.stage === 'ambiguity' && event.kind === 'complete'));
    assert.ok(llmEvents.some((event) => event.stage === 'generation' && event.attempt === 1 && event.kind === 'start' && event.purpose === 'generation'));
    assert.ok(llmEvents.some((event) => event.stage === 'generation' && event.attempt === 1 && event.kind === 'delta'));
    assert.ok(llmEvents.some((event) => event.stage === 'generation' && event.attempt === 1 && event.kind === 'complete'));
});

test('runtime executor retries once and records error state when execution fails for a generic Mongo error', async () => {
    const updates: Array<Record<string, unknown>> = [];
    let executionAttempts = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"open"}}]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"pending"}}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline(_baseCollection, pipeline) {
            executionAttempts += 1;

            if (executionAttempts === 1) {
                assert.deepEqual(pipeline, [{ $match: { status: 'open' } }]);
                throw new Error('Mongo boom');
            }

            assert.deepEqual(pipeline, [{ $match: { status: 'pending' } }]);
            throw new Error('Mongo boom');
        },
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    await assert.rejects(
        () => executor.executeQuery({ userQuery: 'show overdue maintenance', startedConversation: makeConversation() }),
        /Mongo boom/,
    );

    assert.equal(executionAttempts, 2);
    assert.equal(updates.length, 2);
    assert.equal(updates[0]?.status, 'processing');
    assert.equal(updates[1]?.status, 'error');
    assert.equal(updates[1]?.resolvedQuery, 'show overdue maintenance');
    assert.deepEqual(updates[1]?.selectedIntents, [{ intent: 'overdue activities', canonicalId: '507f1f77bcf86cd799439012' }]);
    assert.deepEqual(updates[1]?.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [
            { $match: { status: 'pending' } },
        ],
    });
    assert.deepEqual(updates[1]?.targetCollections, ['ActivityWorkHistory', 'FormTemplateActivityMapping', 'FormTemplateVesselMapping', 'User']);
    assert.deepEqual(updates[1]?.executionMetadata, {
        stage: 'error',
        extractedKeywords: ['activityworkhistory'],
        ambiguityKeywords: [],
        keywordResolvedCollections: [],
        narrowedSchemaCount: 10,
        rag: {
            businessContextCount: 2,
            businessContextDedupedCount: 1,
            technicalFieldCount: 1,
            domainLogicCount: 0,
            mappingRuleCount: 2,
            allowedFieldsWhitelist: ['activityId'],
        },
        error: 'Mongo boom',
        attempts: 2,
    });
});

test('runtime executor retries once and completes when Mongo execution recovers on the second attempt', async () => {
    const statusPayloads: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    let executionAttempts = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"open"}}]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"pending"}}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline(_baseCollection, pipeline) {
            executionAttempts += 1;

            if (executionAttempts === 1) {
                assert.deepEqual(pipeline, [{ $match: { status: 'open' } }]);
                throw new Error('Unrecognized pipeline stage name: $badStage');
            }

            assert.deepEqual(pipeline, [{ $match: { status: 'pending' } }]);
            return {
                results: [{ title: 'Recovered result', _secret: 'remove-me' }],
                resultCount: 1,
                executionTimeMs: 7,
            };
        },
        async uploadResults(data, filename, metadata, bucketName) {
            return {
                fileId: 'gridfs-file-retry-success',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    const result = await executor.executeQueryStream({
        userQuery: 'show overdue maintenance',
        startedConversation: makeConversation(),
        onEvent: async ({ event, data }) => {
            if (event === 'status' && typeof data === 'object' && data !== null) {
                statusPayloads.push(data as Record<string, unknown>);
            }
        },
    });

    assert.equal(executionAttempts, 2);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.results, [{ title: 'Recovered result' }]);
    assert.deepEqual(
        statusPayloads.map((payload) => ({
            stage: payload.stage,
            attempt: payload.attempt,
            messageKey: payload.messageKey,
        })),
        [
            { stage: 'keywords', attempt: undefined, messageKey: undefined },
            { stage: 'retrieval', attempt: undefined, messageKey: undefined },
            { stage: 'ambiguity', attempt: undefined, messageKey: undefined },
            { stage: 'generation', attempt: 1, messageKey: 'status.generating_query' },
            { stage: 'execute', attempt: 1, messageKey: 'status.executing_query' },
            { stage: 'generation', attempt: 2, messageKey: 'status.re_analyzing' },
            { stage: 'execute', attempt: 2, messageKey: 'status.executing_query' },
            { stage: 'execute', attempt: 2, messageKey: 'status.enriching_results' },
        ],
    );
    assert.equal(updates.length, 2);
    assert.equal(updates[1]?.status, 'completed');
    assert.deepEqual(updates[1]?.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [
            { $match: { status: 'pending' } },
        ],
    });
    assert.deepEqual(result.executionMetadata, {
        stage: 'completed',
        extractedKeywords: ['activityworkhistory'],
        ambiguityKeywords: [],
        keywordResolvedCollections: [],
        narrowedSchemaCount: 10,
        rag: {
            businessContextCount: 2,
            businessContextDedupedCount: 1,
            technicalFieldCount: 1,
            domainLogicCount: 0,
            mappingRuleCount: 2,
            allowedFieldsWhitelist: ['activityId'],
        },
        resultCount: 1,
        executionTimeMs: 7,
    });
});

test('runtime executor records final error metadata after malformed Mongo query retry still fails', async () => {
    const updates: Array<Record<string, unknown>> = [];
    let executionAttempts = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$badStage":{"status":"open"}}]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$project":"bad"}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline(_baseCollection, pipeline) {
            executionAttempts += 1;

            if (executionAttempts === 1) {
                assert.deepEqual(pipeline, [{ $badStage: { status: 'open' } }]);
                throw new Error('Unrecognized pipeline stage name: $badStage');
            }

            assert.deepEqual(pipeline, [{ $project: 'bad' }]);
            throw new Error('Invalid $project :: caused by :: specification must be an object');
        },
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    await assert.rejects(
        () => executor.executeQuery({ userQuery: 'show overdue maintenance', startedConversation: makeConversation() }),
        /Invalid \$project/,
    );

    assert.equal(executionAttempts, 2);
    assert.equal(updates.length, 2);
    assert.equal(updates[1]?.status, 'error');
    assert.deepEqual(updates[1]?.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [
            { $project: 'bad' },
        ],
    });
    assert.deepEqual(updates[1]?.executionMetadata, {
        stage: 'error',
        extractedKeywords: ['activityworkhistory'],
        ambiguityKeywords: [],
        keywordResolvedCollections: [],
        narrowedSchemaCount: 10,
        rag: {
            businessContextCount: 2,
            businessContextDedupedCount: 1,
            technicalFieldCount: 1,
            domainLogicCount: 0,
            mappingRuleCount: 2,
            allowedFieldsWhitelist: ['activityId'],
        },
        error: 'Invalid $project :: caused by :: specification must be an object',
        attempts: 2,
    });
});

test('runtime executor retries after an empty generated query and completes on regenerated pipeline', async () => {
    const statusPayloads: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    let executionAttempts = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"","pipeline":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"resolved"}}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline(baseCollection, pipeline) {
            executionAttempts += 1;
            assert.equal(baseCollection, 'ActivityWorkHistory');
            assert.deepEqual(pipeline, [{ $match: { status: 'resolved' } }]);
            return {
                results: [{ title: 'Recovered after generation retry', _secret: 'drop-me' }],
                resultCount: 1,
                executionTimeMs: 5,
            };
        },
        async uploadResults(data, filename, metadata, bucketName) {
            return {
                fileId: 'gridfs-file-generation-retry',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    const result = await executor.executeQueryStream({
        userQuery: 'show overdue maintenance',
        startedConversation: makeConversation(),
        onEvent: async ({ event, data }) => {
            if (event === 'status' && typeof data === 'object' && data !== null) {
                statusPayloads.push(data as Record<string, unknown>);
            }
        },
    });

    assert.equal(executionAttempts, 1);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.results, [{ title: 'Recovered after generation retry' }]);
    assert.equal(updates.length, 2);
    assert.deepEqual(updates[1]?.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [
            { $match: { status: 'resolved' } },
        ],
    });
    assert.deepEqual(
        statusPayloads.map((payload) => ({
            stage: payload.stage,
            attempt: payload.attempt,
            messageKey: payload.messageKey,
        })),
        [
            { stage: 'keywords', attempt: undefined, messageKey: undefined },
            { stage: 'retrieval', attempt: undefined, messageKey: undefined },
            { stage: 'ambiguity', attempt: undefined, messageKey: undefined },
            { stage: 'generation', attempt: 1, messageKey: 'status.generating_query' },
            { stage: 'generation', attempt: 2, messageKey: 'status.re_analyzing' },
            { stage: 'execute', attempt: 2, messageKey: 'status.executing_query' },
            { stage: 'execute', attempt: 2, messageKey: 'status.enriching_results' },
        ],
    );
});

test('runtime executor records final error metadata after generated query stays empty across retry', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"","pipeline":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$limit":0}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline() {
            assert.fail('executePipeline should not run for empty generated queries');
        },
        async updateConversation(_id, patch) {
            updates.push(patch as Record<string, unknown>);
            return { ...makeConversation(), ...patch };
        },
    });

    await assert.rejects(
        () => executor.executeQuery({ userQuery: 'show overdue maintenance', startedConversation: makeConversation() }),
        /MALFORMED_LLM_QUERY_JSON/,
    );

    assert.equal(updates.length, 2);
    assert.equal(updates[1]?.status, 'error');
    assert.deepEqual(updates[1]?.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [],
    });
    assert.deepEqual(updates[1]?.executionMetadata, {
        stage: 'error',
        extractedKeywords: ['activityworkhistory'],
        ambiguityKeywords: [],
        keywordResolvedCollections: [],
        narrowedSchemaCount: 10,
        rag: {
            businessContextCount: 2,
            businessContextDedupedCount: 1,
            technicalFieldCount: 1,
            domainLogicCount: 0,
            mappingRuleCount: 2,
            allowedFieldsWhitelist: ['activityId'],
        },
        error: 'MALFORMED_LLM_QUERY_JSON',
        attempts: 2,
    });
});

test('runtime executor retries on empty results when Phoenix env parity is enabled', async () => {
    const statusPayloads: Array<Record<string, unknown>> = [];
    const updates: Array<Record<string, unknown>> = [];
    const previousRetryOnEmpty = process.env.PHOENIX_RETRY_ON_EMPTY_RESULTS;
    process.env.PHOENIX_RETRY_ON_EMPTY_RESULTS = 'true';
    let executionAttempts = 0;
    let enrichmentCalls = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"open"}}]}' },
        { content: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"resolved"}}]}' },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    try {
        const executor = createPhoenixRuntimeExecutor({
            responseClient,
            retrieveGroupedChunks: async () => makeRagResult(),
            loadSchema: async () => schema,
            async executePipeline(_baseCollection, pipeline) {
                executionAttempts += 1;

                if (executionAttempts === 1) {
                    assert.deepEqual(pipeline, [{ $match: { status: 'open' } }]);
                    return {
                        results: [],
                        resultCount: 0,
                        executionTimeMs: 3,
                    };
                }

                assert.deepEqual(pipeline, [{ $match: { status: 'resolved' } }]);
                return {
                    results: [{ title: 'Recovered after empty pass', _private: 'drop-me' }],
                    resultCount: 1,
                    executionTimeMs: 4,
                };
            },
            async enrichResults(results) {
                enrichmentCalls += 1;
                return results;
            },
            async uploadResults(data, filename, metadata, bucketName) {
                return {
                    fileId: 'gridfs-file-empty-retry',
                    filename,
                    contentType: 'application/json',
                    bucketName,
                    metadata,
                };
            },
            async updateConversation(_id, patch) {
                updates.push(patch as Record<string, unknown>);
                return { ...makeConversation(), ...patch };
            },
        });

        const result = await executor.executeQueryStream({
            userQuery: 'show overdue maintenance',
            startedConversation: makeConversation(),
            onEvent: async ({ event, data }) => {
                if (event === 'status' && typeof data === 'object' && data !== null) {
                    statusPayloads.push(data as Record<string, unknown>);
                }
            },
        });

        assert.equal(executionAttempts, 2);
        assert.equal(enrichmentCalls, 1);
        assert.equal(result.status, 'completed');
        assert.deepEqual(result.results, [{ title: 'Recovered after empty pass' }]);
        assert.deepEqual(updates[1]?.generatedQuery, {
            base_collection: 'ActivityWorkHistory',
            pipeline: [
                { $match: { status: 'resolved' } },
            ],
        });
        assert.deepEqual(
            statusPayloads.map((payload) => ({
                stage: payload.stage,
                attempt: payload.attempt,
                messageKey: payload.messageKey,
            })),
            [
                { stage: 'keywords', attempt: undefined, messageKey: undefined },
                { stage: 'retrieval', attempt: undefined, messageKey: undefined },
                { stage: 'ambiguity', attempt: undefined, messageKey: undefined },
                { stage: 'generation', attempt: 1, messageKey: 'status.generating_query' },
                { stage: 'execute', attempt: 1, messageKey: 'status.executing_query' },
                { stage: 'generation', attempt: 2, messageKey: 'status.re_analyzing' },
                { stage: 'execute', attempt: 2, messageKey: 'status.executing_query' },
                { stage: 'execute', attempt: 2, messageKey: 'status.enriching_results' },
            ],
        );
    } finally {
        if (previousRetryOnEmpty === undefined) delete process.env.PHOENIX_RETRY_ON_EMPTY_RESULTS;
        else process.env.PHOENIX_RETRY_ON_EMPTY_RESULTS = previousRetryOnEmpty;
    }
});

test('runtime executor falls back to raw finalized generation payload when streamed content is partial', async () => {
    let executionAttempts = 0;
    const responses = [
        { content: '{"keywords":["activityworkhistory"]}' },
        { content: '{"is_ambiguous":false,"normalized_request":"show overdue maintenance","keywords":[]}' },
        {
            content: '{"base_collection":"ActivityWorkHistory"',
            raw: {
                output_text: '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"expired"}}]}',
            },
        },
    ];
    const responseClient: PhoenixResponseClient = {
        async createResponse() {
            const next = responses.shift();
            assert.ok(next);
            return next;
        },
    };

    const executor = createPhoenixRuntimeExecutor({
        responseClient,
        retrieveGroupedChunks: async () => makeRagResult(),
        loadSchema: async () => schema,
        async executePipeline(baseCollection, pipeline) {
            executionAttempts += 1;
            assert.equal(baseCollection, 'ActivityWorkHistory');
            assert.deepEqual(pipeline, [{ $match: { status: 'expired' } }]);
            return {
                results: [{ title: 'Recovered from raw finalized payload', _secret: 'drop-me' }],
                resultCount: 1,
                executionTimeMs: 6,
            };
        },
        async uploadResults(_data, filename, metadata, bucketName) {
            return {
                fileId: 'gridfs-file-raw-generation-fallback',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async enrichResults(results) {
            return results;
        },
        async updateConversation(_id, patch) {
            return { ...makeConversation(), ...patch };
        },
    });

    const result = await executor.executeQuery({
        userQuery: 'show overdue maintenance',
        startedConversation: makeConversation(),
    });

    assert.equal(executionAttempts, 1);
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.results, [{ title: 'Recovered from raw finalized payload' }]);
    assert.deepEqual(result.generatedQuery, {
        base_collection: 'ActivityWorkHistory',
        pipeline: [
            { $match: { status: 'expired' } },
        ],
    });
});

test('createOpenAiResponseClient prefers finalized stream text over partial deltas', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    const previousQueryModel = process.env.OPENAI_QUERY_MODEL;
    const previousFetch = globalThis.fetch;
    const streamEvents: Array<Record<string, unknown>> = [];
    const finalText = '{"base_collection":"ActivityWorkHistory","pipeline":[{"$match":{"status":"expired"}}]}';

    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.OPENAI_QUERY_MODEL = 'gpt-5.4';
    globalThis.fetch = (async () => new Response(
        [
            `data: ${JSON.stringify({ type: 'response.output_text.delta', response_id: 'resp_123', delta: '{"base_collection":"ActivityWorkHistory"' })}\n\n`,
            `data: ${JSON.stringify({ type: 'response.output_text.done', response_id: 'resp_123', text: finalText })}\n\n`,
            `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp_123', output_text: finalText, usage: { total_tokens: 42 } } })}\n\n`,
            'data: [DONE]\n\n',
        ].join(''),
        {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
        },
    )) as typeof fetch;

    try {
        const client = createOpenAiResponseClient();
        const result = await client.createResponse({
            messages: [
                { role: 'system', content: 'system prompt' },
                { role: 'user', content: 'user prompt' },
            ],
            purpose: 'generation',
            onStreamEvent: async (event) => {
                streamEvents.push(event as unknown as Record<string, unknown>);
            },
        });

        assert.equal(result.content, finalText);
        assert.deepEqual(result.usage, { total_tokens: 42 });
        assert.deepEqual(result.raw, {
            id: 'resp_123',
            output_text: finalText,
            usage: { total_tokens: 42 },
        });
        assert.ok(streamEvents.some((event) => event.kind === 'delta' && event.delta === '{"base_collection":"ActivityWorkHistory"'));
        assert.ok(streamEvents.some((event) => event.kind === 'complete' && event.text === finalText));
    } finally {
        globalThis.fetch = previousFetch;
        if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = previousApiKey;
        if (previousQueryModel === undefined) delete process.env.OPENAI_QUERY_MODEL;
        else process.env.OPENAI_QUERY_MODEL = previousQueryModel;
    }
});