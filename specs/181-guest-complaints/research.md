# Research: Complaints from guests without a customer account

**Feature**: `specs/181-guest-complaints/` | **Date**: 2026-11-16 | **Plan**: [plan.md](./plan.md)

Every decision below is stated as decision, rationale, and the alternatives that were rejected. The
predecessor's research is `specs/180-off-platform-complaints/research.md`; its R-numbers are cited as
"180 R-n".

## Findings that shaped the plan

| # | Finding | Where |
| --- | --- | --- |
| F1 | `ReturnCase` is `@OrgScoped()` with `organizationId?: string \| null`. `customerAccountId` is `string` and its column is `not null` since the first migration. | `packages/modules/returns/src/backend/entities/return-case.entity.ts`, `src/migrations/20260625T144227_returns_init.ts` |
| F2 | The org-write guard does not refuse a null organization: *"a row with no organization carries none … a row written with a null organization is invisible to every scoped reader"*. `ReturnCase` is named there as one of the two classes in that state. | `packages/platform/src/tenancy/org-write-guard.ts` (limit 2) |
| F3 | Read filter for `@OrgScoped`: `all`/`system` → no predicate; `single-org` → `organizationId = X`; `allowed-set` → `organizationId IN (…)`; `excluded-set` → `organizationId is not null and not in (S)`, null excluded on purpose ("Never a null organization"). So **only `all` and `system` can see a row with no organization**. | `packages/platform/src/tenancy/filters.ts` `orgFilterCond`, `tenancy/excluded-predicate.ts` |
| F4 | An anonymous request gets the **system** tenant context (`systemTenantContext('actor:anonymous')`); there is no anonymous tenant kind. *"Anonymous traffic, whose guest-owned rows are scoped by their own token."* | `packages/platform/src/kernel/actor-tenant-context.ts:76,153`, `tenancy/resolve-tenant-context.ts:31` |
| F5 | A Command run in a system context is recorded with no admin and no customer id and the actor kind of the context. There is no `guest` actor kind. | `packages/platform/src/commands/actor.ts` |
| F6 | An admin's reach comes from `adminTenantScopePort.resolveForAdmin` (`organizations`, `nonDeactivatable`): `allowAll` for every role except the sales representative's, which gets `excluding`. `returns` already depends on `organizations`. | `packages/contracts/src/organizations.ts:1246-1288`, `packages/modules/returns/src/manifest.ts` |
| F7 | The new-case bell goes to every active admin holding `returns:read`, and on purpose names no customer or organization. | `packages/modules/returns/src/backend/services/notifications/admin-bell.ts` |
| F8 | Every customer e-mail resolves its recipient through `customerAccountReadPort.findById(rc.customerAccountId)`. The four 180 templates and the legacy authorized/rejected builders say *"in your account"*. | `services/notifications/dispatch.ts:294-310`, `services/return-email-notifier.ts`, `email-templates/transactional-defaults.ts` |
| F9 | Idempotency is `unique (customer_account_id, submission_key) where submission_key is not null`. Pending uploads are owned by `customer_account_id`. | `src/migrations/20261113T155433_returns_off_platform_complaints.ts:54,75-76` |
| F10 | **G11 is in the tree**: `return_case_attachments.organization_id` is nullable and the entity reads `organizationId?: string \| null`. Files are stored under `returns/<organizationId>/<id>`. | `entities/return-case-attachment.entity.ts:13,57-58` |
| F11 | `ReturnShipment` (replacement and inbound shipments) is a `returns`-owned `@GlobalEntity`, reached only through the case read. Nothing in `returns` calls the `shipments` module. A replacement settlement creates no order, invoice or credit. | `entities/return-shipment.entity.ts`, `services/return-shipment-service.ts`, `services/return-settlement-service.ts:748` |
| F12 | `ReturnCase.closedAt` exists and **nothing writes it**. Terminal statuses have no outgoing edges; the graph refuses one. | `entities/return-case.entity.ts:169`, `domain/return-status-graph.ts` (header) |
| F13 | Comments carry `author_admin_user_id` / `author_customer_account_id`. A comment from neither is not representable today; `authorKind` is derived as `admin` or `customer`. | `entities/return-case-comment.entity.ts`, `services/return-comment-service.ts:154` |
| F14 | Rate limiting is `@fastify/rate-limit`, registered by the platform. A module limits a route with `config: { rateLimit: { max, timeWindow, keyGenerator } }`. Forms uses 10 per 10 minutes per IP. The honeypot is a trivial pure function. | `packages/platform/src/http/server.ts:158`, `packages/modules/forms/src/backend/routes/routes.public.ts:28-31`, `…/services/submission/honeypot.ts` |
| F15 | A guest token the storefront holds is a backend-minted value in an httpOnly storefront cookie, forwarded to the backend as an allow-listed `Cookie` header: the anonymous cart (`b2b_cart_anon`). | `storefront/lib/session.ts:18,183-198,275-285` |
| F16 | The platform registers a **`cursorSeal`**. It is AES-256-GCM with a key derived by HKDF from the session secret, deterministic, purpose-bound (the purpose is the GCM additional data), URL-safe, unforgeable and opaque. *"There is no new input for an operator to provision."* | `packages/platform/src/composition/cursor-seal.ts`, `composition/compose-app.ts:753` |
| F17 | The settings store validates type only: no `min`/`max` on `number`. 180 validates recipients at send for the same reason. | `packages/contracts/src/settings.ts`, 180 R-4 |
| F18 | Every storefront returns page sits behind `requireModulePresent('returns')` in the route-group layout. | `storefront/app/(account)/returns/layout.tsx` |

