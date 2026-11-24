# Contract: admin HTTP surface for sharing quote requests

Feature `specs/192-quote-request-draft-share/`. Zod source of truth:
`packages/contracts/src/quote-requests.ts` (Principle II). Every route below is gated
`requireAdmin('rfqs:handle')` and narrowed for a sales representative by
`adminCanSeeOrganization` (a quote of an organisation the caller may not see answers `404`).
All changes are additive or widen accepted input (`specs/conventions/contract-surface.md`).

## 1. `POST /api/v1/admin/quote-requests/:id/share` (new)

Request: no body (an empty object is accepted; any key is refused — `.strict()`).
Header `If-Match: <version>` optional; when present and different from the stored `version`,
`409 VERSION_CONFLICT` (as `PATCH /:id`).

`200` → `{ data: QuoteRequest }` — the admin projection (`includeFullActorIdentity`), now with
`sharedWithCustomer: true`, `sharedAt`, `sharedByAdminUserId`, and `expiresAt` set from
`shareValidityDays` (or `null`).

Refusals (nothing written, nobody told, no hook effect survives):

| Status | Code | When | `details` |
| --- | --- | --- | --- |
| 404 | `NOT_FOUND` | unknown/malformed id, or organisation not visible to the caller | — |
| 409 | `RFQ_ALREADY_SHARED` (minted) | the quote is already shared (including legacy and customer-submitted quotes) | — |
| 409 | `RFQ_NOT_QUOTED` | status is not `Created from admin` (a cancelled/expired draft) | — |
| 409 | `VERSION_CONFLICT` | `If-Match` stale | — |
| 409 | `QUOTE_INCOMPLETE` | a line has no agreed unit price | `{ code: 'share', lines: [{ id, position, productName, variantLabel, groupName }] }` in display order |
| 409 | `RFQ_SHARE_CUSTOMER_UNAVAILABLE` (minted) | the account is gone or moved (`not_member`), or deleted/anonymised (`inactive`); a blocked account pending OQ-3 | `{ code: 'not_member' }` or `{ code: 'inactive' }` |
| any | the hook module's own code | a `beforeCommit` hook of `quote_request.share` vetoed | the hook's own `details` |

Check order: visibility → already shared → status → version → unpriced lines → customer → apply →
hooks. The order is part of the contract only in that a quote failing several checks answers the
first.

## 2. `GET /api/v1/admin/quote-requests/create-defaults` (new)

`200` → `{ data: { validityDays: number | null } }` — `quote_requests.default_validity_days`
read globally; `0` answers `null`. Declared before `/:id` in the route file so `create-defaults`
is never parsed as an id.

Zod: `adminQuoteRequestCreateDefaultsSchema = z.object({ validityDays: z.number().int().positive().nullable() })`.

## 3. `POST /api/v1/admin/quote-requests` (changed: input widened, output extended)

- `expiresInDays: z.number().int().nonnegative().nullable().optional()`:
  - absent → the default setting snapshotted (setting `0` → no deadline);
  - `null` → no deadline (the operator cleared the field);
  - `N ≥ 0` → `N` days, counted from the share (`0` → the date is the share moment —
    the literal reading of FR-032; [NEEDS CLARIFICATION] OQ-2).
- No date is written at create: `expiresAt` is `null` in the reply.
- Reply `data` carries `sharedWithCustomer: false`, `sharedAt: null`, `shareValidityDays`.
- No customer notification is recorded (FR-005). `rfq.created_by_admin.v1` is still emitted
  (it is the operator-side announcement `crm` listens to; it reaches no customer).

## 4. `PATCH /api/v1/admin/quote-requests/:id` (changed)

- `expiresInDays: z.number().int().nonnegative().nullable().optional()`.
- **Unshared quote**: a number writes `shareValidityDays` (as on create), `null` clears it,
  absent keeps it; `expiresAt` is not touched; the `modified` event records
  `validityDays: { before, after }`; **no** `revised` notification is recorded.
- **Shared quote**: unchanged (`N` → `expiresAt = now + N days`; the `revised` notification);
  `null` → `422 VALIDATION_FAILED` with `details: [{ path: 'expiresInDays', issue: 'not_clearable_once_shared' }]`.

## 5. `POST /api/v1/admin/quote-requests/:id/cancel` (behaviour)

Unshared: cancels, records the `canceled` event, records **no** `canceled` notification, the
quote stays invisible to the customer.

## 6. `POST /api/v1/admin/quote-requests/:id/pdf/send` (behaviour)

Unshared: `409 RFQ_NOT_SHARED` (minted) before rendering. Export routes unchanged.

## 7. `GET /api/v1/admin/quote-requests` (changed)

- Query: `sharing: z.enum(['unshared', 'shared']).optional()` on
  `adminQuoteRequestListQuerySchema`; absent = both.
- Each row (`quoteRequestSummarySchema`) gains `sharedWithCustomer: z.boolean().optional()` —
  admin list only; the customer list does not carry the key.

## 8. `GET /api/v1/admin/quote-requests/:id` and `/history` (output extended)

`quoteRequestSchema` gains, **admin replies only** (customer replies never carry the keys —
same rule and comment style as `createdByAdminUserId`):

```ts
sharedWithCustomer: z.boolean().optional(),
sharedAt: isoDateTimeSchema.nullable().optional(),
sharedByAdminUserId: uuidSchema.nullable().optional(),
shareValidityDays: z.number().int().nonnegative().nullable().optional(),
```

History: entry kind `shared` (actor = admin; deliveries of the `prepared` notification attach to
it); change kind `validity_days { before: number | null, after: number | null }`.

`rfqEventTypeSchema` gains `'shared'` (admin replies only).

## 9. Customer surface (no shape change)

`GET /api/v1/quote-requests`, `GET /api/v1/quote-requests/:id`, `PATCH`, `resubmit`,
`accept-revision`, `reject-revision`, `convert-to-order`, and `carts`'
`POST /api/v1/cart/from-quote-request/:id`: an unshared quote answers exactly as a quote that
does not exist (`404`, same code and message as for a random uuid). No response key is added.

## 10. Error codes (module-owned, `src/manifest.ts` `errorCodes`, `i18n/{en,pl}.json`)

| Code | Status | Tokens | Minted by |
| --- | --- | --- | --- |
| `RFQ_ALREADY_SHARED` | 409 | — | this feature (`MINTED_ERROR_CODES` entry) |
| `RFQ_SHARE_CUSTOMER_UNAVAILABLE` | 409 | `not_member`, `inactive` | this feature |
| `RFQ_NOT_SHARED` | 409 | — | this feature |
| `QUOTE_INCOMPLETE` | 409 | gains `share` | existing |

Each new code: a member of `ERROR_CODES` (`packages/contracts/src/errors.ts`), an `errors.<CODE>`
sentence (and one per token) in both bundles, a `MINTED_ERROR_CODES` entry in
`backend/test/fixtures/error-code-routing/reference-ledgers.ts` naming `quote_requests` and this
feature.
