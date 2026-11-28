import type { ReactNode } from 'react';
import type { DeclaredFieldInputProps } from '@endora-commerce/admin-kit/components';

/**
 * The help an override gives and the error a refused save maps onto a field
 * (`specs/193-admin-form-extensions/` WP-E1), for this module's `{ field }`
 * renderers — the declared form's renderer kind that draws its own label, so
 * the screens keep the markup their tests and their operators know.
 *
 * Both are rendered **only when there is something to say**, so a form with no
 * override and no error is exactly the markup it was before it adopted. The ids
 * are derived from the control's, and {@link describedBy} joins them with the
 * ids the control already had.
 */
export function DeclaredFieldNotes({ id, field }: { readonly id: string; readonly field: Pick<DeclaredFieldInputProps, 'helpOverride' | 'error'> }): ReactNode {
  return (
    <>
      {field.helpOverride !== undefined ? (
        <p id={`${id}-declared-help`} className="text-xs text-muted-foreground">
          {field.helpOverride}
        </p>
      ) : null}
      {field.error !== undefined ? (
        <p id={`${id}-declared-error`} role="alert" className="text-xs font-medium text-destructive">
          {field.error}
        </p>
      ) : null}
    </>
  );
}

/** `aria-describedby` for a control: the error first, then the override's help, then what it had; `undefined` when none. */
export function describedBy(
  id: string,
  field: Pick<DeclaredFieldInputProps, 'helpOverride' | 'error'>,
  ...existing: (string | false | null | undefined)[]
): string | undefined {
  const ids = [
    field.error !== undefined ? `${id}-declared-error` : null,
    field.helpOverride !== undefined ? `${id}-declared-help` : null,
    ...existing,
  ].filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  return ids.length === 0 ? undefined : ids.join(' ');
}

/** The control's invalid state, as `aria-invalid` wants it: present only when there is an error. */
export function invalidOf(field: Pick<DeclaredFieldInputProps, 'error'>): { 'aria-invalid'?: true } {
  return field.error !== undefined ? { 'aria-invalid': true } : {};
}
