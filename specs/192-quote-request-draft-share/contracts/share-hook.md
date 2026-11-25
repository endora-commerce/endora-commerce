# Contract: the `quote_request.share` hookable action (FR-028)

Feature `specs/192-quote-request-draft-share/`, research R-4. Mechanism:
`specs/176-command-hooks-outbox/` (`contracts/command-hooks-api.md`). Contract-surface tiers:
`specs/conventions/contract-surface.md` — the action id and object type are **frozen**, `phases`
is **additive-only**, the hook data is **additive-only** (read direction).

## 1. The ref (new file `packages/contracts/src/quote-request-hooks.ts`, exported from the barrel)

```ts
/** `quote_request.share` — an operator shares an unshared quote with its customer. */
export type QuoteRequestShareHookData = {
  readonly quoteRequestId: string;
  readonly organizationId: string;
  readonly customerAccountId: string;
  /** The channel the quote was raised on; `null` for a quote created outside a request scope. */
  readonly salesChannelId: string | null;
  /** The revision the customer is about to be shown. */
  readonly currentRevisionNumber: number;
  /** The validity date the share is writing, or `null` (no deadline). */
  readonly expiresAt: string | null;
};

export const QUOTE_REQUEST_HOOKABLE_ACTIONS = {
  share: hookableAction<QuoteRequestShareHookData>('quote_request.share', 'quote_request', ['beforeCommit']),
} as const;
```

Listed in `packages/modules/quote_requests/src/manifest.ts`:
`hookableActions: [QUOTE_REQUEST_HOOKABLE_ACTIONS.share].map(toHookableActionDeclaration)`.

## 2. What a hook sees and may do

- Runs inside the share Command's transaction, **after** the built-in refusals passed and the
  row was written shared (uncommitted), **before** the audit entry and the commit.
- `ctx.data` is `QuoteRequestShareHookData`; `ctx.objectId` is the quote id; `ctx.actor` is the
  sharing administrator.
- Reading the lines: `quoteRequestReadPort.listItems(quoteRequestId)` (a share changes no line).
- **Veto**: any throw rolls the share back (fail-closed); use `CommandHookRefusal`
  (`@endora-commerce/platform/commands`) for a clean refusal the admin can read, with a code the
  hook's own module declares in its manifest `errorCodes` and a sentence in its own bundle. Any
  other throw (a bug, a failed read) also rolls the share back, but reaches the caller as an
  error, not as a refusal it can act on. The bus rolls the whole Command back (row,
  `shared` event, `prepared` notification records); the caller receives that status, code and
  `details` unchanged; the admin UI shows the translated sentence. The quote stays unshared and
  nobody is told.
- Writing: only the hook module's own tables, on `ctx.em`, naming what it wrote with
  `ctx.noteAuditChanges` (176 rules).
- Ordering between several hooks: the platform's (`commandHookOrder`), not this module's.
- **Present modules only.** The bus runs a hook only while its module is present: a hook whose
  module is switched off (or not installed) is skipped, with no error and no restart. An approval
  gate written as a share hook therefore disappears with its module — shares go through ungated
  while it is off.
- **Fast.** A `beforeCommit` hook runs while the share holds the quote row's lock
  (`SELECT … FOR UPDATE`) and an open transaction, so every other write to that quote waits on
  it. Budget: **1 second** for the hook in total, well under 100 ms in the normal case. The
  budget is a **requirement on hook authors, not enforced by the bus**: the bus awaits each hook
  with no timeout while the quote row is locked `FOR UPDATE`, so a slow hook blocks every write to
  that quote for as long as it runs. No
  external I/O (HTTP, a mail server, a queue) without a timeout that fits inside that budget;
  prefer reading the hook module's own tables. A hook that cannot decide in time vetoes with its
  own code rather than holding the lock. Work that may be slow does not belong in a
  `beforeCommit` hook; until an `afterCommit` phase is offered (§4) it has no place on this
  action.
- **Admin-safe refusals.** The refusal's message and `details` reach the sharing administrator
  as they are thrown (and the bundle sentence is shown in the admin UI). They must be safe for
  that caller: no secrets, credentials, tokens or internal URLs, no stack traces, and no data of
  any other Organization than the quote's own.

## 3. What this module promises

- The Command's `action` is exactly `quote_request.share` and its `objectType` `quote_request`.
- `hookData` is supplied on every run (`COMMAND_HOOK_DATA_MISSING` never fires).
- A refused share (built-in or vetoed) records nothing: no audit row, no event, no notification.
- No other code path makes a quote shared — the future "drafts off" setting (R-2) is the one
  exception and, when it is built, must decide whether it runs these hooks (noted in R-2).

## 4. Not offered (add later, additive)

`afterCommit` (an outbox row on share) — no consumer yet. Adding it is compatible; it needs an
`OutboxData`-shaped type (list 1 only; `QuoteRequestShareHookData` already is).

## 5. Test obligations (owner side)

`expectHookableCommand` assertions (`@endora-commerce/contracts` `command-hooks.ts`; precedent `packages/modules/newsletter/src/backend/commands/subscriber-hookable-actions.test.ts`): the
Command supplies hook data; a test-only hook module registered through `sealedCommandHookRegistry` (`@endora-commerce/test-kit/command-hooks`, precedent `backend/test/integration/newsletter/hookable-actions.test.ts`) that throws `CommandHookRefusal(409, 'TEST_VETO', …)` leaves
the quote unshared with zero `quote_request_notifications` rows and zero `shared` events, and the
route answers `409 TEST_VETO`; a hook that does not throw sees `data.expiresAt` equal to the
written date.
