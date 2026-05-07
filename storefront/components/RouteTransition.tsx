'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Re-keys its subtree on every pathname change so the CSS class
 * `.b2b-route-fade` plays its enter animation on each URL transition.
 * Pure CSS choreography — no animation library, SSR output is the
 * full final markup (no flicker, no hydration mismatch).
 *
 * Hyva-inspired: Hyva uses Alpine `x-transition` directives for the
 * same "content fades in on render" feel. Here the equivalent is a
 * keyed wrapper + a `@keyframes b2b-route-enter` rule in globals.css.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="b2b-route-fade">
      {children}
    </div>
  );
}
