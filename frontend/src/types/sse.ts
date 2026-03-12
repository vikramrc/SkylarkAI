import type { Conversation } from './conversation';

export type SSEEventName = 'status' | 'disambiguation' | 'result' | 'error' | 'end';

export interface SSEStatusEvent { type: 'status'; stage?: string; message?: string }
export interface SSEDisambiguationEvent { type: 'disambiguation'; conversation: Conversation }
export interface SSEResultEvent { type: 'result'; conversation: Conversation }
export interface SSEErrorEvent { type: 'error'; message: string }
export interface SSEEndEvent { type: 'end' }

export type SSEEvent = SSEStatusEvent | SSEDisambiguationEvent | SSEResultEvent | SSEErrorEvent | SSEEndEvent;

