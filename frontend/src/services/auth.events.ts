const listeners = new Set<() => void>();

export function onUnauthorized(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyUnauthorized() {
  listeners.forEach((listener) => listener());
}