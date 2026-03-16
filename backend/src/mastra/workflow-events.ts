import { EventEmitter } from 'events';

export const workflowEmitter = new EventEmitter();

export function emitStatusUpdate(runId: string, message: string) {
    workflowEmitter.emit(`status:${runId}`, { message });
}
