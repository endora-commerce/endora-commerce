# Contract: guest and tracking API (`returns`)

**Feature**: `specs/181-guest-complaints/`. The source of truth is `packages/contracts/src/returns.ts`
(new section *Guest complaints*).

All routes are **anonymous**: they need no customer session, and a customer session is ignored
(research R-4). They are registered by `returns` in `routes.guest.ts` through `ctx.routes`, so they
are absent while the module is off (FR-080): like every route of a module that is off, they answer
the platform's `503 MODULE_DISABLED` envelope, not the route's own answer (`it/off-state.test.ts`,
batch 5).

- **Channel.** The sales channel is always the request's resolved channel (Principle XII), never a
  body field.
- **Order of checks.** Module gate, then setting (`RETURN_GUEST_COMPLAINTS_DISABLED`; not on G4 and
  G8–G10), then session or token, then the body (research R-12). G4 is the one session route the
  setting does not gate: leaving only ends the caller's own session, and refusing it while the
  setting is off would strand a cookie (lead ruling on batch 2).
- **Scope.** Every route runs anonymous: one `preHandler` for the group drops any actor the
  request's session cookies resolved to and re-derives the anonymous context with the platform's
  `scopeRequestToActor` (research R-1, R-4).
- **Bodies.** Every body schema is `.strict()`, so a body naming `customerAccountId`,
  `organizationId` or `orderId` is refused `400 VALIDATION_FAILED` (FR-034).
- **Language.** Refusals carry a sentence in the request language (FR-090).

**Guest session.** Carried as the cookie `b2b_returns_guest`, which the storefront forwards in an
allow-listed `Cookie` header (research R-4). A missing, unknown, expired, ended or other-channel
session answers `401 RETURN_GUEST_SESSION_REQUIRED`.

**Tracking token.** Carried in the header `X-Returns-Tracking-Token`, never in the URL (research
R-5). Every invalid token answers `404 RETURN_TRACKING_LINK_INVALID` with the same body.

## G1. `GET /api/v1/returns/guest/availability`

`200 { data: { enabled: boolean } }`. `enabled` = off-platform complaints ∧ guest complaints for the
channel. It is the storefront's switch for FR-010. Rate limit: none beyond the platform default.

## G2. `POST /api/v1/returns/guest/verifications`

```ts
guestVerificationRequestSchema = z.object({
  email: z.string().trim().email().max(254),
  hp: z.string().max(200).optional(),          // honeypot (research R-8)
  language: languageTagSchema.optional(),      // storefront copy; e-mails use the channel's language
}).strict();
```

Always `202 { data: { linkValidMinutes: 60 } }`: the honeypot, the per-address throttle, an address
with or without an account, and a send failure all give the same answer (FR-021). The only other
answers are:

- `400 VALIDATION_FAILED` for a malformed address (this says nothing about any account);
- `403 RETURN_GUEST_COMPLAINTS_DISABLED`;
- `429 RATE_LIMITED`, per client address, 5 / 10 min.

## G3. `POST /api/v1/returns/guest/sessions`: redeem a link

`{ token: string (≤ 512) }` → `201 { data: { sessionToken, email, expiresAt } }`. The storefront
sets the cookie from `sessionToken`. Every invalid token (unknown, altered, expired, used,
superseded, other channel) answers `410 RETURN_GUEST_LINK_INVALID`. Rate limit 20 / 10 min per
client address.

## G4. `DELETE /api/v1/returns/guest/sessions/current`

Session required; **not gated by the setting** (see *Order of checks*). `204`. Sets `ended_at`.

## G5. `GET /api/v1/returns/guest/form-config`

Session required. 180's `returnFormConfigSchema` (C1) for `kind=complaint` with no order, plus:

```ts
guestFormConfigSchema = returnFormConfigSchema.extend({
  reasons: z.array(returnReasonSchema),        // the active complaint reasons (batch 4; see below)
  verifiedEmail: z.string(),
  sessionExpiresAt: isoDateTime,
  confirmationEmailEnabled: z.literal(true),   // the guest confirmation cannot be switched off (FR-045)
});
```

`offPlatformComplaintsEnabled` is always `true` here (otherwise `403`). `reasons` are the active
reasons for a complaint, as `GET /api/v1/returns/reasons?kind=complaint` answers a customer: that
route needs a customer session, and the guest form has none. Added in batch 4 as an additive field;
**accepted by the lead on 2026-11-16** and released in the `@endora-commerce/contracts` changeset
`181-returns-guest-complaints.md`. The clauses are 180's
`clausesFor` for a complaint without an order. Product availability is the anonymous audience's on
the channel (spec edge case).

## G6. `POST /api/v1/returns/guest/uploads`

