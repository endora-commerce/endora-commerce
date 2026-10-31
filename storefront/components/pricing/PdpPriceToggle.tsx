'use client';

import { useState, type ReactNode } from 'react';
import type { PricingMoney } from '../../lib/api/pricing';
import { BaseSalePriceBlock } from './BaseSalePriceBlock';
import { tForLocale } from '../../lib/i18n/messages';

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
  /** Feature 161 (FR-026) — the catalogue price beside a lower buyer price. */
  listPrice?: PricingMoney | null;
  /** Translated "List price" / "Your price" (strings, so the props cross the
   *  Server → Client boundary). */
  listPriceLabel?: string;
  yourPriceLabel?: string;
  locale: string;
  vatRate?: number;
  labels?: { net: string; gross: string };
}): ReactNode {
  const [mode, setMode] = useState<'net' | 'gross'>('net');
  const t = tForLocale(props.locale);
  const labels = props.labels ?? {
    net: t('commerce.pdp.priceToggle.net'),
    gross: t('commerce.pdp.priceToggle.gross'),
  };

  return (
    <div className="flex items-start justify-between gap-4">
      <BaseSalePriceBlock
        basePrice={props.basePrice}
        salePrice={props.salePrice ?? null}
        listPrice={props.listPrice ?? null}
        {...(props.listPriceLabel !== undefined ? { listLabel: props.listPriceLabel } : {})}
        {...(props.yourPriceLabel !== undefined ? { yourPriceLabel: props.yourPriceLabel } : {})}
        displayMode={mode === 'net' ? 'net_only' : 'gross_only'}
        locale={props.locale}
        {...(props.vatRate !== undefined ? { vatRate: props.vatRate } : {})}
        variant="pdp"
      />
      {/* Net/gross switch — pinned to the top-right of the price block. */}
      <div
        className="inline-flex shrink-0 items-center gap-[2px] rounded-md border border-line bg-surface-alt p-[2px]"
        role="radiogroup"
        aria-label={t('commerce.pdp.priceToggle.label')}
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
