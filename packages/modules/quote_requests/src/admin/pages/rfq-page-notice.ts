/**
 * Issue #1499 (UX audit SALES-17) — the one banner the quote-request screen
 * shows above its tabs, if any.
 *
 * The screen used to stack every banner it had: an error, the last action's
 * success, the PDF outcome, the cancellation reason, the lapsed deadline and
 * the unsaved draft, so each competed with the others (Von Restorff). Action
 * results now sit beside their buttons and the cancellation reason in the
 * header; what is left is ranked here:
 *
 * 1. **`error`** — the last action was refused, or a re-read failed. It is
 *    transient (the next action clears it) and the operator has to know now.
 * 2. **`validity`** — the deadline lapsed: it holds back Approve or the basket,
 *    and the banner carries the one remedy. The header's badge still says so
 *    while an error takes the place.
 * 3. **`draft`** — the Modify tab holds unsaved changes, said only away from
 *    that tab: on it, the save bar already says "Unsaved changes" beside Save.
 *    The tab's own marker says it whenever another banner takes the place.
 */
export type RfqPageNotice = 'error' | 'validity' | 'draft';

export interface RfqPageNoticeInput {
  /** An action was refused or the request could not be re-read. */
  error: boolean;
  /** The deadline lapsed on a status where it still decides something. */
  validityLapsed: boolean;
  /** The Modify tab holds unsaved changes. */
  draftOpen: boolean;
  /** The Modify tab is the one open. */
  onModifyTab: boolean;
}

export function rfqPageNotice(input: RfqPageNoticeInput): RfqPageNotice | null {
  if (input.error) return 'error';
  if (input.validityLapsed) return 'validity';
  if (input.draftOpen && !input.onModifyTab) return 'draft';
  return null;
}
