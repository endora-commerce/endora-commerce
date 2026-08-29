import type { ReactNode } from 'react';

/**
 * The live region a reorderable list speaks through (FR-069, SC-014).
 *
 * Two rules make the difference between this working and this being decoration:
 *
 *  - it is **mounted for the lifetime of the list**, never rendered
 *    conditionally when there is something to say. A region created at the
 *    moment of its first message is not announced by any screen reader — the
 *    node has to exist before the text changes inside it.
 *  - it carries `role="status"` **and** `aria-live="polite"`, because the two
 *    are honoured inconsistently across the screen-reader/browser matrix and
 *    together they are what actually works everywhere.
 *
 * `aria-atomic` makes the whole sentence read out rather than the diff, which
 * matters because consecutive moves differ by one word ("position 3 of 23").
 */

export interface ReorderAnnouncerProps {
  /** The current sentence. Empty is fine, and is the normal resting state. */
  message: string;
  /**
   * The keyboard instructions every handle points at through
   * `aria-describedby`. Rendered once per list, visually hidden.
   */
  instructions?: string;
  instructionsId?: string;
}

export function ReorderAnnouncer(props: ReorderAnnouncerProps): ReactNode {
  const { message, instructions, instructionsId } = props;
  return (
    <>
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
      {instructions !== undefined ? (
        <p id={instructionsId} className="sr-only">
          {instructions}
        </p>
      ) : null}
    </>
  );
}
