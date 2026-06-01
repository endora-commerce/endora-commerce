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
}): ReactNode {
  const t = tForLocale(props.locale);
  if (props.filters.length === 0) return null;

  const activeChips = collectActiveChips(props.filters, props.selected);
  const clearAllHref = buildHref(props.basePath, props.baseQuery);

  return (
    <aside className="industria-filters">
      <div className="industria-filters__head">
        <h3>{t('catalog.filters')}</h3>
        {activeChips.length > 0 ? (
          <Link className="industria-filters__head__clear" href={clearAllHref}>
            Wyczyść
          </Link>
        ) : null}
      </div>

      <form action="" method="GET">
        {Object.entries(props.baseQuery).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        {activeChips.length > 0 ? (
          <div
            className="industria-filters__group"
            style={{ borderTop: 0, paddingTop: 0 }}
          >
            <h4>Aktywne ({activeChips.length})</h4>
            <div className="industria-filters__chips">
              {activeChips.map((chip) => (
                <span key={chip.key} className="industria-chip">
                  {chip.label}
                  <Link
                    href={buildHref(
                      props.basePath,
                      props.baseQuery,
                      omitFilter(props.selected, chip.attributeKey, chip.value),
                    )}
                    aria-label={`Usuń filtr: ${chip.label}`}
                    title="Usuń filtr"
                  >
                    <XIcon />
                  </Link>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {props.filters.map((filter) => (
          <div key={filter.attributeKey} className="industria-filters__group">
            <h4>
              {filter.label}
              <span className="industria-filters__chev" aria-hidden="true">
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
                  className="industria-filters__opt"
                >
                  <span>
                    <input
                      type="checkbox"
                      name={`filter[attr.${filter.attributeKey}]`}
                      value={opt.value}
                      defaultChecked={active}
                    />
                    {opt.label}
                  </span>
                  <span className="industria-filters__opt__count">
                    {opt.count.toLocaleString('pl-PL')}
                  </span>
                </label>
              );
            })}
          </div>
        ))}

        <button
          type="submit"
          className="btn btn--dark btn--block"
          style={{ marginTop: 14 }}
        >
          {t('common.searchAction')}
        </button>
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
