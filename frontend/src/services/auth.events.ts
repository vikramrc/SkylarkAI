// Simple global event helpers to broadcast auth state changes (e.g., unauthorized)

const UNAUTHORIZED_EVENT = 'skylark-unauthorized';

export function onUnauthorized(listener: () => void) {
  window.addEventListener(UNAUTHORIZED_EVENT, listener as EventListener);
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener as EventListener);
}

export function notifyUnauthorized() {
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}

