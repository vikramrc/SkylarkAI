/**
 * stream_manager.ts
 * Manages active LLM streams using AbortControllers keyed by runId/thread_id.
 */

export const activeStreams = new Map<string, AbortController>();

/**
 * Registers an AbortController for a given runId.
 */
export function registerStream(runId: string): AbortController {
    const controller = new AbortController();
    activeStreams.set(runId, controller);
    return controller;
}

/**
 * Unregisters an AbortController for a given runId.
 */
export function unregisterStream(runId: string) {
    activeStreams.delete(runId);
}

/**
 * Aborts an active stream for a given runId.
 */
export function abortStream(runId: string): boolean {
    const controller = activeStreams.get(runId);
    if (controller) {
        controller.abort();
        activeStreams.delete(runId);
        return true;
    }
    return false;
}
