'use client';

import type { ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { CATALOG_DATA_FIELD_META } from './catalog-data-fields.js';

const inputClassName = '_Input-input_bsxfo_26';

function FieldShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium opacity-80">{label}</label>
      {children}
    </div>
  );
}

export function createCatalogSlugFallbackField(label: string): Field<string | undefined> {
  return {
    type: 'custom',
    label,
    metadata: CATALOG_DATA_FIELD_META,
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <FieldShell label={field.label ?? label}>
        <input
          className={inputClassName}
          readOnly={readOnly === true}
          value={typeof value === 'string' ? value : ''}
          placeholder="Slug"
          onChange={(e): void => onChange(e.target.value)}
        />
      </FieldShell>
    ),
  };
}

export function createCatalogSlugsFallbackField(label: string): Field<string[] | undefined> {
  return {
    type: 'custom',
    label,
    metadata: CATALOG_DATA_FIELD_META,
    render: ({ value, onChange, readOnly, field }): ReactElement => {
      const slugs = Array.isArray(value) ? value : [];
      const text = slugs.join(', ');
      return (
        <FieldShell label={field.label ?? label}>
          <textarea
            className={inputClassName}
            readOnly={readOnly === true}
            rows={3}
            value={text}
            placeholder="slug-one, slug-two"
            onChange={(e): void => {
              const next = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              onChange(next);
            }}
          />
        </FieldShell>
      );
    },
  };
}
