import type { ReactNode } from 'react';

/**
 * VariantPicker — server-rendered variant selector for configurable
 * Products (T050, feature 002 spec.md US2).
 *
 * Renders the full matrix of variants as a fieldset of clickable links,
 * each pointing at the product page with `?variant=<sku>` so the picker
 * works even with JS disabled (Constitution Principle VII —
 * SSR-first, no JS required for catalog browsing).
 *
 * Each variant shows:
 *   - the localized attribute combination (e.g. "M / Red")
 *   - SKU as small caption
 *   - price-override + stock badges if set
 *
 * The currently-selected variant (matched against the `variant` URL query
 * parameter resolved by the parent page) gets `aria-current="true"`.
 */

interface Variant {
  id: string;
  sku: string;
  variantAttributeValues: Record<string, unknown>;
  priceOverride?: number | null;
  stockLevel?: number | null;
}

export interface VariantPickerProps {
  productSlug: string;
  variants: Variant[];
  /** SKU of the variant currently chosen (e.g. from `?variant=...`). */
  selectedSku?: string | null;
  /** Localized labels for the picker (parent passes the i18n bundle). */
  labels: {
    heading: string;
    sku: string;
    priceOverride: string;
    stockLevel: string;
    outOfStock: string;
    selectThisVariant: string;
  };
}

export function VariantPicker({
  productSlug,
  variants,
  selectedSku,
  labels,
}: VariantPickerProps): ReactNode {
  if (variants.length === 0) return null;

  return (
    <fieldset className="b2b-variant-picker" style={{ marginTop: 24, padding: 16 }}>
      <legend style={{ fontWeight: 600 }}>{labels.heading}</legend>
      <ul
        className="b2b-variant-picker__list"
        style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}
      >
        {variants.map((v) => {
          const isSelected = selectedSku === v.sku;
          const description = describeAttributeValues(v.variantAttributeValues);
          const outOfStock = v.stockLevel != null && v.stockLevel <= 0;
          return (
            <li key={v.id}>
              <a
                href={`/p/${productSlug}?variant=${encodeURIComponent(v.sku)}`}
                aria-current={isSelected ? 'true' : undefined}
                aria-disabled={outOfStock ? 'true' : undefined}
                title={
                  outOfStock
                    ? labels.outOfStock
                    : isSelected
                      ? labels.selectThisVariant
                      : undefined
                }
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: 8,
                  border: isSelected ? '2px solid currentColor' : '1px solid #ccc',
                  background: outOfStock ? '#f5f5f5' : 'transparent',
                  textDecoration: 'none',
                  color: 'inherit',
                  pointerEvents: outOfStock ? 'none' : 'auto',
                }}
                rel="nofollow"
              >
                <span style={{ fontWeight: isSelected ? 600 : 400 }}>{description}</span>
                <span style={{ fontSize: '0.875rem', color: 'var(--muted, #666)' }}>
                  {labels.sku}: <code>{v.sku}</code>
                </span>
                {v.priceOverride != null ? (
                  <span style={{ fontSize: '0.875rem' }}>
                    {labels.priceOverride}:{' '}
                    <strong>{formatPriceOverride(v.priceOverride)}</strong>
                  </span>
                ) : null}
                {v.stockLevel != null ? (
                  <span style={{ fontSize: '0.875rem' }}>
                    {outOfStock ? labels.outOfStock : `${labels.stockLevel}: ${v.stockLevel}`}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function describeAttributeValues(values: Record<string, unknown>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return '—';
  return entries
    .map(([key, value]) => `${capitalize(key)}: ${formatValue(value)}`)
    .join(' · ');
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) return value.join(', ');
  return JSON.stringify(value);
}

function formatPriceOverride(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'decimal', minimumFractionDigits: 2 }).format(
    value,
  );
}