---

## R-1 — Principle XI review: a guest case on an organization-scoped entity

**Recorded as the spec's Assumptions and G2 require.** Principle XI is non-negotiable.

### Classification

| Entity | Classification | Why |
| --- | --- | --- |
| `ReturnCase` (`return_cases`) | **`@OrgScoped()`, unchanged** | A customer case is an organization's record. A guest case is a row with no organization, which only the unrestricted modes read (F3). Re-classifying to `@CustomerScoped` would change every customer read and the roll-up behaviour of `ReturnCaseScope` for no gain. |
| `ReturnCaseAttachment` | `@OrgScoped()`, unchanged (G11) | A guest's file has `organization_id null` and `guest_session_id` set. |
| `ReturnCaseItem`, `ReturnCaseComment`, `ReturnShipment` | `@GlobalEntity()`, unchanged | Reached only through a case read that the filter has already decided. 180 kept this posture and so does this feature. |
| `ReturnGuestVerification` (new, `return_guest_verifications`) | **`@GlobalEntity()`** | It belongs to no customer and no organization. It is addressed only by a token's hash or a sealed id, and has no admin read surface. Same posture as the newsletter's unconfirmed subscriber before attribution. |

### The together-absent rule

`customer_account_id` and `organization_id` on `return_cases` are absent **together** for a guest
case. The database enforces the direction this feature introduces:

```sql
check ("customer_account_id" is not null or "organization_id" is null)   -- guest ⇒ no organization
```

The reverse direction (account ⇒ organization) is enforced by the code on every write path. 180
already refuses a customer filing without an organization; this feature adds no new customer write.
It is not a database constraint because of R-2. That is where forms differs (its equivalence CHECK
covers a new table with no legacy rows).

**Stamped by the server, never from the request.** The guest route schema is `.strict()` and has
no account, organization or order field. The service writes both columns as `null` from the guest
path, and the guest path is chosen by which route was called (an anonymous route behind a guest
session), never by a body field.

### Is a guest case a "no-organization scoping path"? No.

Principle XI forbids a path on which the guard *resolves a null tenant for a valid transacting
customer*:

- **The guest is not a transacting customer of the platform.** They have no account, bought
  nothing here (G1: off-platform only, never an order), and cannot transact. The same reasoning
  covers forms' anonymous entries and the newsletter's unattributed subscribers.
- **No read resolves "organization = null".** `single-org`, `allowed-set` and `excluded-set` can
  never match a null organization (F3). Only `all` and `system` see a guest case, and those modes
  are explicit widenings, not a missing filter.
- **The write side.** The org-write guard lets a null organization through by design (F2). The leak
  that permits is "a row nobody scoped can read". The check above, plus the strict schema, makes
  sure a guest case can never *carry* an organization, which would plant it in a tenant (G6).

### Who reads a guest case, and how

| Actor (mode) | Sees guest cases? | How |
| --- | --- | --- |
| Unrestricted admin (`all`) | yes | the ordinary admin routes, `returns:read` |
| Sales representative (`excluded-set`) | **no** | filter excludes null; a direct id answers `404 NOT_FOUND`, identical to absent |
| Admin with an allowed set (`allowed-set`, API keys, …) | **no** | same |
| Signed-in customer (`single-org`) | **no** | `organizationId = X` never matches null, so even a matching e-mail never surfaces a guest case (G6) |
| Guest with a session (anonymous → `system`) | only **pending uploads of that session**, and only to claim them while filing | every query is keyed explicitly by `guest_session_id` (R-4) |
| Tracking-link holder (anonymous → `system`) | **exactly one case**: the one the opened token names | `GuestCaseAccess.load` (below) |
| Workers (`system`, `withSystemScope(reason)`) | all | maintenance erasure, notifications |

**The `system` context of anonymous traffic is not a scope.** It is the platform's explicit mode
(F4), and it reads unfiltered. So the guest and tracking routes **must** constrain every query
themselves, and the plan gives that one home: **`GuestCaseAccess`**, a service in `returns`, is the
only code that turns a guest credential into rows.

- `load(trackingToken)` opens the seal (R-5), reads `{ id, customerAccountId: null, trackingVersion }`,
  and applies the expiry and erasure rules. It answers `null` for everything else. Every tracking
  route starts with it.
- `pendingUploadsOf(sessionId)` reads `{ guestSessionId, returnCaseId: null, expiresAt > now }`.
- `attachmentOf(caseId, attachmentId)` reads `{ id, returnCaseId: caseId }` with the case already
  loaded by `load`.

A static test asserts that the guest and tracking route files reach `ReturnCase`,
`ReturnCaseAttachment` and `ReturnCaseComment` only through `GuestCaseAccess`. That is the
token-scoping counterpart of `ReturnCaseScope` for customers.

