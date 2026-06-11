'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import {
  RFQ_DRAFT_CHANGED_EVENT,
  RFQ_DRAFT_STORAGE_KEY,
  rfqDraftCount,
} from '../../lib/rfqDraft';

/**
 * Header Quote-Request icon + draft-count badge. Mirrors `CartCounterBadge`,
 * but the count comes from the client-side RFQ draft in `localStorage`,
 * refreshed on mount, on client-side navigation, on the
 * `b2b:rfq-draft:changed` event, and on cross-tab `storage` events. Links to
 * the draft view at `/quote-request` (the cart-like "review & submit" page).
 */
export function RfqDraftBadge(props: {
  ariaLabel: string;
  /** aria-label template with a `{count}` placeholder for a non-empty draft. */
  itemsAriaLabelTemplate: string;
}): ReactNode {
  const [count, setCount] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    const refresh = (): void => setCount(rfqDraftCount());
    refresh();
    const onStorage = (e: StorageEvent): void => {
      if (e.key === RFQ_DRAFT_STORAGE_KEY || e.key === null) refresh();
    };
    window.addEventListener(RFQ_DRAFT_CHANGED_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(RFQ_DRAFT_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, [pathname]);

  const ariaLabel =
    count > 0
      ? props.itemsAriaLabelTemplate.replace('{count}', String(count))
      : props.ariaLabel;

  return (
    <Link href="/quote-request" className="icon-btn" aria-label={ariaLabel}>
      <RfqIcon />
      {count > 0 ? (
        <span className="icon-btn__count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

function RfqIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  );
}
