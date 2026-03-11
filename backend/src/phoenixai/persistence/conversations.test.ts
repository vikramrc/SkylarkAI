import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectId } from 'mongodb';
import {
    applyReadTimeConversationBackfills,
    type PhoenixConversationDocument,
    type PhoenixConversationPatch,
} from './conversations.js';

function makeConversationDocument(overrides: Partial<PhoenixConversationDocument> = {}): PhoenixConversationDocument {
    return {
        _id: new ObjectId('507f1f77bcf86cd799439011'),
        userQuery: 'show overdue jobs',
        pinned: false,
        deleted: false,
        results: [],
        ...overrides,
    };
}

test('applyReadTimeConversationBackfills backfills minimal AWH validatedForms and persists resultsRef', async () => {
    const conversationId = '507f1f77bcf86cd799439011';
    const awhId = '507f1f77bcf86cd799439021';
    const formId = '507f1f77bcf86cd799439031';
    const formTemplateId = '507f1f77bcf86cd799439041';
    const organizationId = '507f1f77bcf86cd799439051';
    const storedAt = new Date('2026-03-11T10:00:00.000Z');
    const updateCalls: Array<{ id: string; patch: PhoenixConversationPatch }> = [];
    const uploadCalls: Array<{ data: unknown; filename: string; metadata: Record<string, unknown>; bucketName: string }> = [];
    const doc = makeConversationDocument({
        generatedQuery: { base_collection: 'ActivityWorkHistory' },
        resultsRef: { gridFSFileId: 'existing-gridfs', bucketName: 'phoenix-results' },
        results: [{
            title: 'Job 1',
            sourceMeta: {
                organizationID: organizationId,
                entities: {
                    activityWorkHistoryId: awhId,
                },
            },
        }],
    });

    const result = await applyReadTimeConversationBackfills(conversationId, doc, {
        async fetchFormsByActivityWorkHistoryIds(ids) {
            assert.deepEqual(ids, [awhId]);
            return [{
                _id: formId,
                activityWorkHistoryID: awhId,
                formTemplateID: formTemplateId,
                name: 'Permit To Work',
                status: 'submitted',
                submittedAt: new Date('2026-03-10T00:00:00.000Z'),
            }];
        },
        async fetchDocumentMetadataByIds() {
            assert.fail('DocumentMetadata backfill should not run for ActivityWorkHistory results');
        },
        async uploadResults(data, filename, metadata = {}, bucketName = 'fs') {
            uploadCalls.push({ data, filename, metadata, bucketName });
            return {
                fileId: 'gridfs-new-1',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation(id, patch) {
            updateCalls.push({ id, patch });
            return null;
        },
        now: () => storedAt,
    });

    assert.deepEqual(result, { resultsChanged: true, persisted: true });
    assert.deepEqual(doc.results, [{
        title: 'Job 1',
        sourceMeta: {
            organizationID: organizationId,
            entities: {
                activityWorkHistoryId: awhId,
            },
        },
        validatedForms: [{
            _id: formId,
            formTemplateID: formTemplateId,
            validatedAt: new Date('2026-03-10T00:00:00.000Z'),
            name: 'Permit To Work',
            status: 'submitted',
            sourceMeta: {
                organizationID: organizationId,
                entities: {
                    formId,
                    formTemplateId,
                },
            },
        }],
        awh_hasForms: true,
    }]);
    assert.deepEqual(uploadCalls, [{
        data: doc.results,
        filename: `phoenix_results_${conversationId}_enriched.json`,
        metadata: {
            conversationId,
            role: 'results',
            reason: 'view-read-backfill',
        },
        bucketName: 'phoenix-results',
    }]);
    assert.deepEqual(updateCalls, [{
        id: conversationId,
        patch: {
            resultsRef: {
                gridFSFileId: 'gridfs-new-1',
                filename: `phoenix_results_${conversationId}_enriched.json`,
                contentType: 'application/json',
                bucketName: 'phoenix-results',
                storedAt,
            },
        },
    }]);
});

test('applyReadTimeConversationBackfills burns in awh_hasForms=false when no forms exist', async () => {
    const conversationId = '507f1f77bcf86cd799439012';
    const awhId = '507f1f77bcf86cd799439022';
    const updateCalls: Array<{ id: string; patch: PhoenixConversationPatch }> = [];
    const doc = makeConversationDocument({
        generatedQuery: { base_collection: 'ActivityWorkHistory' },
        results: [{
            title: 'Job 2',
            sourceMeta: {
                entities: {
                    activityWorkHistoryId: awhId,
                },
            },
        }],
    });

    const result = await applyReadTimeConversationBackfills(conversationId, doc, {
        async fetchFormsByActivityWorkHistoryIds(ids) {
            assert.deepEqual(ids, [awhId]);
            return [];
        },
        async fetchDocumentMetadataByIds() {
            assert.fail('DocumentMetadata backfill should not run for ActivityWorkHistory results');
        },
        async uploadResults(data, filename, metadata = {}, bucketName = 'fs') {
            return {
                fileId: 'gridfs-new-2',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation(id, patch) {
            updateCalls.push({ id, patch });
            return null;
        },
        now: () => new Date('2026-03-11T11:00:00.000Z'),
    });

    assert.deepEqual(result, { resultsChanged: true, persisted: true });
    assert.deepEqual(doc.results, [{
        title: 'Job 2',
        sourceMeta: {
            entities: {
                activityWorkHistoryId: awhId,
            },
        },
        awh_hasForms: false,
    }]);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.id, conversationId);
});

test('applyReadTimeConversationBackfills backfills DocumentMetadata organization context from canonical ids', async () => {
    const conversationId = '507f1f77bcf86cd799439013';
    const documentMetadataId = '507f1f77bcf86cd799439023';
    const organizationId = '507f1f77bcf86cd799439053';
    const doc = makeConversationDocument({
        generatedQuery: { base_collection: 'DocumentMetadata' },
        results: [{
            title: 'Manual.pdf',
            sourceMeta: {
                entities: {
                    documentMetadataId,
                },
            },
        }],
    });

    const result = await applyReadTimeConversationBackfills(conversationId, doc, {
        async fetchFormsByActivityWorkHistoryIds() {
            assert.fail('AWH forms backfill should not run for DocumentMetadata results');
        },
        async fetchDocumentMetadataByIds(ids) {
            assert.deepEqual(ids, [documentMetadataId]);
            return [{ _id: documentMetadataId, organizationID: organizationId }];
        },
        async uploadResults(data, filename, metadata = {}, bucketName = 'fs') {
            return {
                fileId: 'gridfs-new-3',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation() {
            return null;
        },
        now: () => new Date('2026-03-11T12:00:00.000Z'),
    });

    assert.deepEqual(result, { resultsChanged: true, persisted: true });
    assert.deepEqual(doc.results, [{
        title: 'Manual.pdf',
        type: 'document',
        sourceMeta: {
            organizationID: organizationId,
            entities: {
                documentMetadataId,
            },
        },
    }]);
});

test('applyReadTimeConversationBackfills backfills AWH auxiliary FE fields for reopened conversations', async () => {
    const conversationId = '507f1f77bcf86cd799439014';
    const awhId = '507f1f77bcf86cd799439024';
    const activityId = '507f1f77bcf86cd799439034';
    const componentId = '507f1f77bcf86cd799439044';
    const machineryId = '507f1f77bcf86cd799439054';
    const storedAt = new Date('2026-03-11T13:00:00.000Z');
    const updateCalls: Array<{ id: string; patch: PhoenixConversationPatch }> = [];
    const uploadCalls: Array<{ data: unknown; filename: string; metadata: Record<string, unknown>; bucketName: string }> = [];
    const doc = makeConversationDocument({
        generatedQuery: { base_collection: 'ActivityWorkHistory' },
        resultsRef: { gridFSFileId: 'existing-gridfs-aux', bucketName: 'phoenix-results' },
        results: [{
            title: 'Job 3',
            sourceMeta: {
                entities: {
                    activityWorkHistoryId: awhId,
                },
            },
        }],
    });

    const result = await applyReadTimeConversationBackfills(conversationId, doc, {
        async fetchFormsByActivityWorkHistoryIds(ids) {
            assert.deepEqual(ids, [awhId]);
            return [];
        },
        async fetchDocumentMetadataByIds() {
            assert.fail('DocumentMetadata backfill should not run for ActivityWorkHistory results');
        },
        async fetchDocumentsByIds(collection, ids, projection) {
            switch (collection) {
                case 'ActivityWorkHistory':
                    assert.deepEqual(ids, [awhId]);
                    assert.deepEqual(projection, { activityID: 1, organizationID: 1 });
                    return [{ _id: awhId, activityID: activityId }];
                case 'Activity':
                    assert.deepEqual(ids, [activityId]);
                    assert.deepEqual(projection, { machineryID: 1 });
                    return [{ _id: activityId }];
                case 'Component':
                    assert.deepEqual(ids, [componentId]);
                    assert.deepEqual(projection, { componentName: 1, machineryID: 1 });
                    return [{ _id: componentId, componentName: 'Fuel Pump', machineryID: machineryId }];
                case 'Machinery':
                    assert.deepEqual(ids, [machineryId]);
                    assert.deepEqual(projection, { machineryName: 1 });
                    return [{ _id: machineryId, machineryName: 'Main Engine' }];
                default:
                    assert.fail(`unexpected collection: ${collection}`);
            }
        },
        async fetchComponentActivitiesByActivityIds(ids) {
            assert.deepEqual(ids, [activityId]);
            return [{ activityIDs: [activityId], componentID: componentId }];
        },
        async fetchActivityWorkHistoryEventsByActivityWorkHistoryIds(ids) {
            assert.deepEqual(ids, [awhId]);
            return [{ activityWorkHistoryID: awhId, attachments: [{ name: 'photo.jpg' }] }];
        },
        async uploadResults(data, filename, metadata = {}, bucketName = 'fs') {
            uploadCalls.push({ data, filename, metadata, bucketName });
            return {
                fileId: 'gridfs-new-4',
                filename,
                contentType: 'application/json',
                bucketName,
                metadata,
            };
        },
        async updateConversation(id, patch) {
            updateCalls.push({ id, patch });
            return null;
        },
        now: () => storedAt,
    });

    assert.deepEqual(result, { resultsChanged: true, persisted: true });
    assert.deepEqual(doc.results, [{
        title: 'Job 3',
        sourceMeta: {
            entities: {
                activityWorkHistoryId: awhId,
            },
        },
        awh_hasForms: false,
        machinery_ID: 'Main Engine',
        component_ID: 'Fuel Pump',
        awh_hasAttachments: true,
    }]);
    assert.deepEqual(uploadCalls, [{
        data: doc.results,
        filename: `phoenix_results_${conversationId}_enriched.json`,
        metadata: {
            conversationId,
            role: 'results',
            reason: 'view-read-backfill',
        },
        bucketName: 'phoenix-results',
    }]);
    assert.deepEqual(updateCalls, [{
        id: conversationId,
        patch: {
            resultsRef: {
                gridFSFileId: 'gridfs-new-4',
                filename: `phoenix_results_${conversationId}_enriched.json`,
                contentType: 'application/json',
                bucketName: 'phoenix-results',
                storedAt,
            },
        },
    }]);
});