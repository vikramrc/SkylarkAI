import test from 'node:test';
import assert from 'node:assert/strict';
import type {
    PhoenixConversation,
    PhoenixConversationCreateInput,
    PhoenixConversationPatch,
} from '../persistence/conversations.js';
import { createPhoenixServiceBackedRuntimeEngine, type PhoenixServiceResult } from './phoenix-openai-response.js';

function makeConversation(overrides: Partial<PhoenixConversation> = {}): PhoenixConversation {
    return {
        conversationId: '507f1f77bcf86cd799439011',
        userQuery: 'default query',
        originalQuery: 'default query',
        isPinned: false,
        deleted: false,
        ...overrides,
    };
}

test('service adapter marks a started conversation as error when query execution fails', async () => {
    const updateCalls: Array<{ id: string; patch: PhoenixConversationPatch }> = [];

    const engine = createPhoenixServiceBackedRuntimeEngine({
        async createConversation(initial: PhoenixConversationCreateInput) {
            assert.equal(initial.userQuery, 'show overdue jobs');
            return makeConversation({ conversationId: 'started-1', userQuery: initial.userQuery, originalQuery: initial.userQuery });
        },
        async updateConversation(id: string, patch: PhoenixConversationPatch) {
            updateCalls.push({ id, patch });
            return makeConversation({
                conversationId: id,
                ...(typeof patch.status === 'string' ? { status: patch.status } : {}),
            });
        },
        async getConversationById() {
            return null;
        },
        async executeQuery() {
            throw new Error('executor failed');
        },
    });

    await assert.rejects(() => engine.processUserQuery({ userQuery: 'show overdue jobs' }), /executor failed/);
    assert.deepEqual(updateCalls, [{ id: 'started-1', patch: { status: 'error' } }]);
});

test('service adapter combines disambiguation responses, persists logs, and links the final conversation', async () => {
    const updateCalls: Array<{ id: string; patch: PhoenixConversationPatch }> = [];

    const engine = createPhoenixServiceBackedRuntimeEngine({
        async createConversation(initial: PhoenixConversationCreateInput) {
            assert.equal(initial.userQuery, 'pump room main engine');
            return makeConversation({
                conversationId: 'started-2',
                userQuery: initial.userQuery,
                originalQuery: initial.userQuery,
            });
        },
        async updateConversation(id: string, patch: PhoenixConversationPatch) {
            updateCalls.push({ id, patch });
            return makeConversation({
                conversationId: id,
                clarifyingQuestions: ['Which system?'],
                assumptions: ['main engine'],
                disambiguationLog: patch.disambiguationLog,
            });
        },
        async getConversationById() {
            return makeConversation({
                conversationId: 'original-1',
                clarifyingQuestions: ['Which system?'],
                assumptions: ['main engine'],
            });
        },
        async executeQuery(): Promise<PhoenixServiceResult> {
            return {
                conversationId: 'resolved-1',
                resolvedQuery: 'show jobs for pump room main engine',
                status: 'completed',
            };
        },
    });

    const result = await engine.continueWithDisambiguation({
        conversationId: 'original-1',
        responses: ['pump room', 'main engine'],
    });

    assert.equal((result as PhoenixServiceResult).conversationId, 'resolved-1');
    assert.equal(updateCalls.length, 3);
    assert.deepEqual(updateCalls[0], {
        id: 'original-1',
        patch: {
            disambiguationLog: {
                userResponses: ['pump room', 'main engine'],
                assumptionsUsed: false,
                clarifyingQuestions: ['Which system?'],
                assumptions: ['main engine'],
            },
        },
    });
    assert.deepEqual(updateCalls[1], {
        id: 'resolved-1',
        patch: {
            relatedConversationId: 'original-1',
            disambiguationLog: {
                userResponses: ['pump room', 'main engine'],
                assumptionsUsed: false,
                clarifyingQuestions: ['Which system?'],
                assumptions: ['main engine'],
                resolvedQuery: 'show jobs for pump room main engine',
            },
        },
    });
    assert.deepEqual(updateCalls[2], {
        id: 'original-1',
        patch: {
            disambiguationLog: {
                userResponses: ['pump room', 'main engine'],
                assumptionsUsed: false,
                clarifyingQuestions: ['Which system?'],
                assumptions: ['main engine'],
                resolvedQuery: 'show jobs for pump room main engine',
            },
        },
    });
});

test('service adapter uses the stream executor when provided', async () => {
    let streamCalled = false;

    const engine = createPhoenixServiceBackedRuntimeEngine({
        async createConversation(initial: PhoenixConversationCreateInput) {
            const userQuery = String(initial.userQuery);
            return makeConversation({ conversationId: 'started-3', userQuery, originalQuery: userQuery });
        },
        async updateConversation() {
            return null;
        },
        async getConversationById() {
            return null;
        },
        async executeQuery() {
            throw new Error('non-stream executor should not be used');
        },
        async executeQueryStream(input) {
            streamCalled = true;
            await input.onEvent({ event: 'heartbeat', data: { ok: true } });
            return { conversationId: 'streamed-1', status: 'completed' };
        },
    });

    const events: string[] = [];
    assert.ok(engine.processUserQueryStream);
    const result = await engine.processUserQueryStream({
        userQuery: 'stream this',
        onEvent: async ({ event }) => {
            events.push(event);
        },
    });

    assert.equal(streamCalled, true);
    assert.deepEqual(events, ['heartbeat']);
    assert.equal((result as PhoenixServiceResult).conversationId, 'streamed-1');
});