import type { ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { PuckFieldLabel } from './puck-field-label.js';

const inputClassName = '_Input-input_bsxfo_26';

export function createEditorNameField(): Field<string | undefined, Record<string, unknown>> {
  return {
    type: 'custom',
    label: 'Name',
    metadata: { pageBuilder: { editorChrome: true as const } },
    render: ({ value, onChange, readOnly, field }): ReactElement => (
      <PuckFieldLabel label={field.label ?? 'Name'} {...(readOnly === true ? { readOnly: true } : {})}>
        <div className="space-y-1">
          <input
            type="text"
            className={inputClassName}
            style={{ width: '100%', boxSizing: 'border-box' }}
            readOnly={readOnly}
            value={value ?? ''}
            placeholder="Optional"
            onChange={(e): void => onChange(e.target.value || undefined)}
          />
          <p className="text-xs opacity-60">
            Optional label shown in the page outline only. Does not appear on the storefront.
          </p>
        </div>
      </PuckFieldLabel>
    ),
  };
}
