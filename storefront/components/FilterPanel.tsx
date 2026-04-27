import type { ReactNode } from 'react';
import type { FilterDefinition } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';

/**
 * Server-rendered filter panel. Submits as a plain HTML form so it works
 * without JavaScript (Principle VII / FR-103). Active filter values are
 * passed in as a `selected` map so the panel reflects the current URL.
 */
export function FilterPanel(props: {
  filters: FilterDefinition[];
  selected: Record<string, string[]>;
  baseQuery: Record<string, string>;
  locale: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  if (props.filters.length === 0) return null;
  return (
    <aside className="b2b-filters">
      <h2>{t('catalog.filters')}</h2>
      <form action="" method="GET">
        {Object.entries(props.baseQuery).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        {props.filters.map((filter) => (
          <fieldset key={filter.attributeKey}>
            <legend>{filter.label}</legend>
            {(filter.options ?? []).map((opt) => {
              const active = (props.selected[filter.attributeKey] ?? []).includes(opt.value);
              return (
                <label key={opt.value}>
                  <input
                    type="checkbox"
                    name={`filter[attr.${filter.attributeKey}]`}
                    value={opt.value}
                    defaultChecked={active}
                  />
                  {opt.label}
                  <span className="b2b-filters__count"> ({opt.count})</span>
                </label>
              );
            })}
          </fieldset>
        ))}
        <button type="submit" className="b2b-filters__apply">
          {t('common.searchAction')}
        </button>
      </form>
    </aside>
  );
}
