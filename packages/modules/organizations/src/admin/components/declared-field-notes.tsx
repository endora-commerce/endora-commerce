import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * The error region of a declared field this module's screens cannot wrap in
 * the kit's `FormField` (`specs/193-admin-form-extensions/` WP-E1): the
 * registered address, a fieldset of four inputs, the sales-channel checklist,
 * a group with a label of its own, and the fulfilment strategy, a section of
 * its own. Every other declared field is a `FormField`.
 *
 * It is `FormField`'s error block, to the class: **always mounted**, empty
 * until there is an error, `aria-live="polite"` — a live region that arrives
 * carrying its message is not reliably announced (WCAG 2.2 SC 4.1.3) — and the
 * message paired with an icon, so the state is never colour alone. The
 * controls name it with {@link declaredErrorId} in `aria-describedby` while it
 * holds an error.
 */
export function DeclaredFieldError({ id, error }: { readonly id: string; readonly error: string | undefined }): ReactNode {
  const hasError = error !== undefined;
  return (
    <p
      id={declaredErrorId(id)}
      aria-live="polite"
      className={hasError ? 'mt-1 flex items-start gap-1 text-xs font-medium text-destructive' : 'text-xs font-medium text-destructive'}
    >
      {hasError ? (
        <>
          <AlertCircle aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </>
      ) : null}
    </p>
  );
}

/** The id of the error region of the field whose controls share `id` as a prefix. */
export function declaredErrorId(id: string): string {
  return `${id}-declared-error`;
}

/** `aria-describedby` for a control: the error while there is one, then what it had; `undefined` when none. */
export function describedBy(id: string, error: string | undefined, ...existing: (string | false | null | undefined)[]): string | undefined {
  const ids = [error !== undefined ? declaredErrorId(id) : null, ...existing].filter(
    (entry): entry is string => typeof entry === 'string' && entry !== '',
  );
  return ids.length === 0 ? undefined : ids.join(' ');
}
