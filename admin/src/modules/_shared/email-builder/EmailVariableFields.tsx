import { useRef } from 'react';
import type { CustomField } from '@measured/puck';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { insertAtCursor } from './insert-at-cursor';
import { useEmailVariables } from './EmailVariablesProvider';

type FieldProps = {
  value?: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  field: { label?: string; placeholder?: string };
};

function VariableFieldShell({
  multiline,
  value,
  onChange,
  readOnly,
  field,
}: FieldProps & { multiline: boolean }): React.ReactElement {
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const { openPicker } = useEmailVariables();

  const insert = (snippet: string): void => {
    const el = ref.current;
    const current = value ?? '';
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAtCursor(current, snippet, start, end);
    onChange(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        {field.label ? <span className="text-sm font-medium">{field.label}</span> : <span />}
        <Button type="button" variant="outline" size="sm" disabled={readOnly} onClick={() => openPicker(insert)}>
          Variable
        </Button>
      </div>
      {multiline ? (
        <Textarea
          ref={ref as React.RefObject<HTMLTextAreaElement>}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          rows={4}
          placeholder={field.placeholder}
        />
      ) : (
        <Input
          ref={ref as React.RefObject<HTMLInputElement>}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={readOnly}
          placeholder={field.placeholder}
        />
      )}
    </div>
  );
}

/** Puck custom field: single-line text + variable insert. */
export const emailTextWithVariablesField: CustomField<string> = {
  type: 'custom',
  render: (props) => <VariableFieldShell {...props} multiline={false} />,
};

/** Puck custom field: textarea + variable insert. */
export const emailTextareaWithVariablesField: CustomField<string> = {
  type: 'custom',
  render: (props) => <VariableFieldShell {...props} multiline />,
};

export function EmailSubjectWithVariables({
  value,
  onChange,
  disabled,
  id,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}): React.ReactElement {
  const ref = useRef<HTMLInputElement | null>(null);
  const { openPicker } = useEmailVariables();

  const insert = (snippet: string): void => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAtCursor(value, snippet, start, end);
    onChange(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1"
      />
      <Button type="button" variant="outline" disabled={disabled} onClick={() => openPicker(insert)}>
        Variable
      </Button>
    </div>
  );
}
