import type { SSEEvent } from '@/types/sse';

export function createEventSource(url: string, onEvent: (e: SSEEvent) => void, onError?: (err: any) => void) {
  const es = new EventSource(url);

  es.addEventListener('status', (evt) => {
    try { onEvent({ type: 'status', ...(JSON.parse((evt as MessageEvent).data) || {}) }); } catch {}
  });
  es.addEventListener('disambiguation', (evt) => {
    try { onEvent({ type: 'disambiguation', ...(JSON.parse((evt as MessageEvent).data) || {}) }); } catch {}
  });
  es.addEventListener('result', (evt) => {
    try { onEvent({ type: 'result', ...(JSON.parse((evt as MessageEvent).data) || {}) }); } catch {}
  });
  es.addEventListener('error', (evt) => {
    try { onEvent({ type: 'error', ...(JSON.parse((evt as MessageEvent).data) || {}) }); } catch { onError?.(evt); }
  });
  es.addEventListener('end', () => onEvent({ type: 'end' }));

  es.onerror = (err) => { onError?.(err); };

  return es;
}

