import type { ReactElement } from 'react';
import type { Field } from '@measured/puck';
import type { HideOn } from '../types/responsive.js';

const HIDE_ON_OPTIONS: { key: keyof HideOn; label: string }[] = [
  { key: 'mobile', label: 'Mobile' },
  { key: 'tablet', label: 'Tablet' },
  { key: 'desktop', label: 'Desktop' },
];

export function createHideOnField(): Field<HideOn | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Hide on',
    render: ({ value, onChange, readOnly }): ReactElement => {
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
        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-xs font-medium text-muted-foreground">Hide on</p>
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
        </div>
      );
    },
  };
}
