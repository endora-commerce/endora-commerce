'use client';

import { useMemo, useState, type ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { FieldLabel } from '@measured/puck';
import {
  CMS_ICON_CATALOG,
  humanizeIconName,
  resolveCmsIcon,
  type CmsIconName,
} from './icon-catalog.js';

function IconPickerControl({
  value,
  onChange,
  readOnly,
  label,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  readOnly?: boolean;
  label: string;
}): ReactElement {
  const [query, setQuery] = useState('');
  const selected = (value && value in CMS_ICON_CATALOG ? value : 'star') as CmsIconName;
  const SelectedIcon = resolveCmsIcon(selected);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const names = Object.keys(CMS_ICON_CATALOG) as CmsIconName[];
    if (!q) return names;
    return names.filter(
      (name) => name.toLowerCase().includes(q) || humanizeIconName(name).toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <FieldLabel label={label} {...(readOnly === true ? { readOnly: true } : {})}>
      <div className="cmsc-pb-icon-picker">
        <div className="cmsc-pb-icon-picker__selected">
          {SelectedIcon ? <SelectedIcon size={22} aria-hidden /> : null}
          <span>{humanizeIconName(selected)}</span>
        </div>
        <input
          type="search"
          className="cmsc-pb-icon-picker__search"
          placeholder="Search icons…"
          value={query}
          disabled={readOnly === true}
          onChange={(e): void => setQuery(e.target.value)}
        />
        <div className="cmsc-pb-icon-picker__grid" role="listbox" aria-label="Icons">
          {filtered.map((name) => {
            const Icon = CMS_ICON_CATALOG[name];
            const isActive = name === selected;
            return (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={isActive}
                title={humanizeIconName(name)}
                disabled={readOnly === true}
                className={`cmsc-pb-icon-picker__item${isActive ? ' cmsc-pb-icon-picker__item--active' : ''}`}
                onClick={(): void => onChange(name)}
              >
                <Icon size={18} aria-hidden />
              </button>
            );
          })}
        </div>
        {filtered.length === 0 ? (
          <p className="cmsc-pb-icon-picker__empty">No icons match “{query}”.</p>
        ) : null}
      </div>
    </FieldLabel>
  );
}

export function createIconPickerField(label = 'Icon'): Field<string> {
  return {
    type: 'custom',
    label,
    render: ({ value, onChange, readOnly }) => (
      <IconPickerControl
        value={value}
        onChange={onChange}
        label={label}
        {...(readOnly === true ? { readOnly: true } : {})}
      />
    ),
  };
}
