# Contract: customer API changes (`returns`) — phase B

**Feature**: `specs/180-off-platform-complaints/` | Source of truth: `packages/contracts/src/returns.ts`.

All routes keep `requireCustomer`; the sales channel and the organization come from the request's
resolved context (Principles XI, XII), never from the body. `POST /api/v1/returns` keeps its
organization-permission gate (`returns.create`, `specs/170-organization-roles/` FR-052); the upload
routes take the same gate, because an upload exists only to be filed.

## C1. `GET /api/v1/returns/form-config?kind=&orderId=` — new

What the form needs to render for the caller's channel and language (research R-21). `kind`
(`return` | `complaint`, default `complaint`) and `orderId` (absent = the no-order path) select the
clauses: `clausesFor` of research R-14, which never includes a `must_accept` clause when the
submission would be a consumer's withdrawal (D-1). An `orderId` the caller cannot read answers 404,
as `GET …/orders/:id/returnable` does.

```ts
returnFormConfigSchema = z.object({
  offPlatformComplaintsEnabled: z.boolean(),
  proofOfPurchaseRequired: z.boolean(),
  confirmationEmailEnabled: z.boolean(),     // D-11: `return_submitted` is active
  today: isoDate,                            // D-12: the shop's date in `returns.time_zone`
  clauses: z.array(z.object({
    id: uuidSchema, revision: z.number().int(),
    mode: z.enum(['must_accept', 'inform_only']),
    label: z.string(), text: z.string(),     // in the request language, default-language fallback
    linkUrl: z.string().url().nullable(),    // optional full-terms link (owner ruling)
  })),
  attachmentLimits: z.object({
    maxFileBytes: z.number().int(),          // 10 MB
    maxSubmissionBytes: z.number().int(),    // 30 MB
    maxFilesPerCase: z.number().int(),       // 10
    acceptedMimeTypes: z.array(z.string()),  // image/jpeg, image/png, image/webp, application/pdf
  }),
});
```

## C2. `POST /api/v1/returns/uploads` — new (pending upload)

`multipart/form-data`: one `file` part and a `type` field (`photo` | `proof_of_purchase` | `other`).
Answers `201 { data: { uploadId, type, filename, mimeType, sizeBytes, expiresAt } }`.

Refusals: no file → 400 `VALIDATION_FAILED`; over 10 MB → 413 `RETURN_ATTACHMENT_REJECTED`
`{ reason: 'too_large', maxMb: 10 }`; a type the magic bytes do not identify as JPEG, PNG, WebP or
PDF → 422 `RETURN_ATTACHMENT_REJECTED` `{ reason: 'type_not_accepted' }`. Pending uploads expire after
24 hours.

## C3. `POST /api/v1/returns` — create request, extended

```ts
const orderLine = z.object({
  orderItemId: uuidSchema,
  quantity: lineQuantitySchema,
  reasonId: uuidSchema,
  description: z.string().max(2000).optional(),
  serialNumber: z.string().trim().max(100).optional(),   // complaint lines only; ignored-refused on a return
});
const offPlatformLine = z.object({
  productId: uuidSchema.optional(),
  modelName: z.string().trim().min(1).max(255).optional(),
  quantity: lineQuantitySchema,
  reasonId: uuidSchema,
  description: z.string().trim().min(1).max(2000),
  serialNumber: z.string().trim().max(100).optional(),
}).refine((l) => Boolean(l.productId) !== Boolean(l.modelName), { params: { code: 'product_or_model_required' } });

const common = {
  // `line`: the file shows that line of this request (its index in `lines`); absent = the whole case.
  attachments: z.array(z.object({ uploadId: uuidSchema, line: z.number().int().min(0).max(REQUEST_LINE_ITEMS_MAX - 1).optional() })).max(10).optional(),
  shownClauses: z.array(z.object({ id: uuidSchema, revision: z.number().int().positive() })).optional(),    // every clause rendered
  acceptedClauses: z.array(z.object({ id: uuidSchema, revision: z.number().int().positive() })).optional(), // the must_accept ones ticked
  comment: z.string().max(2000).optional(),
  submissionKey: uuidSchema.optional(),
};

createReturnCaseRequestSchema = z.union([
  z.object({ orderId: uuidSchema, kind: returnKindSchema, lines: z.array(orderLine).min(1).max(REQUEST_LINE_ITEMS_MAX), ...common }),
  z.object({
    orderId: z.null(),
    kind: z.literal('complaint'),
    lines: z.array(offPlatformLine).min(1).max(REQUEST_LINE_ITEMS_MAX),
    purchase: z.object({ proofNumber: z.string().trim().max(100).optional(), date: isoDate }),
    contact: z.object({ name: z.string().trim().min(1).max(200), email: z.string().email().max(254), phone: z.string().trim().max(40).optional() }),
    returnAddress: returnAddressSnapshotSchema,
    ...common,
  }),
]);
// attachmentAssetIds is REMOVED (research R-12).
```

