# Contract: `quoteRequestCommandPort` (QuoteRequest, #1824)

Owner `quote_requests` (**deactivatable**). Declared in `packages/contracts/src/quote-requests.ts`.

## Operations

Inventory (T004, issue #1824). Every operator write of the module except `quote_request.send_document`
was hand-audited inside its transaction (`#audit` in `rfq-admin-service.ts`); they are now Commands in
`packages/modules/quote_requests/src/backend/commands/quote-request-admin-commands.ts`, run by the admin
routes and the port through the same runner (`RfqAdminService.runWrite`). The `#audit` calls of
`rfq-service.ts` are **all buyer-side** (`create`, `patch_draft`, `resubmit`, `respond_to_revision`,
`convert_to_order`) and keep their hand audit (T067). `quote_request.prepare_customer_basket` — an
operator write not on the port — keeps its hand audit too.

| Method | Command action (kept) | Admin route | Readiness (was) | Side effects outside the write (all on both paths now) |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `quote_request.create_on_behalf` | `POST /api/v1/admin/quote-requests` | H-in | revision 1, `created` + automatic `note-added` history entries, `prepared` notification records, delivery kick after commit, `rfq.created_by_admin.v1` on commit (`adminUserId` `null` with no administrator); the route alone adds the availability `warnings` to its response |
| `update(id, patch, options?)` | `quote_request.modify` | `PATCH …/:id` | H-in | new revision, `modified` entry, `revised` notification records, kick, `rfq.modified.v1` |
| `setCustomFieldValues(id, merge, options?)` | `quote_request.custom_fields.update` (**new**) | none — the route carries values on `PATCH …/:id` (`quote_request.modify`), which also records a revision and asks the buyer to accept it | N | none: no revision, no history entry, no notification |
| `assign(id, { adminUserId }, options?)` | `quote_request.assign` | `POST …/:id/assign` | H-in | none |
| `approve(id, input, options?)` | `quote_request.approve` | `POST …/:id/approve` | H-in | optional `note-added`, `approved` entry, `approved` notification records, kick, `rfq.approved.v1` |
| `cancel(id, { reason }, options?)` | `quote_request.cancel` | `POST …/:id/cancel` | H-in | `canceled` entry (with the reason), `canceled` notification records, kick, `rfq.canceled.v1` |
| `sendDocument(id, input, options?)` | `quote_request.send_document` | `POST …/:id/pdf/send` (T004: the path is `/pdf/send`) | C | the render may first run `quote_request.set_document_template` when an explicit template differs from the remembered one — on both paths; the per-administrator rate limit is the route's alone |

**`update` runs `quote_request.modify` only.** The contract's "`quote_request.patch_draft` (draft)" was
wrong: `patch_draft` is the **buyer's** draft edit (`RfqService.patchDraft`, `PATCH /api/v1/quote-requests/:id`),
and the admin `PATCH` route always runs `modify`, for `Pending` and `Created from admin` alike.

**`sendDocument` answers `QuoteRequestPdfSendResult`**, the route's response, rather than `void`: a
caller needs to know which recipients failed. A `void` method could later widen to it compatibly, so
nothing is lost by shipping the result now.

**Actor.** With no administrator the Command Bus records the `system` actor (D-293.6: no `automation`
kind); `options.source` is recorded as `source` in `stateAfter` **only when given**, so the admin
routes' entries stay byte-identical to the hand audit they replace. The history the buyer and the team
read names such a write `System`, as the carry receiver and the order-completion reactor do; it keeps
the current assignee rather than clearing it.

**Not offered, and the contract says so**: `resubmit`, `acceptRevision`, `rejectRevision`,
`convertToOrder` — the buyer's own decisions on their quote; no server-side caller acts for the buyer
in them (research R-9). A future case adds them additively. Customer policy (`quote_request_policy.*`)
and document templates are configuration, not the aggregate.

## Interface (shape)

As declared (`packages/contracts/src/quote-requests.ts`):

```ts
export interface QuoteRequestCommandPort {
  create(input: AdminCreateQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  update(id: string, patch: AdminUpdateQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  assign(id: string, input: { adminUserId: string | null }, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  approve(id: string, input: AdminApproveQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  cancel(id: string, input: { reason: string | null }, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  sendDocument(id: string, input: QuoteRequestPdfSendRequest, options?: AggregateCommandOptions): Promise<QuoteRequestPdfSendResult>;
}
```

Input types are the admin routes' existing body contracts, parsed with the same schemas. `expectedVersion`
is honoured by every method that changes the request (`update`, `approve`, `cancel`, `assign`,
`setCustomFieldValues`); `create` and `sendDocument` ignore it.

## Owner off

Fails closed: resolving the port throws `ModuleDisabledError`, the call answers 503
`MODULE_DISABLED`, nothing half-executes. A consumer declares `quote_requests` in `dependencies` or as
`nonBindingDependencies` `refuses-without`.

## Deprecated by this port

None — the module publishes no write port today (`quoteRequestCustomFieldCarryPort` is a carry seam
for orders, kept).

## Tests

`backend/test/contract/quote_requests/quote-request-command-port.test.ts` (parity per method, `source`,
unclaimed extension, off state: owner off → `ModuleDisabledError`, nothing written),
`backend/test/integration/quote_requests/quote-request-command-port.worker.test.ts` (create for a
customer, then price and approve a submitted request, from a worker), and the co-located
`commands/quote-request-admin-commands.test.ts` (each Command's entry, refusals, event and notification
once, through the real `CommandBus`).
