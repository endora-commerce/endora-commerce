'use client';

import { useState, type ReactNode } from 'react';
import type { PricingMoney } from '../../lib/api/pricing';
import { BaseSalePriceBlock } from './BaseSalePriceBlock';

/**
 * Feature 044 / US3 — PDP net/gross price toggle (Industria Mobile design §04).
 *
 * A purely presentational NETTO/BRUTTO switch: it re-emphasises which price the
 * {@link BaseSalePriceBlock} shows (net_only vs gross_only) without touching the
 * server-resolved pricing model. It is only used when the resolver returns
 * `displayMode === 'both'` (both prices available); for every other mode the PDP
 * keeps the plain `PriceTag`, so a toggle never appears with nothing to switch.
 *
 * Client component, but SSR-rendered on first paint (the net price is in the
 * initial HTML for crawlers — Principle VII).
 */
export function PdpPriceToggle(props: {
  basePrice: PricingMoney | null;
  salePrice?: PricingMoney | null;
  locale: string;
  vatRate?: number;
  labels?: { net: string; gross: string };
}): ReactNode {
  const [mode, setMode] = useState<'net' | 'gross'>('net');
  const labels = props.labels ?? { net: 'NETTO', gross: 'BRUTTO' };

  return (
    <div className="flex items-start justify-between gap-4">
      <BaseSalePriceBlock
        basePrice={props.basePrice}
        salePrice={props.salePrice ?? null}
        displayMode={mode === 'net' ? 'net_only' : 'gross_only'}
        locale={props.locale}
        {...(props.vatRate !== undefined ? { vatRate: props.vatRate } : {})}
        variant="pdp"
      />
      {/* Net/gross switch — pinned to the top-right of the price block. */}
      <div
        className="inline-flex shrink-0 items-center gap-[2px] rounded-md border border-line bg-surface-alt p-[2px]"
        role="radiogroup"
        aria-label="Netto / brutto"
      >
        {(['net', 'gross'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            onClick={() => setMode(m)}
            className={
              'rounded-[5px] px-[12px] py-[5px] font-mono text-[11px] font-semibold tracking-[0.04em] transition-colors ' +
              (mode === m ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')
            }
          >
            {m === 'net' ? labels.net : labels.gross}
          </button>
        ))}
      </div>
    </div>
  );
}
