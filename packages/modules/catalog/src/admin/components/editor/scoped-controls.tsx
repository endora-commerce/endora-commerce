import type { ReactNode } from 'react';
import { Input, Select } from '@endora-commerce/admin-kit/ui';
import type { ScopedFieldControlProps } from '@endora-commerce/admin-kit/components';

/**
 * Feature 170 (`contracts/editor-ui.md` §11) — the controls `ScopedField` renders, one per value
 * kind. An empty input reports `null` (an empty value); an inherited select renders as a
 * read-only text input showing the option's label, because a native `select` has no
 * `readonly` and §4 forbids `disabled`.
 */

export function TextControl({
  value,
  readOnly,
  onChange,
  inputProps,
  mono = false,
  maxLength,
  placeholder,
}: ScopedFieldControlProps<string> & { mono?: boolean; maxLength?: number; placeholder?: string }): ReactNode {
  return (
    <Input
      {...inputProps}
      type="text"
      className={mono ? 'font-mono' : undefined}
      readOnly={readOnly}
      value={value ?? ''}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

export function TextareaControl({
  value,
  readOnly,
  onChange,
  inputProps,
  rows = 4,
}: ScopedFieldControlProps<string> & { rows?: number }): ReactNode {
  return (
    <textarea
      {...inputProps}
      className="b2b-field"
      rows={rows}
      readOnly={readOnly}
      value={value ?? ''}
      onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectControl({
  value,
  readOnly,
  onChange,
  inputProps,
  options,
  noneLabel,
}: ScopedFieldControlProps<string> & { options: readonly SelectOption[]; noneLabel?: string }): ReactNode {
  if (readOnly) {
    const label = options.find((o) => o.value === value)?.label ?? (value === null ? '' : String(value));
    return <Input {...inputProps} type="text" readOnly value={label} />;
  }
  return (
    <Select {...inputProps} value={value ?? ''} onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)}>
      {noneLabel !== undefined ? <option value="">{noneLabel}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** A boolean as a two-option select ("Yes / No", "Shown / Hidden"), never a checkbox (§11). */
export function BooleanControl({
  value,
  readOnly,
  onChange,
  inputProps,
  trueLabel,
  falseLabel,
}: ScopedFieldControlProps<boolean> & { trueLabel: string; falseLabel: string }): ReactNode {
  const options = [
    { value: 'true', label: trueLabel },
    { value: 'false', label: falseLabel },
  ];
  return (
    <SelectControl
      value={value === null ? null : String(value)}
      readOnly={readOnly}
      inputProps={inputProps}
      options={options}
      onChange={(next): void => onChange(next === null ? null : next === 'true')}
    />
  );
}

export function NumberControl({
  value,
  readOnly,
  onChange,
  inputProps,
  min,
  integer = true,
}: ScopedFieldControlProps<number> & { min?: number; integer?: boolean }): ReactNode {
  return (
    <Input
      {...inputProps}
      type="number"
      inputMode={integer ? 'numeric' : 'decimal'}
      step={integer ? 1 : 'any'}
      min={min}
      readOnly={readOnly}
      value={value === null ? '' : String(value)}
      onChange={(e): void => {
        const raw = e.target.value;
        if (raw === '') {
          onChange(null);
          return;
        }
        const n = Number(raw);
        if (Number.isFinite(n)) onChange(n);
      }}
    />
  );
}

/** ISO instant ⇄ the operator's `datetime-local` value. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface WindowValue {
  from: string | null;
  until: string | null;
}

/** The publication window: two `datetime-local` inputs; an empty bound is no limit. */
export function WindowControl({
  value,
  readOnly,
  onChange,
  inputProps,
  fromLabel,
  untilLabel,
}: ScopedFieldControlProps<WindowValue> & { fromLabel: string; untilLabel: string }): ReactNode {
  const current = value ?? { from: null, until: null };
  const emit = (next: WindowValue): void => onChange(next.from === null && next.until === null ? null : next);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs">
        <span>{fromLabel}</span>
        <Input
          id={inputProps.id}
          aria-describedby={inputProps['aria-describedby']}
          aria-invalid={inputProps['aria-invalid']}
          type="datetime-local"
          readOnly={readOnly}
          value={isoToLocalInput(current.from)}
          onChange={(e): void => emit({ ...current, from: localInputToIso(e.target.value) })}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span>{untilLabel}</span>
        <Input
          id={`${inputProps.id}-until`}
          aria-describedby={inputProps['aria-describedby']}
          aria-invalid={inputProps['aria-invalid']}
          type="datetime-local"
          readOnly={readOnly}
          value={isoToLocalInput(current.until)}
          onChange={(e): void => emit({ ...current, until: localInputToIso(e.target.value) })}
        />
      </label>
    </div>
  );
}
