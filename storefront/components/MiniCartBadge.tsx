import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * MiniCartBadge (feature 027 US1).
 *
 * Server-rendered cart icon link with a count badge. Sits in the
 * existing Header next to the search and account icons. Clicking goes
 * to `/cart`. Suitable for the header strip's icon row.
 *
 * A more elaborate dropdown preview (line list, totals, "Checkout"
 * CTA) is a follow-up — it requires client-side hydration and a
 * fetch that the existing server-rendered Header doesn't currently do.
 * For now this badge plus the existing `/cart` page covers the spec's
 * "buyer can see how many items are in their cart from the header"
 * intent.
 */
interface MiniCartBadgeProps {
  itemCount: number;
  label: string;
  ariaLabel: string;
}

export function MiniCartBadge({ itemCount, label, ariaLabel }: MiniCartBadgeProps): ReactNode {
  return (
    <Link href="/cart" className="industria-icon-link" aria-label={ariaLabel}>
      <CartIcon />
      <span>{label}</span>
      {itemCount > 0 ? (
        <span
          className="industria-icon-link__badge"
          aria-label={`${itemCount} items in cart`}
          style={{
            display: 'inline-block',
            minWidth: '1.25em',
            padding: '0.1em 0.4em',
            marginLeft: '0.25em',
            background: '#cc0000',
            color: 'white',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            textAlign: 'center',
            lineHeight: 1,
          }}
        >
          {itemCount}
        </span>
      ) : null}
    </Link>
  );
}

function CartIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}
