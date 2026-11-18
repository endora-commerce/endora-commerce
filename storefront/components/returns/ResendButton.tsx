'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * *Send the link again* on the *sent* page (`specs/181-guest-complaints/` design review S-2).
 * With JavaScript it stays disabled, with a countdown, until 60 seconds after this browser's
 * request; the countdown is not a live region. When the button enables, a `role="status"`
 * region mounted empty announces it once. Without JavaScript it is enabled, and the handler
 * asks to wait instead.
 */
export function ResendButton({
  requestedAt,
  waitMs,
  label,
  countdown,
  ready,
}: {
  requestedAt: number;
  waitMs: number;
  label: string;
  /** `{s}` = the seconds left. */
  countdown: string;
  ready: string;
}): ReactNode {
  const [left, setLeft] = useState<number | null>(null);
  // Announced only when the wait ends in front of the visitor, not on a page opened later.
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    let waited = false;
    const tick = (): void => {
      const remaining = Math.max(0, Math.ceil((requestedAt + waitMs - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining > 0) waited = true;
      else {
        window.clearInterval(id);
        if (waited) setAnnounce(true);
      }
    };
    const id = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(id);
  }, [requestedAt, waitMs]);
  const waiting = left !== null && left > 0;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="submit" className="btn btn--outline" disabled={waiting}>
        {label}
      </button>
      {waiting ? <span className="text-[13px] text-muted">{countdown.replace('{s}', String(left))}</span> : null}
      <span role="status" className="sr-only">
        {announce ? ready : ''}
      </span>
    </div>
  );
}
