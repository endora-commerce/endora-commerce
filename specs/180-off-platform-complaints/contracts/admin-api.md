# Contract: admin API changes (`returns`)

**Feature**: `specs/180-off-platform-complaints/` | Source of truth: `packages/contracts/src/returns.ts`
(Principle II — the Zod schemas land first, in the WP that opens each phase of the one MR).

Every route keeps its existing gate: reads `requireAdmin('returns:read')`, writes
`requireAdmin('returns:write')`. **No new permission code.** Errors use the platform envelope; new
error codes are listed in [settings-emails-events.md](./settings-emails-events.md) §4.

## phase A

### A1. `POST /api/v1/admin/returns/:id/comments` — refined body

```ts
adminAddCommentRequestSchema = z.object({
  body: z.string().min(1).max(2000),
  isCustomerVisible: z.boolean(),
  notifyCustomer: z.boolean(),
}).refine((b) => !(b.notifyCustomer && !b.isCustomerVisible), {
  path: ['notifyCustomer'],
  params: { code: 'notify_requires_customer_visible' },
});
```

422 `VALIDATION_FAILED` with detail `code: 'notify_requires_customer_visible'` on the refused
combination (FR-A21). On success, unchanged response; a `comment_notify` job is enqueued. The
admin form defaults a new comment to **internal** (D-16); the API has no default (both booleans are
required).

### A2. `GET /api/v1/admin/returns/statuses`, `POST …/statuses`, `PATCH …/statuses/:code` — one field

```ts
returnStatusSchema = returnStatusSchema.extend({ notifyCustomerOnEntry: z.boolean() });
// create + patch bodies: notifyCustomerOnEntry: z.boolean().optional()
```

`PATCH` with `notifyCustomerOnEntry: true` on `authorized` or `rejected` → 422 `VALIDATION_FAILED`,
detail `code: 'dedicated_email_status'` (research R-7). The initial status **may** be marked: filing
a case is not an entry into it (D-2), so the flag only acts on a later transition into it.

### A3. Case detail, list rows, export — the authorizer and the reference

```ts
const returnCaseAuthorizerSchema = z.object({
  adminUserId: uuidSchema.nullable(),          // null: unknown (FR-A43)
  /** Resolved at read; null when the id resolves to no admin (FR-A42: "former administrator"). */
  name: z.string().nullable(),
});
returnCaseSummarySchema += { reference: z.string() };   // FR-A44: rmaNumber ?? '#XXXXXXXX' (research R-20)
returnCaseDetailSchema  += { authorizedAt: isoDateTime.nullable(), authorizedBy: returnCaseAuthorizerSchema.nullable() };
adminReturnRowSchema    += { authorizedBy: returnCaseAuthorizerSchema.nullable() };
```

`reference` is on the summary, so the admin row, the customer list and the detail all carry it.
`authorizedBy` is `null` while the case is not authorized. Export (`GET /api/v1/admin/returns/export`)
gains the columns `reference` and `authorizedBy` (the name, `former administrator` / `unknown` in the
export language). `adminReturnsSortSchema` is **unchanged** (not sortable, spec Clarifications). The
list's `q` also matches a derived reference (`#3F9A21C0` or `3F9A21C0`).

### A4. Transitions — behaviour only

`POST /api/v1/admin/returns/:id/transition` and `/bulk-transition` into `authorized` or
`rejected` now have the dedicated effects (RMA number, `authorizedAt`, `authorizedBy`, the
dedicated e-mail) — research R-7.3. Bodies and responses unchanged.

### A5. `GET /api/v1/admin/returns/notification-health` — new (D-7)

`returns:read`. Answers:

```ts
returnNotificationHealthSchema = z.object({
  recipientsMissing: z.object({
    global: z.boolean(),                          // the global value holds no valid address
    salesChannelIds: z.array(uuidSchema),         // channels whose effective value holds none
  }),
});
```

Read by `ReturnStatusesConfigPage` to show the "no recipient" alert (research R-22).

## phase B

### B1. List — the off-platform filter and recognisable rows

```ts
adminReturnsListQuerySchema += { origin: z.enum(['platform', 'off_platform']).optional() }; // absent = all
returnCaseSummarySchema     += {
  offPlatform: z.boolean(),
  productLabel: z.string(),                     // first line's product name (D-3)
  lineCount: z.number().int().positive(),       // the consumer renders "+N more"
  purchaseDate: isoDate.nullable(),             // null on order cases (D-3)
};
returnCaseSummarySchema.orderId: uuidSchema.nullable();         // was uuidSchema
```

Saved views (`/api/v1/admin/returns/list-views`) store `origin` with the other filters. Filters are
**not** reflected in the URL (D-6). Export gains `offPlatform`; `orderId` is empty for off-platform
rows.

### B2. Case detail — off-platform block, lines, attachments, clauses, outside settlement