`returnAddressSnapshotSchema = { name ≤200, company? ≤200, street ≤255, postalCode ≤20, city ≤120,
countryCode ISO-3166 alpha-2, phone? ≤40 }`.

Server rules beyond the schema, in this order (each refusal in the request language):

1. `orderId: null` while `returns.off_platform_complaints_enabled` is off for the channel → 403
   `RETURN_OFF_PLATFORM_DISABLED`.
2. `kind` other than `complaint` with `orderId: null` → refused by the schema (R3).
3. `purchase.date` after today in `returns.time_zone` → 422 `VALIDATION_FAILED` detail `purchase_date_in_future`.
4. `productId` not available to the caller on the channel → 422 `VALIDATION_FAILED` detail `unknown_product` (research R-17).
5. `reasonId` not applying to complaints, or naming nothing → 422 detail `unknown_reason` (as today); a complaint reason the operator switched off → 422 `RETURN_REASON_INACTIVE` with `details.reasonId` (issue #625, as for an order's case).
6. `attachments`: each `uploadId` must be the caller's own, pending and unexpired → else 422
   `RETURN_ATTACHMENT_REJECTED` `{ reason: 'unknown_upload', uploadId }`; more than 10, or more than
   30 MB together → `{ reason: 'too_many' | 'submission_too_large' }`. A `line` at or beyond
   `lines.length` → 422 `RETURN_ATTACHMENT_REJECTED` `{ reason: 'unknown_line', uploadId, line }`,
   judged before anything is written; each claimed file stores the created line's id as
   `returnCaseItemId` (`null` without `line`).
7. `returns.proof_of_purchase_required` on and `orderId: null` and no attachment typed
   `proof_of_purchase` → 422 `RETURN_PROOF_OF_PURCHASE_REQUIRED`.
8. Clauses (research R-14). `shownClauses` must equal `clausesFor({ channel, kind, orderId,
   customer })` by `(id, revision)`. `acceptedClauses` must equal its `must_accept` subset. Any
   mismatch → 422 `RETURN_CLAUSES_NOT_ACCEPTED`
   `{ reason: 'clause_not_accepted' | 'clauses_changed', clauseIds }`. This applies to order and
   no-order submissions of the kinds each clause applies to. On a consumer withdrawal the
   `must_accept` subset is empty by construction (D-1).
9. `submissionKey` already used by the caller → `200` with the case already created; no second case,
   no second set of e-mails (research R-18).

On success `201 { data: ReturnCaseDetail }` (customer view) — the case is created by Command
`return_case.create`, which claims the uploads in the same transaction.

## C4. `POST /api/v1/returns/:id/attachments` — **body changed**

Was JSON `{ assetId, returnCaseItemId? }`. Now `multipart/form-data`: one `file` and a `type`, plus
optional `returnCaseItemId` field. Only the filer of an open (non-terminal) case; at most 10
attachments per case. Runs Command `return_case.attachment.add`. Same refusals as C2, and a
`returnCaseItemId` that is not a line of this case → 422 `RETURN_ATTACHMENT_REJECTED`
`{ reason: 'unknown_line', returnCaseItemId }`.

## C5. `GET /api/v1/returns/:id/attachments/:attachmentId/file` — new

The case read's scope (`ReturnCaseScope`: the filer, or a member holding
`returns.view_organization`). Same headers as the admin route, always
`Content-Disposition: attachment`. 404 for anything outside the scope.

## C6. Reads

`GET /api/v1/returns` and `GET /api/v1/returns/:id` carry the phase B fields of
[admin-api.md](./admin-api.md) A3/B1/B2 except `resolutionNote` and `personalDataErasedAt` —
including `reference`, `productLabel`, `lineCount` and `purchaseDate` on the list (D-3, D-4);
`contact` and `returnAddress` are visible to the filer and to organization viewers, as the rest of
the case is.

## Breaking-change note

`attachmentAssetIds` and the JSON body of C4 are removed rather than versioned. Neither was usable
by a customer (no customer can create an asset, research F5) and both accepted any asset id
without an ownership check; no client in the tree calls either. The `@endora-commerce/contracts`
and `mod-returns` changesets state the old call and the new one (`release-intent.md`; `minor` in
the 0.x series, D-225).
