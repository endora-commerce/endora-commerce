import type { ReactNode } from 'react';
import Image from 'next/image';
import type { PaymentMethodSummary } from '../api/methods';

/**
 * Small inline-SVG marks shown next to a payment method at checkout (feature
 * 049). Scheme methods (BLIK, Apple Pay, Google Pay) get a recognizable badge;
 * generic kinds (card, bank transfer, pickup, credit) get a neutral line icon
 * in `currentColor`. All SVG is self-contained bar the BLIK logo, so it renders
 * under SSR and any CSP.
 *
 * **The badge is chosen by the method-code suffix, not by the gateway.**
 * `specs/134-paid-module-extraction/` T041, ruling O-1(b) — the gateways'
 * checkout UI leaves this repository as fragments a shop copies in, so a switch
 * enumerating `stripe_blik`, `payu_blik`, `autopay_blik` … would give the badge
 * to the five ids this tree used to carry and a blank card icon to every
 * fragment copied in under any other adapter. `<vendor>_blik` is BLIK whoever
 * the vendor is; the scheme is the fact, and the vendor is not.
 */

const BADGE_W = 34;
const BADGE_H = 22;

function Badge({ children, bg }: { children: ReactNode; bg: string }): ReactNode {
  return (
    <svg width={BADGE_W} height={BADGE_H} viewBox="0 0 34 22" role="img" aria-hidden="true">
      <rect x="0.5" y="0.5" width="33" height="21" rx="4" fill={bg} stroke="rgba(0,0,0,0.12)" />
      {children}
    </svg>
  );
}

function Line({ children }: { children: ReactNode }): ReactNode {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function CardIcon(): ReactNode {
  return (
    <Line>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <line x1="2.5" y1="9.5" x2="21.5" y2="9.5" />
      <line x1="6" y1="15" x2="10" y2="15" />
    </Line>
  );
}

function BankIcon(): ReactNode {
  return (
    <Line>
      <path d="M3 9.5 12 4l9 5.5" />
      <line x1="5" y1="10" x2="5" y2="18" />
      <line x1="10" y1="10" x2="10" y2="18" />
      <line x1="14" y1="10" x2="14" y2="18" />
      <line x1="19" y1="10" x2="19" y2="18" />
      <line x1="3.5" y1="20" x2="20.5" y2="20" />
    </Line>
  );
}

function PickupIcon(): ReactNode {
  return (
    <Line>
      <path d="M3 8V6h18v2l-1.5 3.5V20H4.5v-8.5L3 8Z" />
      <line x1="3" y1="8" x2="21" y2="8" />
      <path d="M9.5 20v-4h5v4" />
    </Line>
  );
}

function WalletIcon(): ReactNode {
  return (
    <Line>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M15.5 11h4v3h-4a1.5 1.5 0 0 1 0-3Z" />
    </Line>
  );
}

function BlikMark(): ReactNode {
  return (
    <Image
      src="/brands/blik-logo.svg"
      alt=""
      aria-hidden="true"
      width={BADGE_W}
      height={BADGE_H}
      style={{ display: 'block' }}
      unoptimized
    />
  );
}

function ApplePayMark(): ReactNode {
  return (
    <Badge bg="#ffffff">
      {/* Apple glyph */}
      <path
        d="M9.9 8.1c.35-.44.6-1.04.53-1.65-.52.02-1.15.35-1.52.79-.33.38-.62 1-.54 1.58.58.05 1.17-.29 1.53-.72Zm.62.98c-.84-.05-1.55.48-1.95.48-.4 0-1.02-.45-1.68-.44-.86.01-1.66.5-2.1 1.28-.9 1.56-.24 3.87.64 5.14.43.62.94 1.31 1.61 1.29.64-.03.89-.42 1.66-.42.77 0 .99.42 1.68.4.7-.01 1.14-.63 1.57-1.25.49-.72.69-1.42.7-1.46-.02-.01-1.35-.52-1.36-2.05-.01-1.28 1.04-1.89 1.09-1.92-.6-.88-1.53-.98-1.86-.99Z"
        fill="#000000"
      />
      <text
        x="22"
        y="15"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="9"
        fontWeight="600"
        fill="#000000"
      >
        Pay
      </text>
    </Badge>
  );
}

function GooglePayMark(): ReactNode {
  return (
    <Badge bg="#ffffff">
      <text
        x="10.5"
        y="15"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="10"
        fontWeight="700"
      >
        <tspan fill="#4285F4">G</tspan>
      </text>
      <text
        x="22"
        y="15"
        textAnchor="middle"
        fontFamily="system-ui, sans-serif"
        fontSize="9"
        fontWeight="600"
        fill="#5f6368"
      >
        Pay
      </text>
    </Badge>
  );
}

/**
 * The scheme a method code names, read off its suffix. The seeded codes are
 * `<adapter>_<scheme>` by convention across every gateway this platform has
 * carried, and a fragment copied in keeps that shape because the backend's own
 * method seeding does.
 */
const SCHEME_MARKS: ReadonlyArray<readonly [suffix: string, mark: () => ReactNode]> = [
  ['_apple_pay', ApplePayMark],
  ['_google_pay', GooglePayMark],
  ['_blik', BlikMark],
  ['_card', CardIcon],
  ['_bank_transfer', BankIcon],
  // "Pay-by-link" — a bank-transfer redirect, which is what the bank icon says.
  ['_pbl', BankIcon],
];

function iconFor(method: Pick<PaymentMethodSummary, 'code' | 'kind'>): ReactNode {
  for (const [suffix, Mark] of SCHEME_MARKS) {
    if (method.code.endsWith(suffix)) return <Mark />;
  }
  switch (method.kind) {
    case 'bank_transfer':
      return <BankIcon />;
    case 'pickup':
      return <PickupIcon />;
    case 'credit_limit':
      return <WalletIcon />;
    default:
      return <CardIcon />;
  }
}

export function PaymentMethodIcon({
  method,
}: {
  method: Pick<PaymentMethodSummary, 'code' | 'kind'>;
}): ReactNode {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: BADGE_W,
        marginRight: 8,
        verticalAlign: 'middle',
      }}
    >
      {iconFor(method)}
    </span>
  );
}
