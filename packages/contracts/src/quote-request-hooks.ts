// `quote_requests`' hookable actions — `specs/192-quote-request-draft-share/`
// (`contracts/share-hook.md`), the mechanism of `specs/176-command-hooks-outbox/`.
//
// Sharing an operator's unshared quote with its customer is the point another
// module may refuse — say, while an approval is still pending (FR-028). A hook
// registered on `beforeCommit` runs inside the share's transaction, after the
// built-in refusals passed and the row was written shared; throwing an
// `HttpError` (`CommandHookRefusal`) rolls the whole share back and the caller
// receives that status, code and details. The action id and object type are
// frozen, `phases` and the hook data are additive-only
// (`specs/conventions/contract-surface.md`).
//
// **Ids, counts and dates only** (`specs/conventions/audit-state.md` list 1). A
// hook that needs the lines re-reads them through `quoteRequestReadPort.listItems`
// (a share changes no line).

import { hookableAction } from './command-hooks.js';

/** `quote_request.share` — an operator shares an unshared quote with its customer. */
export type QuoteRequestShareHookData = {
  readonly quoteRequestId: string;
  readonly organizationId: string;
  readonly customerAccountId: string;
  /** The channel the quote was raised on; `null` for a quote created outside a request scope. */
  readonly salesChannelId: string | null;
  /** The revision the customer is about to be shown. */
  readonly currentRevisionNumber: number;
  /** The validity date the share is writing (ISO 8601), or `null` (no deadline). */
  readonly expiresAt: string | null;
};

/**
 * The ref a hook author registers against
 * (`ctx.commandHooks([{ on: QUOTE_REQUEST_HOOKABLE_ACTIONS.share, phase: 'beforeCommit', … }])`,
 * with `quote_requests` among the hook module's manifest `dependencies`) and the
 * `quote_requests` manifest lists. `beforeCommit` only: no consumer reads an
 * outbox row of a share yet.
 */
export const QUOTE_REQUEST_HOOKABLE_ACTIONS = {
  share: hookableAction<QuoteRequestShareHookData>('quote_request.share', 'quote_request', ['beforeCommit']),
} as const;
