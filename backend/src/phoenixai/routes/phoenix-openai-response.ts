import { Router } from 'express';
import type { PhoenixRuntimeEngine } from '../runtime/contracts.js';
import {
    ensureModelsLoaded,
    getConversationById,
    listConversations,
    softDelete,
    togglePin,
} from '../persistence/index.js';
import { sseInit, sseSend } from '../utils/response-stream.js';

export interface PhoenixOpenAiResponseRouteDependencies {
    ensureModelsLoaded: typeof ensureModelsLoaded;
    getConversationById: typeof getConversationById;
    listConversations: typeof listConversations;
    softDelete: typeof softDelete;
    togglePin: typeof togglePin;
}

const defaultDependencies: PhoenixOpenAiResponseRouteDependencies = {
    ensureModelsLoaded,
    getConversationById,
    listConversations,
    softDelete,
    togglePin,
};

const STREAM_ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

function isStreamingEnabled(): boolean {
    const value = String(process.env.PHX_USE_STREAM ?? process.env.PHOENIX_USE_STREAM ?? '').toLowerCase();
    return STREAM_ENABLED_VALUES.has(value);
}

function getStringValue(value: unknown): string | undefined {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value) && typeof value[0] === 'string') {
        return value[0];
    }

    return undefined;
}

function parseResponses(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== 'string' || value.length === 0) {
        return [];
    }

    try {
        return JSON.parse(value);
    } catch {
        return [];
    }
}

function withOptionalConversationId<T extends { responses: unknown }>(conversationId: string | undefined, payload: T): T & { conversationId?: string } {
    return conversationId === undefined ? payload : { ...payload, conversationId };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown Phoenix runtime error';
}

let openPhoenixLlmLineKey: string | null = null;

function closeOpenPhoenixLlmLine(): void {
    if (!openPhoenixLlmLineKey) return;
    process.stdout.write('\n');
    openPhoenixLlmLineKey = null;
}

function logPhoenixStreamEvent(scope: 'query' | 'disambiguate', event: string, data: unknown): void {
    const prefix = `[PhoenixStream][${scope}]`;

    if (event === 'status' && typeof data === 'object' && data !== null) {
        closeOpenPhoenixLlmLine();
        const stage = Reflect.get(data, 'stage');
        const message = Reflect.get(data, 'message');
        const attempt = Reflect.get(data, 'attempt');
        console.log(`${prefix}[status][${String(stage ?? 'unknown')}]${typeof attempt === 'number' ? ` attempt=${attempt}` : ''} ${String(message ?? '')}`.trim());
        return;
    }

    if (event === 'llm' && typeof data === 'object' && data !== null) {
        const kind = Reflect.get(data, 'kind');
        const stage = Reflect.get(data, 'stage');
        const attempt = Reflect.get(data, 'attempt');
        const label = `${String(stage ?? 'unknown')}${typeof attempt === 'number' ? `#${attempt}` : ''}`;
        const lineKey = `${scope}:${label}`;

        if (kind === 'start') {
            closeOpenPhoenixLlmLine();
            console.log(`${prefix}[llm][${label}] start provider=${String(Reflect.get(data, 'provider') ?? 'unknown')} model=${String(Reflect.get(data, 'model') ?? 'unknown')} purpose=${String(Reflect.get(data, 'purpose') ?? 'unknown')}`);
            return;
        }

        if (kind === 'delta') {
            const delta = Reflect.get(data, 'delta');
            if (typeof delta === 'string' && delta.length > 0) {
                if (openPhoenixLlmLineKey !== lineKey) {
                    closeOpenPhoenixLlmLine();
                    process.stdout.write(`${prefix}[llm][${label}] `);
                    openPhoenixLlmLineKey = lineKey;
                }
                process.stdout.write(delta);
            }
            return;
        }

        if (kind === 'complete') {
            closeOpenPhoenixLlmLine();
            const text = Reflect.get(data, 'text');
            const chars = typeof text === 'string' ? text.length : 0;
            console.log(`${prefix}[llm][${label}] complete responseId=${String(Reflect.get(data, 'responseId') ?? 'n/a')} chars=${chars}`);
            return;
        }
    }

    if (event === 'result' && typeof data === 'object' && data !== null) {
        closeOpenPhoenixLlmLine();
        const results = Reflect.get(data, 'results');
        const resultCount = Array.isArray(results) ? results.length : Reflect.get(data, 'resultCount');
        const status = Reflect.get(data, 'status');
        console.log(`${prefix}[result] status=${String(status ?? 'unknown')} resultCount=${String(resultCount ?? 0)}`);
        return;
    }

    if (event === 'disambiguation' && typeof data === 'object' && data !== null) {
        closeOpenPhoenixLlmLine();
        const questions = Reflect.get(data, 'clarifyingQuestions');
        console.log(`${prefix}[disambiguation] questions=${Array.isArray(questions) ? questions.length : 0}`);
        return;
    }

    if (event === 'end' && typeof data === 'object' && data !== null) {
        closeOpenPhoenixLlmLine();
        console.log(`${prefix}[end] ok=${String(Reflect.get(data, 'ok') ?? 'unknown')}`);
        return;
    }

    if (event === 'error' && typeof data === 'object' && data !== null) {
        closeOpenPhoenixLlmLine();
        console.error(`${prefix}[error] ${String(Reflect.get(data, 'message') ?? 'Unknown error')}`);
        return;
    }

    closeOpenPhoenixLlmLine();
    console.log(`${prefix}[${event}]`);
}

