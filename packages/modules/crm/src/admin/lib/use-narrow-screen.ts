import { useEffect, useState } from 'react';

/**
 * Under Tailwind's `sm` (640 px). Written as a `max-width` query a hair under
 * the breakpoint, so at exactly 640 px this and the `sm:` classes agree.
 */
const NARROW_QUERY = '(max-width: 639.98px)';

function readNarrow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/**
 * Whether the window is narrower than 640 px — where the calendar is the
 * agenda and nothing else (FR-150; research N-CAL10).
 *
 * A hook and not a pair of `hidden sm:block` classes: the two renderings hold
 * the same links, and a view hidden with CSS is still in the tab order of some
 * assistive technology and still costs its DOM.
 */
export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(readNarrow);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (): void => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    onChange();
    return (): void => query.removeEventListener('change', onChange);
  }, []);

  return narrow;
}
