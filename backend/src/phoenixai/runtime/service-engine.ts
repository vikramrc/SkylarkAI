import {
    createConversation,
    getConversationById,
    updateConversation,
} from '../persistence/index.js';
import { createPhoenixServiceBackedRuntimeEngine } from '../services/phoenix-openai-response.js';
import { createPhoenixRuntimeExecutor } from './executor.js';
import type { PhoenixRuntimeEngine } from './contracts.js';

export class PhoenixRuntimeExecutorNotReadyError extends Error {
    constructor(method: string) {
        super(`Phoenix runtime executor is not implemented yet: ${method}`);
        this.name = 'PhoenixRuntimeExecutorNotReadyError';
    }
}

function notReady(method: string): never {
    throw new PhoenixRuntimeExecutorNotReadyError(method);
}

const runtimeExecutor = createPhoenixRuntimeExecutor({ updateConversation });

export const serviceBackedPhoenixRuntimeEngine: PhoenixRuntimeEngine = createPhoenixServiceBackedRuntimeEngine({
    createConversation,
    updateConversation,
    getConversationById,
    executeQuery: runtimeExecutor.executeQuery,
    executeQueryStream: runtimeExecutor.executeQueryStream,
});