```ts
returnCaseItemSchema: orderItemId → uuidSchema.nullable(); productId → uuidSchema.nullable();
                      += { serialNumber: z.string().nullable() };

const shownClauseSchema = z.object({
  clauseId: uuidSchema, revision: z.number().int(), mode: z.enum(['must_accept', 'inform_only']),
  language: z.string(), label: z.string(), text: z.string(), linkUrl: z.string().url().nullable(),
});

returnCaseDetailSchema += {
  offPlatform: z.boolean(),
  purchase: z.object({ proofNumber: z.string().nullable(), date: isoDate }).nullable(),   // null on order cases
  contact: z.object({ name: z.string(), email: z.string(), phone: z.string().nullable() }).nullable(),
  returnAddress: returnAddressSnapshotSchema.nullable(),
  attachments: z.array(returnAttachmentSchema),
  acceptedClauses: z.array(shownClauseSchema),           // every clause shown, both modes
  clausesAcceptedAt: isoDateTime.nullable(),
  resolutionNote: z.string().nullable(),                 // admin detail only
  personalDataErasedAt: isoDateTime.nullable(),          // D-8 (replaces the draft boolean)
};

returnAttachmentSchema = z.object({
  id: uuidSchema,
  returnCaseId: uuidSchema,
  type: z.enum(['photo', 'proof_of_purchase', 'other']),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: isoDateTime,
});  // replaces the asset-shaped schema (assetId removed)
```

### B3. `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` — new

`returns:read`. Streams the bytes from the object store. 404 for an attachment not on that case,
or a case outside the caller's scope (indistinguishable, Principle XI). Headers:
`Content-Type` (stored, sniffed type), `Content-Disposition: inline` for images and `attachment`
otherwise, `X-Content-Type-Options: nosniff`, the assets route's sandbox CSP,
`Cache-Control: private, no-store`.

### B4. Settlement — `settled_outside`

```ts
resolutionTypeSchema = z.enum(['refund', 'credit', 'replacement', 'repair', 'settled_outside']);
settlementRequestSchema += { resolutionNote: z.string().trim().min(1).max(2000).optional() };
```

- `GET /api/v1/admin/returns/:id/settlement` on an off-platform case answers
  `resolutionOptions` from the case's state, `defaultResolution` the first of them, and no money
  fields beyond zeros:
  - authorized, not settled, not terminal, and `resolved` **not** reachable by the graph → `['settled_outside']`;
  - `resolved` reachable (in practice from `received`) → `['replacement', 'repair', 'settled_outside']`, default `repair`.
  The prefill is served from authorization onwards for off-platform cases (D-5); order cases keep
  today's precondition.
- `POST …/settle` on an off-platform case with `refund`, `credit`, or `createCorrectiveInvoice: true`
  → 422 `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM` `{ resolution }`.
- `settled_outside` without `resolutionNote` → 422 `VALIDATION_FAILED` detail `resolution_note_required`;
  on an order case → 422 `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM` `{ resolution: 'settled_outside' }`;
  on an unauthorized, already settled or terminal case → 409 `INVALID_TRANSITION`.
- `settled_outside` moves the case to `resolved` without needing a graph edge (research R-19).

### B5. Clauses — new resource

```text
GET    /api/v1/admin/returns/clauses               returns:read   → { data: ReturnCaseClauseDto[] }
POST   /api/v1/admin/returns/clauses               returns:write  body: createReturnCaseClauseRequest
PATCH  /api/v1/admin/returns/clauses/:id           returns:write  body: updateReturnCaseClauseRequest
DELETE /api/v1/admin/returns/clauses/:id           returns:write
```

```ts
const localizedText = (max: number) => z.record(z.string().min(2), z.string().trim().min(1).max(max));
const localizedHttpsUrl = z.record(z.string().min(2), z.string().url().max(2000).refine((u) => u.startsWith('https://')));
returnCaseClauseSchema = z.object({
  id: uuidSchema,
  label: localizedText(120),
  text: localizedText(5000),
  linkUrl: localizedHttpsUrl.nullable(),                       // owner ruling: optional full-terms link
  appliesTo: z.enum(['return', 'complaint', 'both']),         // D-1
  mode: z.enum(['must_accept', 'inform_only']),               // D-1
  salesChannelId: uuidSchema.nullable(),
  weight: z.number().int(),
  isActive: z.boolean(),
  revision: z.number().int().positive(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
createReturnCaseClauseRequestSchema = returnCaseClauseSchema
  .pick({ label: true, text: true, linkUrl: true, appliesTo: true, mode: true, salesChannelId: true, weight: true, isActive: true })
  .partial({ linkUrl: true, appliesTo: true, mode: true, salesChannelId: true, weight: true, isActive: true });
updateReturnCaseClauseRequestSchema = createReturnCaseClauseRequestSchema.partial();
```

Defaults: `appliesTo: 'both'`, `mode: 'must_accept'`. Each write is a Command
(`return_case_clause.create|update|delete`); `revision` increments when `label`, `text`, `linkUrl`,
`appliesTo` or `mode` changes. Deleting a clause never changes a case's stored copy (FR-B32). A label
or text missing the platform default language → 422 `VALIDATION_FAILED` detail
`default_language_required`.
