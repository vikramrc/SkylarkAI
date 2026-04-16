import { useState, useEffect } from 'react';

/**
 * Returns true when the viewport is narrower than `breakpoint` px.
 * Uses matchMedia so it reacts to window resizes (landscape ↔ portrait).
 * Default breakpoint: 768px (Tailwind's `md`).
 */
export function useIsMobile(breakpoint = 768): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsMobile(mq.matches); // sync on mount
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}
