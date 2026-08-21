'use client';

import { useEffect } from 'react';

/**
 * Re-checks a pending payment on the buyer's behalf (issue #287).
 *
 * It navigates rather than fetching, because the answer is a *server*
 * decision: `/checkout/return` re-reads the order and forwards to the success
 * or failure page the moment the gateway's notification lands. Reloading is
 * therefore the whole mechanism, and the page it reloads decides where the
 * buyer ends up.
 *
 * `window.location.replace` keeps the wait out of the back button, and the
 * next URL carries the attempt counter — so the budget survives the reload
 * and the decision to stop is made on the server, where it can be tested.
 * Progressive enhancement only: the panel around it always renders a plain
 * link that does the same thing without JavaScript.
 */
export interface PaymentStatusPollerProps {
  /** Where to look next — the same landing, one attempt further on. */
  nextUrl: string;
  /** How long to wait before looking. */
  delayMs: number;
}

export function PaymentStatusPoller({ nextUrl, delayMs }: PaymentStatusPollerProps): null {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.replace(nextUrl);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [nextUrl, delayMs]);
  return null;
}
