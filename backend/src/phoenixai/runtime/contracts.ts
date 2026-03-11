export interface PhoenixQueryInput {
    userQuery: string;
    sessionData?: unknown;
    [key: string]: unknown;
}

export interface PhoenixDisambiguationInput {
    conversationId?: string;
    responses?: unknown;
    [key: string]: unknown;
}

export interface PhoenixStreamEvent {
    event: string;
    data: unknown;
}

export type PhoenixStreamEmitter = (event: PhoenixStreamEvent) => void | Promise<void>;

export interface PhoenixRuntimeEngine {
    processUserQuery(input: PhoenixQueryInput): Promise<unknown>;
    continueWithDisambiguation(input: PhoenixDisambiguationInput): Promise<unknown>;
    processUserQueryStream?(input: PhoenixQueryInput & { onEvent: PhoenixStreamEmitter }): Promise<unknown>;
    processDisambiguationStream?(input: PhoenixDisambiguationInput & { onEvent: PhoenixStreamEmitter }): Promise<unknown>;
}