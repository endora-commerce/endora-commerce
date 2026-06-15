import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Feature 044 / US1 — mobile home strip (Industria Mobile design §01):
 * a horizontal benefit strip (shipping cut-off, credit limit, invoicing)
 * followed by a scrollable row of category chips.
 *
 * Server component (no client logic) shown only on phones (`md:hidden`).
 * It sits directly under the header on the mobile home view; the desktop
 * hero/category sections are unchanged.
 */
export function HomeMobileStrip(props: {
  benefits: { icon: 'truck' | 'wallet' | 'doc'; label: string }[];
  chips: { label: string; href: string; active?: boolean }[];
}): ReactNode {
  return (
    <div className="md:hidden">
      <div className="flex items-center gap-[14px] overflow-x-auto border-b border-line bg-surface-alt px-[16px] py-[8px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {props.benefits.map((b) => (
          <span
            key={b.label}
            className="inline-flex shrink-0 items-center gap-[6px] whitespace-nowrap font-mono text-[11px] text-fg-soft"
          >
            <span className="text-accent" aria-hidden="true">
              <BenefitIcon kind={b.icon} />
            </span>
            {b.label}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-[8px] overflow-x-auto px-[16px] py-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {props.chips.map((c) => (
          <Link
            key={c.href + c.label}
            href={c.href}
            className={
              'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-[14px] py-[7px] text-[13px] font-medium transition-[background-color,border-color,color] duration-100 ' +
              (c.active
                ? 'border-[color:var(--ink-900)] bg-[color:var(--ink-900)] text-white'
                : 'border-line bg-surface text-fg-soft')
            }
          >
            {c.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function BenefitIcon({ kind }: { kind: 'truck' | 'wallet' | 'doc' }): ReactNode {
  const inner =
    kind === 'truck' ? (
      <>
        <rect x="1" y="3" width="15" height="13" />
        <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
        <circle cx="5.5" cy="18.5" r="2.5" />
        <circle cx="18.5" cy="18.5" r="2.5" />
      </>
    ) : kind === 'wallet' ? (
      <>
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
        <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
      </>
    ) : (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </>
    );
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {inner}
    </svg>
  );
}
