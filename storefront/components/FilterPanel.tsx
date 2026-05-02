import type { ReactNode } from 'react';
import type { FilterDefinition } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Industria-themed filter panel. Submits as a plain HTML form so it
 * works without JavaScript (Principle VII / FR-103). Active filter
 * values are highlighted via the `selected` map; the panel auto-renders
 * an "active filters" chip group so customers can see what's applied
 * at a glance.
 */
export function FilterPanel(props: {
  filters: FilterDefinition[];
  selected: Record<string, string[]>;
  baseQuery: Record<string, string>;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  if (props.filters.length === 0) return null;

  const activeChips = collectActiveChips(props.filters, props.selected);

  return (
    <aside className="industria-filters">
      <div className="industria-filters__head">
        <h3>{t('catalog.filters')}</h3>
        {activeChips.length > 0 ? <button type="button">Wyczyść</button> : null}
      </div>

      <form action="" method="GET">
        {Object.entries(props.baseQuery).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}

        {activeChips.length > 0 ? (
          <div className="industria-filters__group" style={{ borderTop: 0, paddingTop: 0 }}>
            <h4>Aktywne ({activeChips.length})</h4>
            <div className="industria-filters__chips">
              {activeChips.map((chip) => (
                <span key={chip.key} className="industria-chip">
                  {chip.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {props.filters.map((filter) => (
          <div key={filter.attributeKey} className="industria-filters__group">
            <h4>{filter.label}</h4>
            {(filter.options ?? []).map((opt) => {
              const active = (props.selected[filter.attributeKey] ?? []).includes(opt.value);
              return (
                <label key={opt.value} className="industria-filters__opt">
                  <span>
                    <input
                      type="checkbox"
                      name={`filter[attr.${filter.attributeKey}]`}
                      value={opt.value}
                      defaultChecked={active}
                    />
                    {opt.label}
                  </span>
                  <span className="industria-filters__opt__count">{opt.count.toLocaleString('pl-PL')}</span>
                </label>
              );
            })}
          </div>
        ))}

        <button type="submit" className="btn btn--dark btn--block" style={{ marginTop: 14 }}>
          {t('common.searchAction')}
        </button>
      </form>
    </aside>
  );
}

function collectActiveChips(
  filters: FilterDefinition[],
  selected: Record<string, string[]>,
): Array<{ key: string; label: string }> {
  const chips: Array<{ key: string; label: string }> = [];
  for (const filter of filters) {
    const values = selected[filter.attributeKey] ?? [];
    for (const value of values) {
      const opt = (filter.options ?? []).find((o) => o.value === value);
      chips.push({ key: `${filter.attributeKey}:${value}`, label: opt?.label ?? value });
    }
  }
  return chips;
}
