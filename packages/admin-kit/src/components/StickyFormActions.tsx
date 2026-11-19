import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils.js';
import { UnsavedChangesHint } from './unsaved-changes/UnsavedChangesGuard.js';

/**
 * The one fixed place of an editor's single Save — issue #1449 (UX audit 2026-11-17, DS-19),
 * on top of feature 180's one Save (`specs/180-one-save-zone-editors/`).
 *
 * Below 1024 px the bar is fixed to the bottom of the viewport, where the thumb already is
 * (Fitts); `.b2b-page:has(.b2b-sticky-form-actions)` pads the page so nothing hides under it.
 * At ≥ 1024 px it follows `desktop`:
 *
 * - **`inline`** (the default) — an ordinary row where it is mounted. Use it where the place
 *   itself stays in view: a `PageHeader`'s `actions`, a sticky scope bar.
 * - **`sticky`** — `position: sticky; bottom: 0` at the end of a long editor, so Save stays in
 *   view while the operator scrolls the form and settles at the end of it. Mount it as the
 *   **last child of the form (or the page wrapper) it commits**, outside every card and every
 *   zone panel the Save covers: a sticky box cannot leave its parent, and a Save drawn inside a
 *   panel reads as that panel's Save (Common Region).
 *
 * The structured slots lay out the hierarchy once:
 *
 * - **`primary`** — the one filled action, drawn **last** (Von Restorff, Jakob). The bar adds
 *   the `note` to its `aria-describedby`, keeping whatever description it already had.
 * - **`secondary`** — Cancel, Discard, Save draft: `outline` or `ghost`, before the primary.
 * - **`note`** — one muted line on what Save does ("The customer is notified").
 * - **`dirty`** — given, the kit's `UnsavedChangesHint` sits in the bar (Zeigarnik).
 * - **`error`** / **`status`** — the last save's refusal and outcome, beside the button that
 *   caused them (Proximity) rather than at the top of the page, out of view. Both regions are
 *   mounted empty from the first render, so the text that arrives is announced (WCAG 4.1.3);
 *   an error carries an icon as well as its words, never colour alone. While there is an
 *   error the status is not shown, so the bar never says "Saved" beside a refusal.
 *
 * `children` is the free layout of the callers that predate the slots, drawn after them.
 * `.b2b-sticky-form-actions` is unlayered CSS, so a utility in `className` does not override
 * its `display` or padding — lay out inside it instead.
 */
export interface StickyFormActionsProps {
  /** The one primary action, normally the Save submit button. */
  primary?: ReactNode;
  /** Secondary actions (Cancel, Discard, Save draft), drawn before the primary. */
  secondary?: ReactNode;
  /** One muted line on what the primary does; it also describes the primary. */
  note?: ReactNode;
  /** Shows "Unsaved changes" while true; leave it out where the screen shows no such hint. */
  dirty?: boolean;
  /** The last save's refusal, in an alert region inside the bar. */
  error?: ReactNode;
  /** The last save's outcome ("Saved"), in a status region inside the bar. */
  status?: ReactNode;
  /** The desktop placement — see the component's documentation. Defaults to `inline`. */
  desktop?: 'inline' | 'sticky';
  /** Free-form content, for callers that lay the bar out themselves. */
  children?: ReactNode;
  className?: string;
}

function isFilled(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function StickyFormActions(props: StickyFormActionsProps): ReactNode {
  const { primary, secondary, note, dirty, error, status, desktop = 'inline', children, className } = props;
  const noteId = useId();
  const structured =
    primary !== undefined ||
    secondary !== undefined ||
    note !== undefined ||
    dirty !== undefined ||
    error !== undefined ||
    status !== undefined;
  const hasNote = isFilled(note);
  const hasError = isFilled(error);

  let primaryNode: ReactNode = primary;
  if (hasNote && isValidElement(primary)) {
    const element = primary as ReactElement<{ 'aria-describedby'?: string }>;
    const own = element.props['aria-describedby'];
    primaryNode = cloneElement(element, {
      'aria-describedby': own === undefined || own === '' ? noteId : `${own} ${noteId}`,
    });
  }

  return (
    <div
      data-slot="sticky-form-actions"
      data-desktop={desktop}
      className={cn('b2b-sticky-form-actions', desktop === 'sticky' && 'b2b-sticky-form-actions--sticky', className)}
    >
      {structured ? (
        <div className="flex w-full flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
          <div className="flex min-w-0 flex-col gap-1 lg:mr-auto">
            <div role="alert" className="text-sm font-medium text-destructive">
              {hasError ? (
                <span className="flex items-start gap-1.5">
                  <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  <span>{error}</span>
                </span>
              ) : null}
            </div>
            <p role="status" className="text-sm text-muted-foreground">
              {hasError ? null : status}
            </p>
            {dirty === undefined ? null : <UnsavedChangesHint dirty={dirty} />}
            {hasNote ? (
              <p id={noteId} className="text-xs text-muted-foreground">
                {note}
              </p>
            ) : null}
          </div>
          {/* Full-width, 44 px targets in the phone bar (Fitts); a right-aligned row on desktop. */}
          <div className="flex flex-wrap items-center gap-2 max-lg:*:min-h-11 max-lg:*:flex-1">
            {secondary}
            {primaryNode}
          </div>
        </div>
      ) : null}
      {children}
    </div>
  );
}