**A request that also carries a customer session (lead ruling on batch 2, 2026-11-16).** The
platform's `onRequest` scope hook derives the tenant context from whatever session cookies
the request carries, before any route runs. A browser signed in as a customer would therefore
reach the guest routes scoped `single-org` to that customer's organization, where a guest
case — which has none — reads as absent. Every guest and tracking route (G1 – G10) shares one
`preHandler`, registered once for the group in `routes.guest.ts`: it drops the actor the
cookies resolved to (`request.actor = undefined`) and calls the platform's
`scopeRequestToActor(request)` (`@endora-commerce/platform/kernel`), which derives the
context again from no actor — the anonymous system context of F4. That is the seam `auth`'s
own guards use when a route accepts a different actor from the ambient one. `withSystemScope`
stays rejected (below): the gate does not widen anything, it puts the request back where
anonymous traffic already is, and `GuestCaseAccess` remains the boundary.

### Cross-tenant tests required (Principle XI gate)

- A sales representative and an allowed-set admin get **404** on a guest case for detail, comments,
  transition, settlement, shipments, attachments and file download, and the new erase and
  reissue-link routes. The list, count, search (by contact e-mail too), export and saved views
  omit guest cases.
- A signed-in customer whose account e-mail equals a guest case's contact e-mail does not see the
  case in their list or by id.
- A tracking token for case A cannot read, comment on or download from case B; an expired, replaced
  or erased token answers exactly as an unknown one.
- A guest session cannot claim another session's or a customer's pending upload. A customer cannot
  claim a guest's.
- An insert of a guest case with an organization is refused by the check. A guest request body
  naming `organizationId`, `customerAccountId` or `orderId` is refused by the schema.
- `check-entity-tenant-classification` passes with the new `@GlobalEntity` classification.

**Verdict: compliant.** It rests on the forms/newsletter reasoning, with two additions this review
makes binding:

1. The database refuses a guest case that carries an organization.
2. Every guest and tracking query goes through `GuestCaseAccess`, because anonymous traffic runs in
   the unfiltered system mode.

The residual is 180's, not new: customer cases filed before D-178 may carry an account and no
organization (R-2).

**Rejected.**

- *Re-classify `ReturnCase` as `@CustomerScoped`* (forms' `FormEntry` precedent). It would move
  every customer read onto the account axis, and `ReturnCaseScope`'s roll-up reach (filter decides
  the organization) would have to be rebuilt.
- *Give a guest case a synthetic "guest" organization.* A shared bucket is exactly the failure D-178
  removed: every guest case in one tenant, readable by whoever is scoped to it.
- *Run guest routes under `withSystemScope(reason)`.* Anonymous traffic is already in system mode.
  The escape hatch would add an audit row per page view without adding a boundary;
  `GuestCaseAccess` is the boundary.

## R-2 — Legacy cases with an account and no organization

**Measure first** (quickstart § *Preflight*):

```sql
select count(*) filter (where organization_id is null) as no_org, count(*) as total from return_cases;
```

The owner's development database answers 0 of 5. A long-lived instance may answer more: cases filed
before D-178 made `customer_accounts.organization_id` not null copied a null from the order.

