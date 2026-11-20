import { useEffect, useState } from 'react';

/**
 * How long a list search waits after the last keystroke before it asks the
 * server (issue #1495, UX audit CONTENT-13): short enough that the list answers
 * while the operator is still looking at the box (Doherty threshold), long
 * enough that typing "landing" sends one request rather than seven.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * `value`, held back until it has stood unchanged for `delayMs`. The first
 * render answers the value at once, so a list loads without waiting; every
 * later change restarts the wait.
 *
 * For a list's search box: the box shows what the operator typed, the request
 * reads the debounced value.
 *
 * ```tsx
 * const [q, setQ] = useState('');
 * const query = useDebouncedValue(q.trim());
 * useEffect(() => { void load(query); }, [query]);
 * ```
 */
export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return (): void => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
