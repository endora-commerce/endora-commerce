# Contract: `quoteRequestCommandPort` (QuoteRequest, #1824)

Owner `quote_requests` (**deactivatable**). Declared in `packages/contracts/src/quote-requests.ts`.

## Operations

Every admin write of the module is hand-audited inside its transaction today (`#audit` in
`packages/modules/quote_requests/src/backend/services/rfq-admin-service.ts` and `rfq-service.ts`) except
`quote_request.send_document`; this port is mostly conversion work.

| Method | Command action (kept) | Admin route | Readiness | Work |
| --- | --- | --- | --- | --- |
| `create(input, options?)` | `quote_request.create_on_behalf` | `POST /api/v1/admin/quote-requests` | H-in | convert |
| `update(id, patch, options?)` | `quote_request.modify` (submitted) / `quote_request.patch_draft` (draft) | `PATCH …/:id` | H-in | convert both; the route's choice by status is kept |
| `setCustomFieldValues(id, merge, options?)` | `quote_request.custom_fields.update` (new action if the values ride on `modify` today; T004 confirms) | values carried by `PATCH …/:id` | ? | convert |
| `assign(id, { adminUserId }, options?)` | `quote_request.assign` | `POST …/:id/assign` | H-in | convert |
| `approve(id, input, options?)` | `quote_request.approve` | `POST …/:id/approve` | H-in | convert |
| `cancel(id, { reason }, options?)` | `quote_request.cancel` | `POST …/:id/cancel` | H-in | convert |
| `sendDocument(id, input, options?)` | `quote_request.send_document` | `POST …/:id/send-pdf` (T004 confirms path) | C | port only |

**Not offered, and the contract says so**: `resubmit`, `acceptRevision`, `rejectRevision`,
`convertToOrder` — the buyer's own decisions on their quote; no server-side caller acts for the buyer
in them (research R-9). A future case adds them additively. Customer policy (`quote_request_policy.*`)
and document templates are configuration, not the aggregate.

## Interface (shape)

```ts
export interface QuoteRequestCommandPort {
  create(input: AdminCreateQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  update(id: string, patch: AdminUpdateQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  setCustomFieldValues(id: string, merge: CustomFieldMerge, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  assign(id: string, input: { adminUserId: string | null }, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  approve(id: string, input: AdminApproveQuoteRequest, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  cancel(id: string, input: { reason: string | null }, options?: AggregateCommandOptions): Promise<QuoteRequestRecord>;
  sendDocument(id: string, input: AdminSendQuoteDocument, options?: AggregateCommandOptions): Promise<void>;
}
```

Input types are the admin routes' existing body contracts (T004 names them). `expectedVersion` is
honoured — `QuoteRequestRecord.version` exists.

## Owner off

Fails closed: resolving the port throws `ModuleDisabledError`, the call answers 503
`MODULE_DISABLED`, nothing half-executes. A consumer declares `quote_requests` in `dependencies` or as
`nonBindingDependencies` `refuses-without`.

## Deprecated by this port

None — the module publishes no write port today (`quoteRequestCustomFieldCarryPort` is a carry seam
for orders, kept).

## Tests

`backend/test/contract/quote_requests/quote-request-command-port.test.ts` (parity),
`backend/test/integration/quote_requests/quote-request-command-port.worker.test.ts` (create for a
customer and approve from a worker), off-state test (owner off → 503, nothing written).