**Decision.** *Guest* is derived from **`customer_account_id is null`**, never from the
organization, and never stored as a flag (180 R5's posture for *off-platform*). Every existing row
has an account (the column is `not null` until this feature's migration), so **no existing row can
be classified as a guest case**, whatever its organization. The database check is the one-way
`guest ⇒ no organization` of R-1. It is fully validated on creation, because it holds for every
existing row (all of them have an account).

**Rejected.**

- *Full equivalence check, `not valid` for legacy rows.* PostgreSQL checks a `not valid` constraint
  on every later `UPDATE` of a row. A legacy null-organization case could then no longer be
  transitioned, commented or settled, which would turn a reporting residual into an outage.
- *Back-fill the organization in the migration* from `orders` or `customer_accounts`. That is a
  `returns` migration writing from another module's table (Principle I). 180 kept to its own tables
  for the same reason. It is a follow-up (180's *Follow-ups*: reconcile, then `not null`), which this
  feature's design does not depend on.
- *An explicit `origin` column* (`order` / `off_platform` / `guest`). It is redundant with two facts
  the row already holds (`order_id`, `customer_account_id`), could disagree with them, and 180
  ruled *off-platform* derived for exactly that reason.

## R-3 — Verification: one-time link, scanner-safe, uniform answer

**Decision.**

1. `POST /api/v1/returns/guest/verifications` takes `{ email, hp, language }`. It always answers
   **`202 { data: { linkValidMinutes: 60 } }`**, the same body for every outcome:
   - The honeypot is checked first. A hit stores and sends nothing.
   - The per-address throttle is next (R-8). Over the limit, nothing is stored or sent.
   - Otherwise a `return_guest_verifications` row is written: the channel, `email`, `email_hash`
     (SHA-256 of the lower-cased address), `language`, `link_expires_at = now + 60 min`. Earlier
     unredeemed rows of the same `email_hash` and channel get `link_expires_at = now` (FR-022).
     A job `guest_verification { verificationId }` is enqueued on `returns-notifications`.
   - The handler does no account lookup and no send. Its work and timing are the same with or
     without an account, so neither the response nor its timing can enumerate (FR-021). The worker
     decides whether the address has an account, for the e-mail's extra sentence (FR-025), through
     `customerAccountReadPort`. That lookup's result exists only inside the e-mail.
2. **The link carries a sealed id, not a stored secret** (R-5): `token = seal('returns.guest-verify.v1',
   verificationId)`. The storefront address is `/returns/guest/verify?token=…`.
3. **Opening the link does not redeem it.** The GET renders a page with one *Continue* button that
   POSTs. Corporate mail scanners and link previews fetch GET URLs. A link redeemed by a GET would
   be "already used" before the person clicks it, and that is the commonest support failure of
   one-time links.
4. `POST /api/v1/returns/guest/sessions { token }` opens the seal and checks the row (unredeemed,
   unexpired, channel = the request's). It sets `redeemed_at`, generates a **session token** (32
   random bytes, base64url) and stores only `session_token_hash` (SHA-256) and
   `session_expires_at = now + 24 h`. It answers `201 { data: { sessionToken, email, expiresAt } }`.
   Every refusal (unknown, altered, expired, used, other channel) is one answer: `410
   RETURN_GUEST_LINK_INVALID`.
5. **Re-opening a used link in the same browser** (spec edge case; owner ruling O-2, 2026-11-16):
   the storefront cannot tell which verification an opaque session came from, so a refused POST
   continues to the form while the browser holds **any** live guest session (G5 answers `200`); the
   form shows the locked verified address. Otherwise it shows the *link no longer works, send a new
   one* page, its address prefilled only from this browser's own pending cookie (O-3). This also
   covers a double click on *Continue*.

**Rejected.**

- *A random link token stored hashed.* The token has to reach the worker that sends the e-mail.
  Putting it in the BullMQ job puts a secret in Redis and breaks 180's ids-only job rule (180 R-2).
- *Send the e-mail inside the request.* Timing would reveal which addresses were sent to, and an SMTP
  failure would surface to the caller.
- *A six-digit code instead of a link.* It is guessable within a 60-minute window unless attempts
  are counted per verification, and it adds a typing step on mobile. The link is what the owner
  ruled (G3).

## R-4 — The guest session, its cookie, and what it owns

**Decision.**

- **Where it lives.** The storefront route handler that redeems the link sets
  **`b2b_returns_guest`**: `HttpOnly; Secure (production); SameSite=Lax; Path=/; Max-Age=` the
  session's remaining lifetime. The backend's guest routes read it from an **allow-listed `Cookie`
  header** the storefront forwards, the anonymous-cart pattern (F15). The value is opaque. The
  backend looks it up by hash and binds the request to `{ verificationId, salesChannelId, email }`.
  A session from another channel is refused as absent.
- **Leaving.** `DELETE /api/v1/returns/guest/sessions/current` sets `ended_at`, and the storefront
  deletes the cookie (FR-023).
- **Pending uploads.** `return_case_attachments` gains `guest_session_id` (the verification id). A
  guest upload has `customer_account_id null`, `organization_id null`, `guest_session_id` set and the
  24-hour `expires_at` of 180 R-12. It is stored under `returns/guest/<attachmentId>`, a prefix with
  no organization. Claiming at submission requires `guest_session_id` = the request's session (R-1).
- **Submission key.** `return_cases` gains `guest_session_id`. A partial unique index on
  `(guest_session_id, submission_key) where customer_account_id is null and submission_key is not
  null` gives a guest the 180 R-18 behaviour. A repeated key from the same session answers the case
  already filed. The same key from another session is a new case, so no session can fetch another
  session's case by replaying a key. 180's `(customer_account_id, submission_key)` index stays for
  customers (two null accounts never collide in a unique index).
- **Several complaints per session** are allowed while the session lives (spec edge case), with the
  throttles of R-8.
- **A signed-in customer holding a guest session.** The guest routes ignore the customer session.
  The case is stamped from the guest path only (spec edge case, FR-033). They also ignore it for
  **scope**: the group's gate drops the customer actor and re-derives the anonymous context
  with `scopeRequestToActor` (R-1, *A request that also carries a customer session*), so a
  customer cookie beside the guest one neither attributes the case nor hides it.

**Rejected.**

- *A JWT-style self-contained session.* It cannot be ended before it expires (FR-023 *"ends when the
  visitor leaves it"*), and it would carry the e-mail address in the cookie.
- *A header (`X-Returns-Guest-Session`) instead of a cookie.* The browser cannot hold a header. The
  storefront would still keep a cookie and translate it, which is the cart pattern with one more
  name.
- *Binding the session to the IP or user agent.* Mobile networks change IPs mid-form, and it adds no
  protection a 24-hour, httpOnly, random token lacks.

## R-5 — The tracking link: a sealed, versioned reference; nothing secret stored

**The constraint.** The coordinator asked for *hash-only storage*. The spec requires the link in
**every** later e-mail (FR-044), sent by a worker days or weeks after filing. A random token stored
only as a hash cannot be put into a later e-mail. Something must let the server re-derive it.

**Decision.** The tracking token is **`cursorSeal.seal('returns.guest-tracking.v1',
`${caseId}:${trackingVersion}`)`** (F16):

- **Nothing token-like is stored.** `return_cases.tracking_version` (an integer, `1` at filing) is
  the only state, which is stricter than hash-only. A database read discloses no usable link.
- **It is deterministic**, so every e-mail about the case carries the same link until it is
  replaced (FR-044, SC-005).
- **It is unforgeable and opaque.** It is not derivable from the reference, the id or the e-mail
  (FR-040). The purpose is the GCM additional data, so a pagination cursor or a verification token
  never opens as a tracking token.
- **Replacing it** (FR-046) increments `tracking_version`. The previous token still opens, but to a
  version that no longer matches, so it is refused like an unknown one.
- **Validity** is computed, not stored: valid while `customer_account_id is null`,
  `personal_data_erased_at is null`, and `closed_at is null or closed_at + 90 days > now` (FR-043).
- **Every refusal is one answer**: `404 RETURN_TRACKING_LINK_INVALID` with one sentence (FR-043,
  SC-007).
- **Transport.** The storefront page `/returns/track/<token>` forwards the token to the backend in
  the header `X-Returns-Tracking-Token`, never in the backend URL, so the backend's request log never
  records it. The storefront page sends `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`,
  and every outbound link on it is `rel="noreferrer"` (FR-011, FR-040). The token is in the
  storefront's own URL. That is unavoidable for a link, and it is stated in the operator docs.
- **Cost.** The token is about 210 URL-safe characters (the seal pads to 128 bytes). E-mail clients
  carry links of that length. The success page shows it behind a *Copy link* button, not as text to
  read.
- **Key rotation.** Rotating `SESSION_COOKIE_SECRET` invalidates every tracking and verification
  link, as it already invalidates sealed cursors and every session. The operator docs say so, and
  *Send a new tracking link* is the remedy.

**Owner ruling 2026-11-16: accepted (plan § Owner rulings, item 1).** `cursor-seal.ts`'s header says the
derived key *"is used for nothing else"*. The seal is purpose-bound, so a second purpose is sound
cryptographically, but the sentence has to change. That is a one-paragraph documentation change in
`packages/platform` (and a no-release changeset). `returns` names the seal through a local structural
type (`{ seal(purpose, payload): string; open(purpose, token): string | null }`) resolved from the
container as `cursorSeal`. It never imports `@endora-commerce/platform/composition`, which
`check:platform-surface` reports as `host-internal-subpath`.

**Rejected.**

- *A random token, hash-only, rotated on every e-mail.* Every earlier e-mail's link would die when
  the next one is sent. A guest who opens the confirmation after a status e-mail would hit the
  neutral page.
- *A random token stored in plain text.* A database read would grant write access (comments, files)
  as the guest. The coordinator's constraint exists to stop exactly that.
- *A dedicated platform secret* (`RETURNS_GUEST_TOKEN_SECRET`, as `newsletterTokenSecretFrom`
  does). It needs a new platform registration and an environment input every instance must
  provision or fall back from. That is more platform change than reusing the purpose-bound seal the
  platform already derives from the same key.
- *A `secret`-typed setting holding an HMAC key.* Something has to generate it: an install hook
  does not run on a boot-first database (AGENTS.md *Commands*), and lazy generation from a request
  is a settings write on an anonymous path. It also depends on `SETTINGS_SECRET_ENCRYPTION_KEY`,
  without which the whole guest flow would fail.

## R-6 — Guest writes through the Command Bus, with an actor that is not an account

**Decision.** Anonymous traffic runs in system context (F4), so `CommandBus.run` records actor kind
`system` with no admin or customer id (F5). Each guest Command therefore puts **`by: 'guest'`** and
the **`guestSessionId`** in its audit state. That id is opaque and erased with nothing: it identifies
a session, not a person.

| Write | Command | `stateAfter` (names only, never values) |
| --- | --- | --- |
| File a guest complaint | **`return_case.create`** (180's, reused) | 180's fields + `by: 'guest'`, `guestSessionId` |
| Guest comment from the tracking page | **`return_case.comment.add_by_guest`** (new) | `commentId`, `length` |
| Guest file from the tracking page | **`return_case.attachment.add`** (180's, reused) | `attachmentId`, `type`, `by: 'guest'` |
| Send a new tracking link | **`return_case.tracking_link.reissue`** (new, admin) | `trackingVersion` |
| Erase guest data | **`return_case.guest_data.erase`** (new; admin or system) | `trigger: 'retention' \| 'request'`, `attachmentCount`, `fields: ['contact','returnAddress']` |
| Verification request, session redeem, pending upload | not Commands | `command-coverage-ignore` with reason: they write no case. The verification row holds the address for 7 days at most and is not an audited business record. 180 classified pending uploads the same way. |

Customer comments stay as they are (`command-coverage-ignore`, 180 R-11). The guest comment is a
Command because it is a write by an unauthenticated party, and the spec requires it audited
(FR-091).

**Rejected.**

- *A new `guest` actor kind* in `@endora-commerce/contracts` `Actor` and in the platform's command
  actor. It is a cross-cutting contract change (every consumer of `Actor` must handle it) for a
  label the state already carries.
- *Auditing as the case's "customer".* There is none. Inventing an id would put a fake account into
  the audit log.

## R-7 — E-mails: guest twins, two non-deactivatable

**Decision.** Seven new transactional templates in `returns`' manifest, group `returns`, shipped in
`en-US` and `pl-PL`, each carrying **`trackingUrl`** where the account templates carry `caseUrl`:

| Code | Twin of | `nonDeactivatable` | `messageId` |
| --- | --- | --- | --- |
| `return_guest_verification` | — | **yes**: the only way in (FR-025) | `return_guest_verification:<verificationId>` |
| `return_guest_submitted` | `return_submitted` | **yes**: the guest's only durable way back (FR-045) | `return_guest_submitted:<caseId>` |
| `return_guest_comment_added` | `return_comment_added` | no | `return_guest_comment:<commentId>` |
| `return_guest_status_entered` | `return_status_entered` | no | `return_guest_status:<eventId>` |
| `return_guest_authorized` | `return_authorized` | no | `return_guest_authorized:<caseId>:<rmaNumber>` |
| `return_guest_rejected` | `return_rejected` | no | `return_guest_rejected:<caseId>` |
| `return_guest_link_reissued` | — | no | `return_guest_link:<caseId>:<trackingVersion>` |

- **Choosing the template** is a single function, `customerMessageFor(rc, accountCode)`. For a
  guest case it answers the twin and the recipient `rc.contact.email` (the verified address). For an
  erased case it answers nothing: FR-072, no e-mail after erasure. For an account it answers 180's
  behaviour unchanged. `dispatch.ts`'s `toCustomer` and `ReturnEmailNotifier`'s authorized/rejected
  go through it.
- **Language**: the sales channel's (180 R-5; spec *Edge cases, Language*).
- **The verification e-mail's account sentence** (FR-025) is a conditional block,
  `{{if hasAccount}}…{{/if}}`, filled by the worker.
- **The shop's *new case* e-mail is not twinned.** `customerName` becomes *"{name} (guest)"*,
  translated, and `organizationName` is empty (FR-050). An operator-edited template keeps working.

**Rejected.**

- *Reuse the account templates with a conditional `{{if trackingUrl}}` block.* The defaults say
  *"in your account"*, and an operator who already edited a template would never receive the new
  block. The guest would get an e-mail with no way back, which breaks FR-044.
- *One generic `return_guest_update` template* for comments, statuses, authorization and rejection.
  Authorization carries the RMA number and return instructions, and rejection carries the reason.
  One template with four conditional bodies is harder for an operator to edit than four plain ones.
- *Make the account `return_submitted` non-deactivatable.* That overrides an operator's existing
  choice for account holders, which FR-045 explicitly keeps.

## R-8 — Throttles and the honeypot

**Decision.** The honeypot is a field named `hp`, with forms' `isHoneypotHit` rule **re-implemented
in `returns`**. It is four lines, and importing forms' internals would breach Principle I. A shared
helper would need a new published surface for one predicate. Throttles:

| Surface | Per client address (route `config.rateLimit`) | Per identity (service, database count) | Over the limit |
| --- | --- | --- | --- |
| Request a link | 5 / 10 min | 3 / hour and 10 / day per `email_hash` per channel | IP: `429 RATE_LIMITED`. Address: the uniform 202 with nothing sent (FR-021) |
| Redeem a link | 20 / 10 min | — | 429 |
| Guest upload | 60 / 10 min | at most 10 pending per session | 429 / `RETURN_ATTACHMENT_REJECTED too_many` |
| Guest submission | 10 / 10 min | 5 cases per session; 10 cases / 24 h per verified address | 429 / `RETURN_GUEST_LIMIT_REACHED` |
| Tracking read | 60 / 10 min | — | 429 |
| Tracking comment / file | 10 / 10 min | 20 comments / 24 h per case; 180's 10 files per case | 429 / `RETURN_GUEST_LIMIT_REACHED` |

The per-IP 429 says nothing about any e-mail address, so it does not conflict with FR-021. The
plan records this reading in *What the plan changed in the spec*. Unguessability of the tracking
token comes from the seal (R-5). The read throttle is defence in depth against log noise, not
against guessing.

**Rejected.** *A captcha.* Forms made it optional, operator-configured and secret-backed. A one-time
e-mail link already costs a bot a mailbox per attempt.

## R-9 — "Closed", erasure and expiry

**Decision.**

- **A case closes when it enters a terminal status** (`isTerminal`: by default *Closed*, *Rejected*,
  *Cancelled*). The transition service writes `closed_at` on entry into a terminal status (F12: the
  column exists and was never written). It is written for every case, guest or not, because it is a
  fact about the case.
- **Reopening cannot happen.** The status graph refuses an edge out of a terminal status. FR-074
  therefore holds by construction. The plan keeps one test asserting that a terminal status has no
  exit, so the requirement fails loudly if that invariant ever changes.
- **Retention** is the global setting `returns.guest_data_retention_days`, default **90**. It is
  **clamped to 30–3 650 when read**, because the settings store validates no range (F17, 180 R-4's
  precedent). The setting's description states the range. A channel value is not consulted: it is
  read with no channel.
- **Erasure** is a step of the existing daily `returns-maintenance` sweep: guest cases with
  `personal_data_erased_at is null and closed_at < now - retention`, run in batches of 100 under
  `withSystemScope('returns: guest data retention')`. Each case runs Command
  `return_case.guest_data.erase` (trigger `retention`), which:
  - nulls `contact` and `return_address`;
  - deletes every attachment's bytes, then its row;
  - stamps `personal_data_erased_at`.

  Comments, lines, purchase data, clauses and the resolution stay (G10). The same Command serves the
  admin action (trigger `request`, FR-072).
- **The same sweep** deletes `return_guest_verifications` rows older than 7 days (FR-026). Expired
  unclaimed guest uploads fall under 180's existing `expires_at` sweep unchanged.
- **Module off.** The sweep is a `ctx.worker` and does not run while `returns` is off. Erasure that
  falls due is postponed until the module is back, as 180's anonymisation reconciliation is. The
  operator documentation discloses this (spec *Edge cases*). There is no off-state exception: an
  exception would be a worker running for an absent module (Principle XVII).
- **Customer anonymisation** erases by `customer_account_id`, which a guest case does not have, so it
  never touches one (FR-075). There is no code change, only a test and the docs.

**Rejected.**

- *Erase at a fixed 90 days with no setting.* Retention is the controller's legal judgement and
  varies with claim-limitation periods (spec *Assumptions*).
- *Count from `resolved`.* *Resolved* is not terminal in the configurable graph. A case resolved and
  then rejected on appeal would be erased mid-process.
- *Delete the whole case.* It is a commercial record an operator may need after the guest is
  forgotten (180 R-15's reasoning).

**Recorded consequence.** A case an operator never moves to a terminal status is never erased. The
admin list can already filter by status. The operator docs tell operators to close settled cases.
Accepted by the owner on 2026-11-16 (plan § Owner rulings, item 3).

## R-10 — Admin: origin filter, search, bell audience, permission, actions

**Decision.**

- **Origin filter.** `origin` widens from `platform | off_platform` to `platform | off_platform |
  off_platform_customer | guest`.
  - `off_platform` keeps its meaning, *all bought elsewhere*, so 180's saved views stay correct.
  - The admin `Select` offers *All*, *With an order*, *Bought elsewhere*, *Bought elsewhere –
    customer* and *Bought elsewhere – guest*.
  - The summary row gains `guest: boolean`, and the export gains `guest`.
  - For an admin who cannot see guest cases the filter still exists and answers an empty list. It is
    not hidden, because hiding it would disclose that the admin's scope is narrower.
- **Search** by contact e-mail: the list's free-text `q` also matches `lower(contact->>'email')`
  exactly (no partial match on e-mail, so search cannot be used to enumerate). It is indexed (data
  model) and filtered as every list query is.
- **Bell audience** (FR-051). For a guest case, `bellRecipients` keeps only those `returns:read`
  holders for whom `adminTenantScopePort.resolveForAdmin(id)` answers `allowAll` (F6). If that port
  throws or answers `unresolved`, the admin is skipped (fail closed). Customer cases keep 180's
  audience.
- **Permission** (FR-072). A new code, **`returns:erase_personal_data`**, `requires: ['returns:read']`,
  gates the erase route. Labels go in `i18n/{en,pl}.json` under `adminRoles.permission.*`, per
  `specs/conventions/module-admin-surfaces.md`.
- **Send a new tracking link** is gated by `returns:write`. It is an ordinary case action, and any
  operator who handles the case may need it.
- **Detail.** It gains `guest`, `contactVerifiedAt`, `trackingLinkValidUntil` (computed) and
  `guestDataErasureDueAt` (computed). Two actions are added to the detail's action menu: *Send a new
  tracking link* and *Erase personal data* (`ConfirmDialog`, irreversible copy).
- **Palette.** No new admin screen, so no new palette action (Principle XVI is met by
  `returns-list`).

**Rejected.**

- *Hide guest cases behind a separate permission.* Visibility is a tenancy fact (R-1), and a
  permission would duplicate it with a second rule that could disagree.
- *Reuse `returns:write` for erasure.* Erasure is irreversible and is a GDPR action, which a shop
  typically grants to fewer people than case handling.

## R-11 — Replacement settlement for a guest case (coordinator item 8)

**Verified in code (F11).**

- A replacement on an off-platform case writes `resolution_type = 'replacement'`. Optionally it
  writes a `ReturnShipment` row (`direction: 'replacement'`), which is `returns`' own
  `@GlobalEntity`, keyed by the case and holding no organization.
- `returns` calls no `shipments` module, and creates no order, invoice, stock movement or credit for
  an off-platform case (180 FR-B15, `return-settlement-service.ts:748`).
- The only organization use in settlement is the credit top-up (`rc.organizationId`,
  `return-settlement-service.ts:560`), and that resolution is already refused off-platform.

**Decision.** Nothing to change. A guest case settles through 180's off-platform branch unchanged.
Tests assert that replacement, repair and *settled outside the platform* work on a guest case, and
that refund, credit and a corrective invoice answer `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`.
The physical replacement goes to `return_address` as given. If an operator ships it by hand before
the data is erased, nothing in the platform depends on the address afterwards.

## R-12 — Presence: module, setting, dependency

**Decision.**

- Every new backend route is registered through `ctx.routes` in a new file `routes.guest.ts`, and the
  new admin routes are added to `routes.admin.ts`. Both disappear while `returns` is off. New worker
  jobs ride the existing `returns-notifications` and `returns-maintenance` workers (`ctx.worker`).
- **The guest setting is evaluated inside the active module.** The effective state for a channel is
  `returns.off_platform_complaints_enabled ∧ returns.guest_complaints_enabled`, read for the request's
  resolved channel (Principle XII). Off answers `403 RETURN_GUEST_COMPLAINTS_DISABLED` on
  verification, session redeem, guest form-config, upload and submission. Tracking routes ignore the
  setting (FR-002: existing cases keep working). **Leaving a session (G4) is not gated by the setting
  either** (lead ruling on batch 2): it only ends the caller's own session, and refusing it while
  the setting is off would strand a cookie the visitor could no longer end.
- `GET /api/v1/returns/guest/availability` (anonymous) answers `{ enabled }` for the channel. The
  storefront uses it to decide whether to offer *Continue without an account* (FR-010). While the
  module is off the route does not exist (404), and the storefront treats that as disabled. The new
  storefront pages also sit behind `requireModulePresent('returns')` (F18), so they are not-found
  pages (FR-080, SC-008).
- **Order of checks** on every guest route: module gate (platform), then setting (not on G4 and
  G8 – G10), then session or token. A module-off request therefore never learns whether a token is
  valid.

**Rejected.** *A sub-module `returns_guest`.* It would split one form's paths across two owners and
fail Principle I's ownership test, as 180 R-16 concluded for the no-order path.

## R-13 — Storefront

**Decision.** Follow 180's route-handler pattern (`storefront/app/returns/submit/route.ts`) and reuse
its form leaves.

| Path | Kind | Does |
| --- | --- | --- |
| `app/returns/guest/page.tsx` | page | **Entry**: *Sign in* (with `next` = the `from` query, path and query kept) or *Continue without an account* + e-mail field + honeypot; posts to `…/guest/request` |
| `app/returns/guest/request/route.ts` | POST | calls verifications; 303 to `…/guest/sent` (always) |
| `app/returns/guest/sent/page.tsx` | page | uniform *link on its way* copy, *use another address*, *send again* after 60 s |
| `app/returns/guest/verify/page.tsx` | page | GET always shows *Continue* (scanner-safe, R-3); `?state=invalid` continues to the form with any live guest session, else *link no longer works* (O-2, O-3) |
| `app/returns/guest/verify/continue/route.ts` | POST | redeems; sets `b2b_returns_guest`; 303 to `…/guest/new`; a refusal 303s to `?state=invalid` (Next refuses a `route.ts` beside `page.tsx`) |
| `app/returns/guest/new/page.tsx` | page | 180's no-order form (`OffPlatformLines`, `LineSlots`, `AttachmentField`, `ClauseList`, `ProductField`) in guest mode: e-mail locked and shown as verified, nothing prefilled, *signed-in* note (spec edge case) |
| `app/returns/guest/uploads/route.ts`, `…/guest/submit/route.ts` | POST | as 180's `uploads`/`submit`, against the guest API with the forwarded cookie; success → `…/guest/submitted/<reference>` |
| `app/returns/guest/submitted/[ref]/page.tsx` | page | reference, tracking link with *Copy link*, "keep this link", *File another complaint* while the session lives |
| `app/returns/guest/leave/route.ts` | POST | ends the session |
| `app/returns/track/[token]/page.tsx` | page | the tracking page; `Referrer-Policy: no-referrer`, `noindex`; read-only once closed |
| `app/returns/track/[token]/comments/route.ts`, `…/attachments/route.ts`, `…/files/[attachmentId]/route.ts` | POST/GET | comment, add file, download proxy with the token as header |
| `app/returns/guest/layout.tsx`, `app/returns/track/layout.tsx` | layout | `requireModulePresent('returns')` |

- **Signed-out entry** (FR-010). `app/(account)/returns/new/page.tsx:65` and the `/returns` list page
  redirect a signed-out visitor to `/returns/guest?from=<path+query>` **when** `availability.enabled`.
  Otherwise they keep today's `/login?next=…`. The guest page's *Sign in* goes to
  `/login?next=<from>`, which keeps 180 D-14's query-preserving behaviour.
- **Route precedence.** `returns/guest` and `returns/track` are static segments and win over
  `(account)/returns/[id]`. A routing test pins this.
- **Copy** in `storefront/lib/i18n/messages/account.ts` under `returns.guest.*`, beside every other
  `returns.*` key, in English and Polish (design review F-11).
  "bought elsewhere" and "without an account" are the customer's words (180 design review R-1.5).

**Rejected.**

- *Put the guest form inside `(account)`.* That group's layout and pages assume a session, and every
  guard there would grow a guest branch.
- *A server action instead of route handlers.* 180 chose route handlers so the form works without
  JavaScript with 303s and the attempt cookie. Same reasons here.

## R-14 — One merge request, its base, and build order

> **Superseded in part by owner ruling 2 (2026-11-16).** 181 is built now, in 180's working tree, and split at commit time into a 180 MR and a stacked 181 MR. The build order below stands.

**Decision.** **One MR** (owner's preference), branch `feat/181-guest-complaints` from
`origin/master` **after `feat/180-off-platform-complaints` has merged**. 181 edits 180's still
uncommitted files (`return-case-service.ts`, `dispatch.ts`, the off-platform migration's neighbours,
the storefront form). Stacking on an unmerged branch would make every 180 review change a rebase of
181. Internal build order: plan § *Delivery and sequencing* (G-1 … G-9), with the branch green after
G-2 (the nullable account and its ripple) before any guest behaviour is added.

**Rejected.** *Stack on `feat/180-off-platform-complaints` now.* It is only worth it if 180's merge
slips by weeks. If it does, the orchestrator can start G-1/G-2 stacked and rebase once.
