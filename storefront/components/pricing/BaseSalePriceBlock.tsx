import type { ReactNode } from 'react';
import type { DisplayMode } from '@endora-commerce/contracts';
import type { PricingMoney } from '../../lib/api/pricing';
import { DEFAULT_VAT_RATE, formatMoney, grossUnitPriceFromNet } from '../../lib/i18n/money';
import { tForLocale } from '../../lib/i18n/messages';

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
 *   - `listPrice` present (feature 161, FR-026) → the catalogue price above
 *     the buyer's, labelled "List price", and the buyer's labelled "Your
 *     price". With a sale too (owner ruling 2026-10-23): two prices only —
 *     the list price struck through and the sale as "Your price"; the
 *     buyer's regular price is not shown. Whether it is present is the pricing engine's decision
 *     (`pricing.show_list_price` on and the catalogue price above the price
 *     charged); this block only renders what it is given. The basket and the
 *     checkout never pass it.
 *
 * The wire amount is a decimal string (`"199.00"`); we parse with
 * `parseFloat` so the caller doesn't have to round-trip through the
 * formatter manually. Gross is computed as `net × (1 + vatRate)` to
 * match the storefront's pre-existing convention (see ProductCard).
 */
export function BaseSalePriceBlock(props: {
  basePrice: PricingMoney | null;
  salePrice?: PricingMoney | null;
  /** Feature 161 (G14) — the catalogue price shown beside a lower buyer price. */
  listPrice?: PricingMoney | null;
  displayMode: DisplayMode;
  locale: string;
  /**
   * Fractional VAT rate used to derive gross from net. Defaults to the
   * deployment assumption in `lib/i18n/money` — see its note for why the
   * storefront cannot read a resolved rate yet (issue #132). This block used to
   * default to its own `0.23` literal, which meant a deployment outside Poland
   * had two other copies to find before it could correct anything.
   */
  vatRate?: number;
  /** Visual variant — `card` is compact (catalog grid), `pdp` is the
   *  larger PDP-friendly layout. */
  variant?: 'card' | 'pdp';
  /** Optional copy for the strike-through annotation; defaults to the catalogue's "before". */
  baseLabel?: string;
  /** Optional copy for the Sale price annotation; defaults to the catalogue's "Special price". */
  saleLabel?: string;
  /** Copy for the list-price annotation; defaults to the catalogue's "List price". */
  listLabel?: string;
  /** Copy for the buyer's price beside a list price; defaults to the catalogue's "Your price". */
  yourPriceLabel?: string;
  /** Optional copy for the gross-tax tag. */
  grossSuffix?: string;
  /** Optional copy for the net-tax tag. */
  netSuffix?: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  const {
    basePrice,
    salePrice = null,
    listPrice = null,
    displayMode,
    locale,
    vatRate = DEFAULT_VAT_RATE,
    variant = 'pdp',
    baseLabel = t('commerce.price.before'),
    saleLabel = t('commerce.price.special'),
    listLabel = t('product.listPrice'),
    yourPriceLabel = t('product.yourPrice'),
    grossSuffix = t('commerce.common.gross'),
    netSuffix = t('commerce.common.net'),
  } = props;

  if (displayMode === 'none') return null;
  if (!basePrice) return null;

  const baseNet = parseAmount(basePrice.amount);
  const baseGross = baseNet === null ? null : grossUnitPriceFromNet(baseNet, vatRate);
  const saleNet = salePrice ? parseAmount(salePrice.amount) : null;
  const saleGross = saleNet === null ? null : grossUnitPriceFromNet(saleNet, vatRate);

  // A unit price: its significant places, up to four (owner ruling of 2026-10-25).
  const fmt = (value: number, currency: string): string => formatMoney(value, currency, locale, { unitPrice: true });

  const blockClass =
    variant === 'card'
      ? 'b2b-pricing-block b2b-pricing-block--card'
      : 'b2b-pricing-block b2b-pricing-block--pdp';

  const isSale = saleNet !== null && salePrice !== null;
  const listNet = listPrice ? parseAmount(listPrice.amount) : null;
  const hasList = listNet !== null && listPrice !== null;

  return (
    <div className={blockClass} data-display-mode={displayMode}>
      {hasList ? (
        <div className="b2b-pricing-block__list">
          <span className="b2b-pricing-block__label">{listLabel}</span>
          {renderColumns({
            displayMode,
            net: listNet,
            gross: grossUnitPriceFromNet(listNet, vatRate),
            currency: listPrice.currency,
            netSuffix,
            grossSuffix,
            fmt,
            // With a sale the list price is what the sale undercuts: struck through
            // (owner ruling 2026-10-23).
            mainClass: isSale
              ? 'b2b-pricing-block__amount b2b-pricing-block__amount--list b2b-pricing-block__amount--struck'
              : 'b2b-pricing-block__amount b2b-pricing-block__amount--list',
            altClass: isSale ? 'b2b-pricing-block__amount-alt b2b-pricing-block__amount--struck' : 'b2b-pricing-block__amount-alt',
          })}
        </div>
      ) : null}

      {/* Owner ruling 2026-10-23: beside a list price a sale shows two prices
          only — the list price struck through and the sale as "Your price";
          the buyer's regular price is not a third number. */}
      {isSale && baseNet !== null && !hasList ? (
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
          {hasList ? (
            <span className="b2b-pricing-block__label">{yourPriceLabel}</span>
          ) : (
            <span className="b2b-pricing-block__badge">{saleLabel}</span>
          )}
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
        baseNet !== null && hasList ? (
          <div className="b2b-pricing-block__yours">
            <span className="b2b-pricing-block__label">{yourPriceLabel}</span>
            {renderColumns({
              displayMode,
              net: baseNet,
              gross: baseGross,
              currency: basePrice.currency,
              netSuffix,
              grossSuffix,
              fmt,
              mainClass: 'b2b-pricing-block__amount',
              altClass: 'b2b-pricing-block__amount-alt',
            })}
          </div>
        ) : baseNet !== null
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
