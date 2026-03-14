/**
 * Shared in-memory store for ambiguity data.
 *
 * When `direct_query_fallback` detects an ambiguous query, it stores the full
 * ambiguity JSON here keyed by runId (threadId). The workflow then checks this
 * store after `agent.generate()` completes and short-circuits before the
 * summariser can run.
 *
 * This pattern bypasses any dependency on the Mastra/Vercel AI SDK `toolResults`
 * shape, which is unreliable across framework versions.
 */
export const ambiguityStore = new Map<string, { data: any, timestamp: number }>();

// Simple cleanup function called on every set to prune old entries (older than 5 minutes)
export function setAmbiguity(key: string, data: any) {
    const now = Date.now();
    
    // Prune stale entries
    for (const [k, v] of ambiguityStore.entries()) {
        if (now - v.timestamp > 5 * 60 * 1000) {
            ambiguityStore.delete(k);
        }
    }
    
    ambiguityStore.set(key, { data, timestamp: now });
}

export function getAmbiguity(key: string): any | null {
    const entry = ambiguityStore.get(key);
    if (!entry) return null;
    
    // Check if entry already expired manually just in case
    if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
        ambiguityStore.delete(key);
        return null;
    }
    
    return entry.data;
}
