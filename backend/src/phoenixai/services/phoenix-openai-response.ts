import type {
    PhoenixConversation,
    PhoenixConversationCreateInput,
    PhoenixConversationPatch,
} from '../persistence/conversations.js';
import type {
    PhoenixDisambiguationInput,
    PhoenixQueryInput,
    PhoenixRuntimeEngine,
    PhoenixStreamEmitter,
} from '../runtime/contracts.js';

export interface PhoenixServiceResult extends Record<string, unknown> {
    conversationId: string;
    resolvedQuery?: string;
}

export interface PhoenixQueryExecutionInput extends PhoenixQueryInput {
    startedConversation: PhoenixConversation;
}

export interface PhoenixQueryStreamExecutionInput extends PhoenixQueryExecutionInput {
    onEvent: PhoenixStreamEmitter;
}

export interface PhoenixServiceAdapterDependencies {
    createConversation(initial: PhoenixConversationCreateInput): Promise<PhoenixConversation>;
    updateConversation(id: string, patch: PhoenixConversationPatch): Promise<PhoenixConversation | null>;
    getConversationById(id: string): Promise<PhoenixConversation | null>;
    executeQuery(input: PhoenixQueryExecutionInput): Promise<PhoenixServiceResult>;
    executeQueryStream?(input: PhoenixQueryStreamExecutionInput): Promise<PhoenixServiceResult>;
}

type DisambiguationResponseShape = {
    combined: string;
    usedAssumptions: boolean;
    userResponses: unknown[];
};

function createBadRequestError(message: string): Error & { status: number } {
    return Object.assign(new Error(message), { status: 400 });
}

function asResolvedQuery(result: PhoenixServiceResult): string | undefined {
    return typeof result.resolvedQuery === 'string' ? result.resolvedQuery : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeDisambiguationResponses(responses: unknown): DisambiguationResponseShape {
    if (Array.isArray(responses)) {
        return {
            combined: responses.filter(Boolean).join(' '),
            usedAssumptions: responses.length === 0,
            userResponses: responses,
        };
    }

    const combined = String(responses ?? '');
    return {
        combined,
        usedAssumptions: false,
        userResponses: [combined],
    };
}

function buildDisambiguationLog(
    conversation: Pick<PhoenixConversation, 'clarifyingQuestions' | 'assumptions'> | null,
    details: DisambiguationResponseShape,
    resolvedQuery?: string,
): Record<string, unknown> {
    const log: Record<string, unknown> = {
        userResponses: details.userResponses,
        assumptionsUsed: details.usedAssumptions,
    };

    if (conversation?.clarifyingQuestions !== undefined) {
        log.clarifyingQuestions = conversation.clarifyingQuestions;
    }

    if (conversation?.assumptions !== undefined) {
        log.assumptions = conversation.assumptions;
    }

    if (resolvedQuery !== undefined) {
        log.resolvedQuery = resolvedQuery;
    }

    return log;
}

function mergeResolvedQuery(log: unknown, resolvedQuery?: string): Record<string, unknown> {
    const base = isRecord(log) ? log : {};
    return resolvedQuery === undefined ? { ...base } : { ...base, resolvedQuery };
}

function ensureServiceResult(result: PhoenixServiceResult): PhoenixServiceResult {
    if (!result.conversationId || typeof result.conversationId !== 'string') {
        throw new Error('Phoenix service execution must return a conversationId');
    }

    return result;
}

function buildQueryExecutionInput(
    input: PhoenixQueryInput,
    startedConversation: PhoenixConversation,
): PhoenixQueryExecutionInput {
    return {
        userQuery: input.userQuery,
        ...(input.sessionData === undefined ? {} : { sessionData: input.sessionData }),
        startedConversation,
    };
}

async function runProcessUserQuery(
    input: PhoenixQueryInput,
    dependencies: PhoenixServiceAdapterDependencies,
    onEvent?: PhoenixStreamEmitter,
): Promise<PhoenixServiceResult> {
    if (!input.userQuery || typeof input.userQuery !== 'string') {
        throw createBadRequestError('userQuery required');
    }

    const startedConversation = await dependencies.createConversation({
        userQuery: input.userQuery,
        status: 'processing',
        createdAt: new Date(),
    });

    try {
        const executionInput = buildQueryExecutionInput(input, startedConversation);
        const result = onEvent && dependencies.executeQueryStream
            ? await dependencies.executeQueryStream({ ...executionInput, onEvent })
            : await dependencies.executeQuery(executionInput);

        return ensureServiceResult(result);
    } catch (error) {
        try {
            await dependencies.updateConversation(startedConversation.conversationId, { status: 'error' });
        } catch {
            // no-op
        }

        throw error;
    }
}

async function runContinueWithDisambiguation(
    input: PhoenixDisambiguationInput,
    dependencies: PhoenixServiceAdapterDependencies,
    onEvent?: PhoenixStreamEmitter,
): Promise<PhoenixServiceResult> {
    if (!input.conversationId || typeof input.conversationId !== 'string') {
        throw createBadRequestError('conversationId required');
    }

    const details = normalizeDisambiguationResponses(input.responses);
    const originalConversation = await dependencies.getConversationById(input.conversationId);
    const baseConversation = await dependencies.updateConversation(input.conversationId, {
        disambiguationLog: buildDisambiguationLog(originalConversation, details),
    });

    const result = await runProcessUserQuery(
        { userQuery: details.combined },
        dependencies,
        onEvent,
    );

    const resolvedQuery = asResolvedQuery(result);

    await dependencies.updateConversation(result.conversationId, {
        relatedConversationId: input.conversationId,
        disambiguationLog: buildDisambiguationLog(baseConversation, details, resolvedQuery),
    });

    try {
        await dependencies.updateConversation(input.conversationId, {
            disambiguationLog: mergeResolvedQuery(baseConversation?.disambiguationLog, resolvedQuery),
        });
    } catch {
        // no-op
    }

    return result;
}

export function createPhoenixServiceBackedRuntimeEngine(
    dependencies: PhoenixServiceAdapterDependencies,
): PhoenixRuntimeEngine {
    return {
        async processUserQuery(input: PhoenixQueryInput) {
            return runProcessUserQuery(input, dependencies);
        },
        async continueWithDisambiguation(input: PhoenixDisambiguationInput) {
            return runContinueWithDisambiguation(input, dependencies);
        },
        async processUserQueryStream(input: PhoenixQueryInput & { onEvent: PhoenixStreamEmitter }) {
            return runProcessUserQuery(input, dependencies, input.onEvent);
        },
        async processDisambiguationStream(input: PhoenixDisambiguationInput & { onEvent: PhoenixStreamEmitter }) {
            return runContinueWithDisambiguation(input, dependencies, input.onEvent);
        },
    };
}