import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import type { PhoenixConversation } from '../persistence/conversations.js';
import type { PhoenixRuntimeEngine } from '../runtime/contracts.js';
import {
    createPhoenixOpenAiResponseRouter,
    type PhoenixOpenAiResponseRouteDependencies,
} from './phoenix-openai-response.js';

function makeConversation(overrides: Partial<PhoenixConversation> = {}): PhoenixConversation {
    return {
        conversationId: '507f1f77bcf86cd799439011',
        userQuery: 'show overdue jobs',
        originalQuery: 'show overdue jobs',
        isPinned: false,
        deleted: false,
        ...overrides,
    };
}

function makeEngine(overrides: Partial<PhoenixRuntimeEngine> = {}): PhoenixRuntimeEngine {
    return {
        async processUserQuery() {
            return { conversationId: 'default-query', status: 'completed' };
        },
        async continueWithDisambiguation() {
            return { conversationId: 'default-disambiguation', status: 'completed' };
        },
        ...overrides,
    };
}

function makeDependencies(
    overrides: Partial<PhoenixOpenAiResponseRouteDependencies> = {},
): PhoenixOpenAiResponseRouteDependencies {
    return {
        async ensureModelsLoaded() {},
        async getConversationById() {
            return null;
        },
        async listConversations({ page = 1, pageSize = 20 }) {
            return { conversations: [], total: 0, page, pageSize };
        },
        async softDelete(id: string) {
            return makeConversation({ conversationId: id, deleted: true });
        },
        async togglePin(id: string, pinned: boolean) {
            return makeConversation({ conversationId: id, isPinned: pinned });
        },
        ...overrides,
    };
}

async function withTestServer(
    engine: PhoenixRuntimeEngine,
    dependencies: PhoenixOpenAiResponseRouteDependencies,
    run: (baseUrl: string) => Promise<void>,
): Promise<void> {
    const app = express();
    app.use(express.json());
    app.use('/api/phoenix-openai', createPhoenixOpenAiResponseRouter(engine, dependencies));
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const status = typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
            ? error.status
            : 500;
        const message = error instanceof Error ? error.message : 'Unknown test server error';
        res.status(status).json({ message });
    });

    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    const address = server.address() as AddressInfo;

    try {
        await run(`http://127.0.0.1:${address.port}/api/phoenix-openai`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
        });
    }
}

async function withStreamEnv(value: string | undefined, run: () => Promise<void>): Promise<void> {
    const previousPhx = process.env.PHX_USE_STREAM;
    const previousPhoenix = process.env.PHOENIX_USE_STREAM;

    if (value === undefined) {
        delete process.env.PHX_USE_STREAM;
        delete process.env.PHOENIX_USE_STREAM;
    } else {
        process.env.PHX_USE_STREAM = value;
        delete process.env.PHOENIX_USE_STREAM;
    }

    try {
        await run();
    } finally {
        if (previousPhx === undefined) {
            delete process.env.PHX_USE_STREAM;
        } else {
            process.env.PHX_USE_STREAM = previousPhx;
        }

        if (previousPhoenix === undefined) {
            delete process.env.PHOENIX_USE_STREAM;
        } else {
            process.env.PHOENIX_USE_STREAM = previousPhoenix;
        }
    }
}

test('router gates requests through readiness middleware and returns health payload', async () => {
    let ensureCalls = 0;

    await withStreamEnv(undefined, async () => {
        await withTestServer(
            makeEngine(),
            makeDependencies({ async ensureModelsLoaded() { ensureCalls += 1; } }),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/health`);
                assert.equal(response.status, 200);
                assert.equal(ensureCalls, 1);
                assert.deepEqual(await response.json(), {
                    namespace: 'phoenixai',
                    route: 'phoenix-openai-response',
                    status: 'scaffolded',
                    ready: false,
                    phoenixUseStream: false,
                });
            },
        );
    });
});

test('router surfaces readiness failures through Express error handling', async () => {
    await withTestServer(
        makeEngine(),
        makeDependencies({
            async ensureModelsLoaded() {
                throw Object.assign(new Error('mongo unavailable'), { status: 503 });
            },
        }),
        async (baseUrl) => {
            const response = await fetch(`${baseUrl}/health`);
            assert.equal(response.status, 503);
            assert.deepEqual(await response.json(), { message: 'mongo unavailable' });
        },
    );
});

test('router uses the streaming query executor for POST /query when stream mode is enabled', async () => {
    const streamCalls: Array<Record<string, unknown>> = [];

    await withStreamEnv('true', async () => {
        await withTestServer(
            makeEngine({
                async processUserQuery() {
                    throw new Error('non-stream query executor should not be used');
                },
                async processUserQueryStream(input) {
                    streamCalls.push({ userQuery: input.userQuery, sessionData: input.sessionData });
                    await input.onEvent({ event: 'status', data: { stage: 'generation' } });
                    return { conversationId: 'stream-query-1', status: 'completed' };
                },
            }),
            makeDependencies(),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/query`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userQuery: 'show overdue jobs', sessionData: { tenant: 'acme' } }),
                });

                assert.equal(response.status, 200);
                assert.deepEqual(await response.json(), { conversationId: 'stream-query-1', status: 'completed' });
                assert.deepEqual(streamCalls, [{ userQuery: 'show overdue jobs', sessionData: { tenant: 'acme' } }]);
            },
        );
    });
});

