// `quote_requests`' hookable actions — issue #1906, the mechanism of
// `specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md` §6).
//
// The buyer's create **is** the submission: one write raises the request as
// `Pending`, with its lines, revision 1, the `created` and `submitted` history
// entries and the operators' "new quote request" notification records. There is
// no draft that is submitted later, so there is one action for it, not two. It
// is the write `createForCustomer` runs — the storefront's `POST /api/v1/quote-requests`
// and every in-process caller of `RfqCustomerPort.createForCustomer` (a cart, a
// shopping list or a quick order turned into a quote, an order cloned into one).
// The buyer's *Submit again* (`POST /api/v1/quote-requests/:id/resubmit`) raises
// a **new** request the same way, from an earlier one's lines, and is the second
// action, `quote_request.resubmit`, with the same capability.
//
// The action string, the phases and the data types are a public contract:
// changing one is a changeset on `@endora-commerce/contracts`.
//
// **Ids, codes and counts only** (`specs/conventions/audit-state.md` list 1), as
// the precedents (#1843, #1844, #1845) expose them. The header note, the lines,
// the products and the prices are the buyer's and stay out of both phases; a
// hook that needs them re-reads the request through `quoteRequestReadPort`
// after the commit. A buyer's create stores no custom-field values, so neither
// phase names any.
//
// **The one thing a `beforeCommit` hook may change is the assignee**, through
// `assign` on its data: the owner runs its own `quote_request.assign` Command as
// a child of the write (the sanctioned way for a hook to change another
// module's row, `command-hooks-api.md` §5) and re-records the operators' side of
// the "new quote request" notifications, so they go to the assignee the hook
// chose. That is why the `beforeCommit` data is its own type rather than the
// outbox row's.
//
// The operator's share (`specs/192-quote-request-draft-share/`, `contracts/share-hook.md`)
// is the third action, `quote_request.share`, `beforeCommit` only.
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

/**
 * `quote_request.create` — a buyer raised and submitted a quote request.
 * The `afterCommit` row: ids, codes and counts only.
 *
 * `organizationId` is also the row's routing: its handler runs in a context
 * pinned to that Organization.
 */
export type QuoteRequestCreateOutbox = {
  readonly quoteRequestId: string;
  readonly organizationId: string;
  /** The customer account that raised it — the request's owner. */
  readonly customerAccountId: string;
  /** The sales channel it was raised on; `null` outside a request scope (a worker). */
  readonly salesChannelId: string | null;
  /** The administrator it is assigned to when it commits — a `beforeCommit` hook's choice, else `null`. */
  readonly assignedAdminUserId: string | null;
  /** How many lines it was submitted with. */
  readonly itemCount: number;
};

/**
 * `quote_request.create` — the `beforeCommit` data: the outbox row's ids, read
 * on the write's open transaction, and `assign`.
 *
 * `assignedAdminUserId` is read when it is asked, so a hook ordered after one
 * that assigned sees that hook's choice.
 */
export type QuoteRequestCreateHookData = QuoteRequestCreateOutbox & QuoteRequestAssignInWrite;

/**
 * `quote_request.resubmit` — a buyer submitted again: a **new** request (`quoteRequestId`),
 * raised from the lines of `sourceQuoteRequestId`, which is left as it was.
 * The `afterCommit` row, routed to `organizationId`.
 */
export type QuoteRequestResubmitOutbox = QuoteRequestCreateOutbox & {
  /** The request it was submitted again from. */
  readonly sourceQuoteRequestId: string;
};

/** `quote_request.resubmit` — the `beforeCommit` data: the outbox row's ids and `assign`. */
export type QuoteRequestResubmitHookData = QuoteRequestResubmitOutbox & QuoteRequestAssignInWrite;

/** The one change a `beforeCommit` hook on the buyer's create or resubmit may make to the request. */
export type QuoteRequestAssignInWrite = {
  /**
   * Make `adminUserId` the request's assignee, inside this write. Callable only
   * from a `beforeCommit` hook on the action whose data carries it, while it runs.
   *
   * The administrator must be **active**, hold **`rfqs:handle`** and **reach the
   * request's Organization** (their admin tenant scope includes it — for a sales
   * representative, the representative reach rule). Otherwise it throws
   * `422 RFQ_ASSIGNEE_NOT_ELIGIBLE` (with `details.code: 'submission'`, the
   * sentence worded for the buyer) and writes nothing, so a hook may catch it
   * and try its next candidate; uncaught, it refuses the buyer's submission.
   *
   * Eligible, it runs `quote_request.assign` as a child Command of the write —
   * its own audit entry, `source` set to the hook's module id — and re-records
   * the operators' notifications of the submission, which then go to that
   * administrator (and to the Organization's representatives). Assigning the
   * current assignee again writes nothing.
   */
  assign(adminUserId: string): Promise<void>;
};

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
 * The refs a hook author registers against
 * (`ctx.commandHooks([{ on: QUOTE_REQUEST_HOOKABLE_ACTIONS.create, … }])`, with
 * `quote_requests` among the hook module's manifest `dependencies`) and the
 * `quote_requests` manifest lists. `create` and `resubmit` offer both phases;
 * `share` offers `beforeCommit` only — no consumer reads an outbox row of a share yet.
 *
 * The operator's writes (`quote_request.create_on_behalf`, `.modify`, `.assign`,
 * `.approve`, `.cancel`, `.custom_fields.update`) and the buyer's other writes
 * (`.patch_draft`, `.respond_to_revision`, `.convert_to_order`) are not declared.
 */
export const QUOTE_REQUEST_HOOKABLE_ACTIONS = {
  create: hookableAction<QuoteRequestCreateHookData, QuoteRequestCreateOutbox>('quote_request.create', 'quote_request', [
    'beforeCommit',
    'afterCommit',
  ]),
  resubmit: hookableAction<QuoteRequestResubmitHookData, QuoteRequestResubmitOutbox>(
    'quote_request.resubmit',
    'quote_request',
    ['beforeCommit', 'afterCommit'],
  ),
  share: hookableAction<QuoteRequestShareHookData>('quote_request.share', 'quote_request', ['beforeCommit']),
} as const;
