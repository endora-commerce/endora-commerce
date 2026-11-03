'use client';

import type { ReactNode, Ref } from 'react';

/**
 * The error summary of `forms.Form` (`specs/170-forms-module/` research R-28, FR-069): every
 * refused field, each a link to its control, under a title — rendered on the server for the no-JS
 * path and focused first on a JavaScript refusal, so the shopper hears what to fix before being
 * moved to the first field. An icon and text, never colour alone. Renders nothing without errors.
 */
export interface FormErrorSummaryProps {
  /** The element id, so the block can move focus here. */
  id: string;
  title: string;
  errors: readonly { targetId: string; message: string }[];
  /** The summary's element, so the block can focus it after a refusal. */
  ref?: Ref<HTMLDivElement> | undefined;
}

export function FormErrorSummary({ id, title, errors, ref }: FormErrorSummaryProps): ReactNode {
  if (errors.length === 0) return null;
  return (
    <div id={id} ref={ref} className="cmsc-pb-form__summary" role="alert" tabIndex={-1}>
      <p className="cmsc-pb-form__summary-title">
        <ErrorIcon />
        {title}
      </p>
      <ul className="cmsc-pb-form__summary-list">
        {errors.map((error) => (
          <li key={error.targetId}>
            <a href={`#${error.targetId}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The mark beside an error's text; decorative, the text carries the meaning. */
export function ErrorIcon(): ReactNode {
  return (
    <svg className="cmsc-pb-form__error-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4.25M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