test('router emits fallback query stream SSE events for ambiguous results', async () => {
    await withStreamEnv(undefined, async () => {
        await withTestServer(
            makeEngine({
                async processUserQuery(input) {
                    assert.equal(input.userQuery, 'show overdue jobs');
                    return { conversationId: 'ambiguous-1', status: 'ambiguous', clarifyingQuestions: ['Which vessel?'] };
                },
            }),
            makeDependencies(),
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/query/stream?userQuery=show%20overdue%20jobs`);
                assert.equal(response.status, 200);
                assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
                const body = await response.text();
                assert.match(body, /event: disambiguation/);
                assert.match(body, /"conversationId":"ambiguous-1"/);
                assert.match(body, /event: end/);
            },
        );
    });
});

test('router parses disambiguation stream responses and proxies conversation routes', async () => {
    const disambiguationCalls: Array<Record<string, unknown>> = [];
    const toggleCalls: Array<{ id: string; pinned: boolean }> = [];
    const deleteCalls: string[] = [];

    await withStreamEnv('yes', async () => {
        await withTestServer(
            makeEngine({
                async continueWithDisambiguation(input) {
                    disambiguationCalls.push({ conversationId: input.conversationId, responses: input.responses });
                    return { conversationId: 'resolved-1', status: 'completed' };
                },
            }),
            makeDependencies({
                async listConversations({ page = 1, pageSize = 20 }) {
                    return { conversations: [makeConversation({ conversationId: 'conv-1' })], total: 1, page, pageSize };
                },
                async getConversationById(id: string) {
                    return id === 'conv-1' ? makeConversation({ conversationId: id }) : null;
                },
                async togglePin(id: string, pinned: boolean) {
                    toggleCalls.push({ id, pinned });
                    return makeConversation({ conversationId: id, isPinned: pinned });
                },
                async softDelete(id: string) {
                    deleteCalls.push(id);
                    return makeConversation({ conversationId: id, deleted: true });
                },
            }),
            async (baseUrl) => {
                const streamResponse = await fetch(
                    `${baseUrl}/disambiguate/stream?conversationId=conv-1&responses=${encodeURIComponent('["pump room","main engine"]')}`,
                );
                const streamBody = await streamResponse.text();
                assert.match(streamBody, /event: result/);
                assert.match(streamBody, /"conversationId":"resolved-1"/);
                assert.deepEqual(disambiguationCalls, [{ conversationId: 'conv-1', responses: ['pump room', 'main engine'] }]);

                const listResponse = await fetch(`${baseUrl}/conversations?page=2&limit=5`);
                assert.equal(listResponse.status, 200);
                assert.deepEqual(await listResponse.json(), {
                    conversations: [makeConversation({ conversationId: 'conv-1' })],
                    total: 1,
                    page: 2,
                    pageSize: 5,
                    phoenixUseStream: true,
                    PHOENIX_USE_STREAM: true,
                });

                const notFound = await fetch(`${baseUrl}/conversations/missing`);
                assert.equal(notFound.status, 404);
                assert.deepEqual(await notFound.json(), { message: 'Not found' });

                const pinResponse = await fetch(`${baseUrl}/conversations/conv-1/pin`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pinned: true }),
                });
                assert.equal(pinResponse.status, 200);
                assert.deepEqual(toggleCalls, [{ id: 'conv-1', pinned: true }]);

                const deleteResponse = await fetch(`${baseUrl}/conversations/conv-1`, { method: 'DELETE' });
                assert.equal(deleteResponse.status, 200);
                assert.deepEqual(deleteCalls, ['conv-1']);
            },
        );
    });
});