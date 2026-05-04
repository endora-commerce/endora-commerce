import type { ReactNode } from 'react';
import type { DisplayMode } from '@b2b/contracts';
import type { PricingMoney } from '../../lib/api/pricing';

/**
 * Renders the customer-facing price block from a resolver-provided
 * `(basePrice, salePrice?, displayMode)` triple.
 *
 * Behaviour summary (US6 + US7):
 *   - `displayMode === 'none'` → renders nothing; callers render the
 *     Quote-Request CTA in place of the price + Add-to-cart pair.
 *   - `salePrice` present → Base struck-through, Sale highlighted as
 *     the new "Special Price"; the cart picks up the Sale price.
 *   - `salePrice` null → single Base price, formatted per `displayMode`.
 *
 * The wire amount is a decimal string (`"199.00"`); we parse with
 * `parseFloat` so the caller doesn't have to round-trip through the
 * formatter manually. Gross is computed as `net × (1 + vatRate)` to
 * match the storefront's pre-existing convention (see ProductCard).
 */
export function BaseSalePriceBlock(props: {
  basePrice: PricingMoney | null;
  salePrice?: PricingMoney | null;
  displayMode: DisplayMode;
  locale: string;
  /** Default 0.23 — matches the Polish VAT rate used in ProductCard. */
  vatRate?: number;
  /** Visual variant — `card` is compact (catalog grid), `pdp` is the
   *  larger PDP-friendly layout. */
  variant?: 'card' | 'pdp';
  /** Optional copy for the strike-through annotation; defaults to "before:". */
  baseLabel?: string;
  /** Optional copy for the Sale price annotation; defaults to "Special price". */
  saleLabel?: string;
  /** Optional copy for the gross-tax tag. */
  grossSuffix?: string;
  /** Optional copy for the net-tax tag. */
  netSuffix?: string;
}): ReactNode {
  const {
    basePrice,
    salePrice = null,
    displayMode,
    locale,
    vatRate = 0.23,
    variant = 'pdp',
    baseLabel = 'before',
    saleLabel = 'Special price',
    grossSuffix = 'gross',
    netSuffix = 'net',
  } = props;

  if (displayMode === 'none') return null;
  if (!basePrice) return null;

  const baseNet = parseAmount(basePrice.amount);
  const baseGross = baseNet === null ? null : baseNet * (1 + vatRate);
  const saleNet = salePrice ? parseAmount(salePrice.amount) : null;
  const saleGross = saleNet === null ? null : saleNet * (1 + vatRate);

  const fmt = (value: number, currency: string): string =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);

  const blockClass =
    variant === 'card'
      ? 'b2b-pricing-block b2b-pricing-block--card'
      : 'b2b-pricing-block b2b-pricing-block--pdp';

  const isSale = saleNet !== null && salePrice !== null;

  return (
    <div className={blockClass} data-display-mode={displayMode}>
      {isSale && baseNet !== null ? (
        <div className="b2b-pricing-block__base b2b-pricing-block__base--struck">
          <span className="b2b-pricing-block__label">{baseLabel}</span>
          {renderColumns({
            displayMode,
            net: baseNet,
            gross: baseGross,
            currency: basePrice.currency,
            netSuffix,
            grossSuffix,
            fmt,
            mainClass: 'b2b-pricing-block__amount b2b-pricing-block__amount--struck',
            altClass: 'b2b-pricing-block__amount-alt b2b-pricing-block__amount--struck',
          })}
        </div>
      ) : null}

      {isSale ? (
        <div className="b2b-pricing-block__sale">
          <span className="b2b-pricing-block__badge">{saleLabel}</span>
          {renderColumns({
            displayMode,
            net: saleNet!,
            gross: saleGross,
            currency: salePrice!.currency,
            netSuffix,
            grossSuffix,
            fmt,
            mainClass: 'b2b-pricing-block__amount b2b-pricing-block__amount--sale',
            altClass: 'b2b-pricing-block__amount-alt',
          })}
        </div>
      ) : (
        baseNet !== null
          ? renderColumns({
              displayMode,
              net: baseNet,
              gross: baseGross,
              currency: basePrice.currency,
              netSuffix,
              grossSuffix,
              fmt,
              mainClass: 'b2b-pricing-block__amount',
              altClass: 'b2b-pricing-block__amount-alt',
            })
          : null
      )}
    </div>
  );
}

function renderColumns(args: {
  displayMode: DisplayMode;
  net: number;
  gross: number | null;
  currency: string;
  netSuffix: string;
  grossSuffix: string;
  fmt: (value: number, currency: string) => string;
  mainClass: string;
  altClass: string;
}): ReactNode {
  const { displayMode, net, gross, currency, netSuffix, grossSuffix, fmt, mainClass, altClass } = args;
  switch (displayMode) {
    case 'net_only':
      return (
        <div className="b2b-pricing-block__columns b2b-pricing-block__columns--net">
          <span className={mainClass}>{fmt(net, currency)}</span>
          <span className="b2b-pricing-block__suffix">{netSuffix}</span>
        </div>
      );
    case 'gross_only':
      return (
        <div className="b2b-pricing-block__columns b2b-pricing-block__columns--gross">
          <span className={mainClass}>{gross !== null ? fmt(gross, currency) : fmt(net, currency)}</span>
          <span className="b2b-pricing-block__suffix">{grossSuffix}</span>
        </div>
      );
    case 'both':
      return (
        <div className="b2b-pricing-block__columns b2b-pricing-block__columns--both">
          <span className={mainClass}>{fmt(net, currency)}</span>
          <span className="b2b-pricing-block__suffix">{netSuffix}</span>
          {gross !== null ? (
            <>
              <span className={altClass}>{fmt(gross, currency)}</span>
              <span className="b2b-pricing-block__suffix b2b-pricing-block__suffix--alt">{grossSuffix}</span>
            </>
          ) : null}
        </div>
      );
    case 'none':
      return null;
  }
}

function parseAmount(amount: string): number | null {
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}
