import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FilterDefinition } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Industria-themed filter panel. Submits as a plain HTML form so it
 * works without JavaScript (Principle VII / FR-103). Active filter
 * values are highlighted via the `selected` map; the panel auto-renders
 * an "active filters" chip group so customers can see what's applied
 * at a glance.
 *
 * `basePath` is the route this filter panel sits on (e.g. "/catalog"
 * or "/c/lozyska"). It's used to build "Wyczyść" and per-chip ✕ remove
 * links that drop one (or all) filter param from the URL while keeping
 * the rest of `baseQuery` intact.
 */
export function FilterPanel(props: {
  filters: FilterDefinition[];
  selected: Record<string, string[]>;
  baseQuery: Record<string, string>;
  basePath: string;
  locale: string;
  /**
   * Feature 044 / US2 — when reused inside the mobile filter sheet the
   * sheet's footer owns the apply action, so the panel's own submit button
   * and the sticky/border chrome are suppressed to avoid a double control.
   */
  variant?: 'sidebar' | 'sheet';
  /**
   * Feature 086 / FR-023 — whether this page may be narrowed by price, as the
   * **server** answered it on the listing response. The panel renders no range
   * control when it may not; it never infers the answer from the display mode,
   * which it cannot see.
   */
  priceRange?: boolean;
  /** The bounds currently applied, so the inputs round-trip through the URL. */
  selectedPriceRange?: { min?: number | undefined; max?: number | undefined };
}): ReactNode {
  const t = tForLocale(props.locale);
  const showPriceRange = props.priceRange === true;
  if (props.filters.length === 0 && !showPriceRange) return null;

  const inSheet = props.variant === 'sheet';
  const activeChips = collectActiveChips(props.filters, props.selected);
  const clearAllHref = buildHref(props.basePath, props.baseQuery);

  return (
    <aside
      className={
        inSheet
          ? 'self-start'
          : 'sticky top-[132px] self-start rounded-lg border border-line bg-surface p-[18px]'
      }
    >
      <div className="mb-[14px] flex items-center justify-between">
        <h3 className="text-[14px]">{t('catalog.filters')}</h3>
        {activeChips.length > 0 ? (
          <Link className="text-[12px] text-accent hover:text-accent-hover" href={clearAllHref}>
            Wyczyść
          </Link>
        ) : null}
      </div>

      <form action="" method="GET">
        {Object.entries(props.baseQuery)
          // The two price bounds have real inputs below when the control is
          // shown; replaying them as hidden fields too would submit each name
          // twice and let the stale value win.
          .filter(([k]) => !(showPriceRange && (k === 'minPrice' || k === 'maxPrice')))
          .map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}

        {activeChips.length > 0 ? (
          <div className="pt-0">
            <h4 className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.06em] text-muted">
              Aktywne ({activeChips.length})
            </h4>
            <div className="flex flex-wrap gap-[5px]">
              {activeChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--brand-100)] bg-accent-soft py-[4px] pr-[4px] pl-[8px] font-mono text-[11px] text-accent"
                >
                  {chip.label}
                  <Link
                    href={buildHref(
                      props.basePath,
                      props.baseQuery,
                      omitFilter(props.selected, chip.attributeKey, chip.value),
                    )}
                    aria-label={`Usuń filtr: ${chip.label}`}
                    title="Usuń filtr"
                    className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-accent hover:bg-[var(--brand-100)]"
                  >
                    <XIcon />
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {showPriceRange ? (
          <div className="border-t border-line py-[14px]">
            <h4 className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.06em] text-muted">
              {t('catalog.price.heading')}
            </h4>
            <div className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-1 text-[12px] text-fg-soft">
                <span className="w-[26px] shrink-0">{t('catalog.price.min')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  name="minPrice"
                  aria-label={t('catalog.price.min')}
                  defaultValue={props.selectedPriceRange?.min ?? ''}
                  className="w-full rounded-sm border border-line bg-surface px-[8px] py-[5px] font-mono text-[12px]"
                />
              </label>
              <label className="flex flex-1 items-center gap-1 text-[12px] text-fg-soft">
                <span className="w-[26px] shrink-0">{t('catalog.price.max')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  name="maxPrice"
                  aria-label={t('catalog.price.max')}
                  defaultValue={props.selectedPriceRange?.max ?? ''}
                  className="w-full rounded-sm border border-line bg-surface px-[8px] py-[5px] font-mono text-[12px]"
                />
              </label>
            </div>
          </div>
        ) : null}

        {props.filters.map((filter) => (
          <div key={filter.attributeKey} className="border-t border-line py-[14px]">
            <h4 className="mb-[10px] flex items-center justify-between text-[12px] font-medium uppercase tracking-[0.06em] text-muted">
              {filter.label}
              <span className="inline-flex items-center text-line-strong" aria-hidden="true">
                <ChevDownIcon />
              </span>
            </h4>
            {(filter.options ?? []).map((opt) => {
              const active = (props.selected[filter.attributeKey] ?? []).includes(
                opt.value,
              );
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center justify-between py-[5px] text-[13px]"
                >
                  <span className="inline-flex items-center gap-2 text-fg-soft">
                    <input
                      type="checkbox"
                      name={`filter[attr.${filter.attributeKey}]`}
                      value={opt.value}
                      defaultChecked={active}
                      className="accent-accent"
                    />
                    {opt.label}
                  </span>
                  <span className="font-mono text-[11px] text-subtle">
                    {opt.count.toLocaleString('pl-PL')}
                  </span>
                </label>
              );
            })}
          </div>
        ))}

        {inSheet ? null : (
          <button type="submit" className="btn btn--dark btn--block mt-[14px]">
            {t('common.searchAction')}
          </button>
        )}
      </form>
    </aside>
  );
}

interface ActiveChip {
  key: string;
  attributeKey: string;
  value: string;
  label: string;
}

function collectActiveChips(
  filters: FilterDefinition[],
  selected: Record<string, string[]>,
): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const filter of filters) {
    const values = selected[filter.attributeKey] ?? [];
    for (const value of values) {
      const opt = (filter.options ?? []).find((o) => o.value === value);
      chips.push({
        key: `${filter.attributeKey}:${value}`,
        attributeKey: filter.attributeKey,
        value,
        label: opt?.label ?? value,
      });
    }
  }
  return chips;
}

function omitFilter(
  selected: Record<string, string[]>,
  attributeKey: string,
  value: string,
): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  for (const [k, vs] of Object.entries(selected)) {
    if (k === attributeKey) {
      const remaining = vs.filter((v) => v !== value);
      if (remaining.length > 0) next[k] = remaining;
    } else {
      next[k] = vs;
    }
  }
  return next;
}

function buildHref(
  basePath: string,
  baseQuery: Record<string, string>,
  selected: Record<string, string[]> = {},
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(baseQuery)) {
    // `cursor` is paging state — discard it when filters change so the
    // listing rewinds to page 1.
    if (k === 'cursor') continue;
    params.set(k, v);
  }
  for (const [key, values] of Object.entries(selected)) {
    for (const value of values) {
      params.append(`filter[attr.${key}]`, value);
    }
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function svg(children: ReactNode, size = 13): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function XIcon(): ReactNode {
  return svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    11,
  );
}

function ChevDownIcon(): ReactNode {
  return svg(<polyline points="6 9 12 15 18 9" />, 13);
}
