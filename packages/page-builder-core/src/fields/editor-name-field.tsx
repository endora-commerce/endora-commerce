import type { ReactElement } from 'react';
import type { Field } from '@measured/puck';
import { AutoField } from '@measured/puck';

export function createEditorNameField(): Field<string | undefined, Record<string, unknown>> {
  return {
    type: 'text',
    label: 'Name',
    metadata: { pageBuilder: { editorChrome: true as const } },
  };
}

/** Puck AutoField wrapper for consistent sidebar styling. */
export function PuckStyledField<Value>({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: Field<Value, Record<string, unknown>>;
  value: Value;
  onChange: (value: Value) => void;
  readOnly?: boolean;
}): ReactElement {
  return (
    <AutoField
      field={field}
      value={value}
      onChange={onChange}
      {...(readOnly === undefined ? {} : { readOnly })}
    />
  );
}
