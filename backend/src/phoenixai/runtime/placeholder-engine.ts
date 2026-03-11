import type {
    PhoenixDisambiguationInput,
    PhoenixQueryInput,
    PhoenixRuntimeEngine,
    PhoenixStreamEmitter,
} from './contracts.js';

export class PhoenixRuntimeNotReadyError extends Error {
    constructor(method: string) {
        super(`Phoenix runtime is not implemented yet: ${method}`);
        this.name = 'PhoenixRuntimeNotReadyError';
    }
}

const notReady = (method: string): never => {
    throw new PhoenixRuntimeNotReadyError(method);
};

export const placeholderPhoenixRuntimeEngine: PhoenixRuntimeEngine = {
    async processUserQuery(_input: PhoenixQueryInput) {
        return notReady('processUserQuery');
    },
    async continueWithDisambiguation(_input: PhoenixDisambiguationInput) {
        return notReady('continueWithDisambiguation');
    },
    async processUserQueryStream(_input: PhoenixQueryInput & { onEvent: PhoenixStreamEmitter }) {
        return notReady('processUserQueryStream');
    },
    async processDisambiguationStream(_input: PhoenixDisambiguationInput & { onEvent: PhoenixStreamEmitter }) {
        return notReady('processDisambiguationStream');
    },
};