Session required. 180's C2 unchanged in shape (multipart, `file` + `type`), answering `201 { data:
{ uploadId, type, filename, mimeType, sizeBytes, expiresAt } }`. The row is owned by the session
(`guest_session_id`). Refusals are 180's, plus `RETURN_ATTACHMENT_REJECTED { reason: 'too_many' }`
beyond 10 pending uploads per session. Rate limit 60 / 10 min per client address.

## G7. `POST /api/v1/returns/guest/cases`: file a guest complaint

Session required.

```ts
createGuestComplaintRequestSchema = z.object({
  kind: z.literal('complaint'),
  lines: z.array(offPlatformLine).min(1).max(REQUEST_LINE_ITEMS_MAX),     // 180 C3
  purchase: z.object({ proofNumber: z.string().trim().max(100).optional(), date: isoDate }),
  contact: z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).optional() }), // no e-mail: it is the session's (FR-031)
  returnAddress: returnAddressSnapshotSchema,
  attachments: z.array(z.object({ uploadId: uuidSchema, line: z.number().int().min(0).max(REQUEST_LINE_ITEMS_MAX - 1).optional() })).max(10).optional(),
  shownClauses: z.array(clauseRefSchema).optional(),
  acceptedClauses: z.array(clauseRefSchema).optional(),
  comment: z.string().max(2000).optional(),
  submissionKey: uuidSchema.optional(),
  hp: z.string().max(200).optional(),
}).strict();
```

**Server rules.** 180's C3 rules 3–8 apply unchanged: purchase date, `unknown_product`,
`unknown_reason`, attachments (claimable only from **this session**: `unknown_upload` otherwise),
proof of purchase required, clauses. In addition:

- a honeypot hit answers like a success and creates nothing;
- 5 cases per session, or 10 per verified address in 24 h → `429 RETURN_GUEST_LIMIT_REACHED`;
- a repeated `submissionKey` from the same session → `200` with the case already filed (R-4).

**On success.** `201 { data: GuestCaseFiled }`. The case is created by Command `return_case.create`
with `customerAccountId: null`, `organizationId: null`, `guestSessionId`, `contact.email` = the
session's address, `contactVerifiedAt`, and `trackingVersion: 1`. `return_case.created.v1` is
emitted with `organizationId: null` and `guest: true`.

```ts
guestCaseFiledSchema = z.object({
  reference: z.string(),        // 180 FR-A44
  trackingToken: z.string(),    // the storefront builds /returns/track/<token>; shown once on the success page (FR-036)
  email: z.string(),            // where the confirmation went
});
```

## G8. `GET /api/v1/returns/track`: the tracking page

Token header. `200 { data: GuestCaseView }`.

```ts
guestCaseViewSchema = z.object({
  reference: z.string(),
  kind: z.literal('complaint'),
  status: z.object({ code: z.string(), label: z.string() }),   // label in the request language (180)
  isClosed: z.boolean(),                                        // read-only page when true (FR-042)
  submittedAt: isoDateTime,
  lines: z.array(z.object({ productName: z.string(), quantity: z.number().int(), reasonLabel: z.string(), description: z.string(), serialNumber: z.string().nullable() })),
  purchase: z.object({ proofNumber: z.string().nullable(), date: isoDate }),
  contact: z.object({ name: z.string(), email: z.string(), phone: z.string().nullable() }),
  returnAddress: returnAddressSnapshotSchema,
  rmaNumber: z.string().nullable(),
  comments: z.array(z.object({ id: uuidSchema, authorKind: z.enum(['shop', 'you']), body: z.string(), createdAt: isoDateTime })), // customer-visible only (FR-041)
  attachments: z.array(z.object({ id: uuidSchema, type: returnAttachmentTypeSchema, filename: z.string(), sizeBytes: z.number().int(), lineIndex: z.number().int().nullable() })),
  linkValidUntil: isoDateTime.nullable(),                       // null while open
  rejectionReason: z.string().nullable(),                       // customer-visible (owner ruling O-1, 2026-11-16)
});
```

Internal comments, `resolutionNote` and staff fields are never in the view. Rate limit 60 / 10 min
per client address.

## G9. `POST /api/v1/returns/track/comments`

Token header, open case only (otherwise `409 RETURN_COMMENTS_CLOSED`, issue #625). Body `{ body: string (1–2000) }`.
Command `return_case.comment.add_by_guest`. The comment is customer-visible with `author_guest =
true`. Limits: 20 per case per 24 h (`429 RETURN_GUEST_LIMIT_REACHED`) and 10 / 10 min per client
address.

## G10. `POST /api/v1/returns/track/attachments` and `GET /api/v1/returns/track/attachments/:attachmentId/file`

- **POST**: multipart `file` + `type` (+ optional `lineIndex`). Open case only. 180's C4 limits and
  refusals apply. Command `return_case.attachment.add`, with `uploaded_by_guest = true`.
- **GET**: 180's C5 response headers (`Content-Disposition: attachment`, `nosniff`, `private,
  no-store`). An attachment not of the token's case answers `404`.

## Storefront routes (not API; listed for the contract tests)

`/returns/guest`, `/returns/guest/request` (POST), `/returns/guest/sent`, `/returns/guest/verify`
(GET page), `/returns/guest/verify/continue` (POST; Next refuses a page and a route handler in one
segment), `/returns/guest/new`, `/returns/guest/uploads` (POST), `/returns/guest/submit`
(POST), `/returns/guest/submitted/[ref]`, `/returns/guest/leave` (POST), `/returns/track/[token]`,
`/returns/track/[token]/comments` (POST), `/returns/track/[token]/attachments` (POST),
`/returns/track/[token]/files/[attachmentId]` (GET). Research R-13 has the table.

## Breaking-change note

None for API consumers. `ReturnCaseSummary.customerAccountId` and
`ReturnCaseDetail.customerAccountId` widen to `uuidSchema.nullable()`, and admin consumers must
handle `null`. That is a contract widening, recorded as `minor` in the 0.x series (D-225) in the
`@endora-commerce/contracts` changeset.
