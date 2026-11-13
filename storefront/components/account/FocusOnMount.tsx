'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * Moves focus to the element `targetId` names, once, when it mounts.
 *
 * For a server action that redirects back to its page and removes the control
 * the buyer used — *Mark all as read* on `/account/notifications` unmounts
 * itself (`specs/179-rfq-and-customer-notifications/` FR-050b) — so focus does
 * not fall to the document. The page renders it only on that redirect; the
 * target carries `tabIndex={-1}`. Renders a marker and nothing visible.
 */
export function FocusOnMount({ targetId }: { targetId: string }): ReactNode {
  useEffect(() => {
    document.getElementById(targetId)?.focus();
  }, [targetId]);
  return <span hidden data-focus-target={targetId} />;
}