function isAmbiguousResult(result: unknown): boolean {
    return typeof result === 'object'
        && result !== null
        && 'status' in result
        && result.status === 'ambiguous';
}

async function closeSseResponse(res: Parameters<typeof sseInit>[0]): Promise<void> {
    try {
        res.end();
    } catch {
        // no-op
    }
}

export function createPhoenixOpenAiResponseRouter(
    engine: PhoenixRuntimeEngine,
    dependencies: PhoenixOpenAiResponseRouteDependencies = defaultDependencies,
) {
    const router = Router();

    router.use(async (_req, _res, next) => {
        try {
            await dependencies.ensureModelsLoaded();
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get('/health', (_req, res) => {
        res.status(200).json({
            namespace: 'phoenixai',
            route: 'phoenix-openai-response',
            status: 'scaffolded',
            ready: false,
            phoenixUseStream: isStreamingEnabled(),
        });
    });

    router.post('/query', async (req, res, next) => {
        try {
            const userQuery = getStringValue(req.body?.userQuery);
            const sessionData = req.body?.sessionData;

            if (!userQuery) {
                return res.status(400).json({ message: 'userQuery required' });
            }

            if (!isStreamingEnabled() || !engine.processUserQueryStream) {
                const result = await engine.processUserQuery({ userQuery, sessionData });
                return res.json(result);
            }

            const finalPayload = await engine.processUserQueryStream({
                userQuery,
                sessionData,
                onEvent: async () => undefined,
            });

            return res.json(finalPayload ?? null);
        } catch (error) {
            return next(error);
        }
    });

    router.get('/query/stream', async (req, res, next) => {
        const userQuery = getStringValue(req.query.userQuery);

        if (!userQuery) {
            return res.status(400).json({ message: 'userQuery required' });
        }

        try {
            sseInit(res);
            const sendEvent = async (event: string, data: unknown) => {
                logPhoenixStreamEvent('query', event, data);
                sseSend(res, event, data);
            };

            if (!isStreamingEnabled() || !engine.processUserQueryStream) {
                const result = await engine.processUserQuery({ userQuery });
                await sendEvent(isAmbiguousResult(result) ? 'disambiguation' : 'result', result);
                await sendEvent('end', { ok: true });
                await closeSseResponse(res);
                return;
            }

            const result = await engine.processUserQueryStream({
                userQuery,
                onEvent: async ({ event, data }) => sendEvent(event, data),
            });

            if (isAmbiguousResult(result)) {
                await sendEvent('disambiguation', result);
                await sendEvent('end', { ok: true });
            }

            await closeSseResponse(res);
        } catch (error) {
            try {
                sseSend(res, 'error', { message: getErrorMessage(error) });
                sseSend(res, 'end', { ok: false });
                await closeSseResponse(res);
            } catch {
                next(error);
            }
        }
    });

    router.post('/disambiguate', async (req, res, next) => {
        try {
            const conversationId = getStringValue(req.body?.conversationId);
            const responses = req.body?.responses;

            const payload = withOptionalConversationId(conversationId, { responses });

            if (!isStreamingEnabled() || !engine.processDisambiguationStream) {
                const result = await engine.continueWithDisambiguation(payload);
                return res.json(result);
            }

            const finalPayload = await engine.processDisambiguationStream({
                ...payload,
                onEvent: async () => undefined,
            });

            return res.json(finalPayload ?? null);
        } catch (error) {
            return next(error);
        }
    });

    router.get('/disambiguate/stream', async (req, res, next) => {
        try {
            const conversationId = getStringValue(req.query.conversationId);
            const responses = parseResponses(req.query.responses);

            sseInit(res);
            const sendEvent = async (event: string, data: unknown) => {
                logPhoenixStreamEvent('disambiguate', event, data);
                sseSend(res, event, data);
            };

            if (!isStreamingEnabled() || !engine.processDisambiguationStream) {
                const result = await engine.continueWithDisambiguation(
                    withOptionalConversationId(conversationId, { responses }),
                );
                await sendEvent(isAmbiguousResult(result) ? 'disambiguation' : 'result', result);
                await sendEvent('end', { ok: true });
                await closeSseResponse(res);
                return;
            }

            const result = await engine.processDisambiguationStream({
                ...withOptionalConversationId(conversationId, { responses }),
                onEvent: async ({ event, data }) => sendEvent(event, data),
            });

            if (isAmbiguousResult(result)) {
                await sendEvent('disambiguation', result);
            } else if (result !== undefined) {
                await sendEvent('result', result);
            }

            await sendEvent('end', { ok: true });
            await closeSseResponse(res);
        } catch (error) {
            try {
                sseSend(res, 'error', { message: getErrorMessage(error) });
                sseSend(res, 'end', { ok: false });
                await closeSseResponse(res);
            } catch {
                next(error);
            }
        }
    });

    router.get('/conversations', async (req, res, next) => {
        try {
            const page = Number(getStringValue(req.query.page) ?? '1');
            const rawPageSize = Number(getStringValue(req.query.pageSize) ?? getStringValue(req.query.limit) ?? '20');
            const data = await dependencies.listConversations({ page, pageSize: rawPageSize });

            return res.json({
                ...data,
                phoenixUseStream: isStreamingEnabled(),
                PHOENIX_USE_STREAM: isStreamingEnabled(),
            });
        } catch (error) {
            return next(error);
        }
    });

    router.get('/conversations/:id', async (req, res, next) => {
        try {
            const data = await dependencies.getConversationById(req.params.id);

            if (!data) {
                return res.status(404).json({ message: 'Not found' });
            }

            return res.json(data);
        } catch (error) {
            return next(error);
        }
    });

    router.patch('/conversations/:id/pin', async (req, res, next) => {
        try {
            const data = await dependencies.togglePin(req.params.id, !!req.body?.pinned);

            if (!data) {
                return res.status(404).json({ message: 'Not found' });
            }

            return res.json(data);
        } catch (error) {
            return next(error);
        }
    });

    router.delete('/conversations/:id', async (req, res, next) => {
        try {
            const data = await dependencies.softDelete(req.params.id);

            if (!data) {
                return res.status(404).json({ message: 'Not found' });
            }

            return res.json(data);
        } catch (error) {
            return next(error);
        }
    });

    return router;
}

export default createPhoenixOpenAiResponseRouter;