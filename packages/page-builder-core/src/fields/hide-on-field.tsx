import type { ReactElement } from 'react';
import type { Field } from '@measured/puck';
import type { HideOn } from '../types/responsive.js';
import { PuckFieldLabel } from './puck-field-label.js';

const HIDE_ON_OPTIONS: { key: keyof HideOn; label: string }[] = [
  { key: 'mobile', label: 'Mobile' },
  { key: 'tablet', label: 'Tablet' },
  { key: 'desktop', label: 'Desktop' },
];

export function createHideOnField(): Field<HideOn | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Hide on',
    render: ({ value, onChange, readOnly, field }): ReactElement => {
      const hideOn = value ?? {};
      const toggle = (key: keyof HideOn): void => {
        const next = { ...hideOn, [key]: !hideOn[key] };
        if (!next.mobile && !next.tablet && !next.desktop) {
          onChange(undefined);
          return;
        }
        onChange(next);
      };

      return (
        <PuckFieldLabel label={field.label ?? 'Hide on'} {...(readOnly === true ? { readOnly: true } : {})}>
          <div className="flex flex-col gap-2">
            {HIDE_ON_OPTIONS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={hideOn[key] === true}
                  onChange={(): void => toggle(key)}
                />
                {label}
              </label>
            ))}
          </div>
        </PuckFieldLabel>
      );
    },
  };
}
