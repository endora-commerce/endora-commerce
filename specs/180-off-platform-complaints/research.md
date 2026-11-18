# Research: Return-case notifications and complaints without a platform order

**Feature**: `specs/180-off-platform-complaints/` | **Date**: 2026-11-13 | **Plan**: [plan.md](./plan.md)

Every decision is written as **decision → rationale → alternatives rejected**. Paths are relative
to the repository root. Facts about today's code were read on `feat/180-off-platform-complaints`
at `defd3e2e0`.

## Findings that shaped the plan

| # | Finding | Where |
| --- | --- | --- |
| F1 | `notifyCustomer` is persisted and nothing sends on it; the comment says it waits for a product decision. | `packages/modules/returns/src/backend/services/return-comment-service.ts` `addByAdmin` |
| F2 | The only customer e-mails are *authorized* and *rejected*, sent inline after the transition, best-effort, through feature 047's `TransactionalEmailSender` with a legacy-mailer fallback. | `services/return-email-notifier.ts`, `services/return-authorization-service.ts` |
| F3 | **The generic transition routes can move a case into `authorized` or `rejected` without the authorization's effects.** `POST /api/v1/admin/returns/:id/transition` and `/bulk-transition` call `ReturnTransitionService.apply` directly; only `ReturnAuthorizationService.authorize` assigns the RMA number and `authorizedAt` and sends the e-mail, and nothing guards `to = authorized`. | `routes.admin.ts`, `services/return-transition-service.ts`, `domain/return-status-graph.ts` (`RETURN_STATUS_AUTHORIZED`) |
| F4 | Who authorized a case is recorded only in the kernel audit log: `return.status_changed` with `actorAdminUserId` and `stateAfter.statusCode`, written best-effort after the flush. There is no status-history table (`return_status_transitions` is the graph's edges). | `services/return-transition-service.ts` `apply` |
| F5 | **No customer can upload a file anywhere.** `assets_library` uploads only under `/api/v1/admin/assets`; `routes.public.ts` serves files by id or permalink, and assets default to `visibility: 'public'`. Both `createCase`'s `attachmentAssetIds` and `POST /api/v1/returns/:id/attachments` take an `assetId` the customer cannot create, with **no ownership check**. | `packages/modules/assets_library/src/backend/routes.{admin,public}.ts`, `packages/contracts/src/returns.ts` (`createReturnCaseRequestSchema`, `addReturnAttachmentRequestSchema`), `services/return-case-service.ts` |
| F6 | Attachments are write-only: `ReturnAttachmentService.listForCase` has no route; neither the admin `ReturnDetail.tsx` nor `mapDetail` shows attachments; the storefront never calls the route. | `services/return-attachment-service.ts`, `src/admin/pages/ReturnDetail.tsx`, `storefront/lib/api/returns.ts` |
| F7 | `ReturnCase.organizationId` is nullable; it is copied from the order's context. `ReturnCaseAttachment` is `@GlobalEntity` (reached through its case). | `entities/return-case.entity.ts`, `entities/return-case-attachment.entity.ts` |
| F8 | Case creation is hand-audited (`recordAuditFromContext`, inside the transaction); transitions are hand-audited after the flush, best-effort; status and reason configuration are hand-audited; only the consumer-consent write runs through `CommandBus.run`. | `return-case-service.ts`, `return-transition-service.ts`, `return-status-graph-service.ts`, `return-consent-service.ts` |
| F9 | `returns` does not take part in the customer anonymisation; `customer_account.anonymized.v1` is announced by `customer_accounts`, and `forms` is the worked subscriber (event + maintenance reconciliation, through a Command). | `packages/contracts/src/customer-accounts.ts`, `packages/modules/forms/src/backend/index.ts`, `services/erasure-service.ts` |
| F10 | No module outside `returns` subscribes to `return.status.*`; `ReturnStatusEvent.orderId` is read by nobody else. | `events/return-status-events.ts`, tree-wide grep |
| F11 | The settings store has `string_list` but validates no item; `orders.confirmation_recipients` is the precedent for an e-mail list, resolved per channel at send time. | `packages/contracts/src/settings.ts`, `packages/modules/orders/src/manifest.ts` |
| F12 | The storefront case form is a server action on `app/(account)/returns/new/page.tsx` and works without JavaScript; `forms`' `POST /forms/submit` route handler is the precedent for a no-JavaScript post with a 303 and an attempt cookie. | `storefront/app/(account)/returns/new/page.tsx`, `storefront/app/forms/submit/route.ts` |

F3, F5 and F6 are defects outside the request; the plan repairs F3 in phase A (FR-A40 needs it) and
F5/F6 in phase B (FR-B20–FR-B24 need it).

---

## R-1 — One merge request, built A before B

**Decision (owner ruling 2026-11-13, superseding the two-MR proposal).** The feature ships as one
merge request. Inside it, phase A (US1–US4: FR-A01…FR-A52) is built first and phase B (US5–US8:
FR-B01…FR-B43) second, on A's notification pipeline. Each phase brings its own migration and its
own tests, and the branch is green at the boundary. Contract changes, i18n and docs accumulate;
there is one changeset.

**Rationale for the order.** A has no dependency on any B decision. B reuses A's queue for its
e-mails (FR-B40), so building B after A avoids writing the trigger twice.

**Superseded.** *Two merge requests, A then B* was proposed to keep each review smaller and let A
reach deployments sooner; the owner chose one delivery. *B first* is still rejected: B's e-mails
would need a temporary inline path that A then deletes.

## R-2 — Notification delivery: a module queue, ids in the job, sent after commit

**Decision.** A new BullMQ queue **`returns-notifications`** in `returns`, modelled on
`forms-notifications` (`packages/modules/forms/src/backend/workers/forms-notifications-worker.ts`).
A job carries ids and nothing else:

| Job | Data | Produced when |
| --- | --- | --- |
| `case_submitted` | `{ returnCaseId }` | a case is filed (after its transaction commits) |
| `comment_notify` | `{ returnCaseCommentId }` | an admin comment with `notifyCustomer` is stored |
| `status_entered` | `{ returnCaseId, statusCode, eventId }` | a transition commits into a status with `notifyCustomerOnEntry` |

The worker re-reads the case, builds each message and sends through `TransactionalEmailSender`
with a deterministic `messageId` (`return_new_case:<caseId>:<recipientKey>`,
`return_submitted:<caseId>`, `return_comment:<commentId>`, `return_status:<eventId>`), so a retried
job is suppressed by the sender (`suppressed`, D-59) rather than sent twice (FR-A51). Bell entries
are recorded through `adminNotificationRecordPort.record`; the job keeps which steps it completed in
its own progress (the `forms` technique) so a retry records no second bell entry. Five attempts,
exponential backoff, as `forms`. A composition without a queue connection (the shared test server)
enqueues nothing and tests drive the processor directly.

`case_submitted` is produced by `ReturnCaseService.createCase` after its transaction returns
(phase A); in phase B, where creation becomes a Command (R-11), it is produced by a subscriber to the
Command's domain event, dispatched after commit by the bus — the `forms` shape
(`ctx.subscribe(FORMS_EVENTS.ENTRY_SUBMITTED, …)`).

**Rationale.** Up to ten shop e-mails, a confirmation and a bell fan-out per submission would add
their latency to the customer's request and lose every retry; a queue gives both back with the
pattern Principle X names. Ids-only jobs keep personal data out of Redis.

**Rejected.**
- *Inline best-effort sending, like `authorized`/`rejected`*: no retry, latency on the customer's
  submit, and eleven sequential sends in the request. The two existing e-mails stay inline — moving
  them is not this feature's decision.
- *The 176 outbox (`afterCommit` handler on a `returns` action)*: an `afterCommit` handler is
  another module's code on an action its owner declared hookable
  (`specs/176-command-hooks-outbox/contracts/command-hooks-api.md` §5–§6), and registration refuses
  an owner outside the registrant's dependencies; using it for a module's own follow-up work is a
  use the contract does not describe. Case creation is also not a Command in phase A.
- *A delivery-record table plus a sweep worker (179's design)*: 179 needs it for exactly-once
  in-app channels and a per-recipient admin History; here the e-mail sender already dedupes on
  `messageId` and nothing asks for a delivery history on the case (Principle IV).

**Accepted loss window.** A process that dies between commit and enqueue sends nothing for that
event; the failure to enqueue is logged. This is `forms`' FR-059 trade, stated rather than hidden.

## R-3 — Who the bell tells, and what it says

**Decision.** One `admin_user` entry per **active** administrator whose effective permissions
include `returns:read` (wildcards included, as `requireAdmin` judges), resolved through
`adminUserReadPort.listAll` and `permissionService.listPermissions` — 179's R-5 resolution. The
entry names the case's kind and submission date and links to `/returns/<id>`; it names **no**
customer or organization, because an organization-scoped administrator may hold `returns:read`
without being able to open that organization's case, and the bell must not disclose what the case
read refuses. (A per-recipient check is not available here: `adminCanSeeOrganization` in
`quote_requests/src/backend/services/admin-org-visibility.ts` reads platform-wideness from the
*ambient* scope, which in the worker is the system's, not the recipient's.) The shop e-mail, which goes to addresses the operator chose, carries the detail.
Title and body travel as `titleMessage`/`bodyMessage` (scope `returns`) beside the English
sentence (`packages/contracts/src/admin-notifications.ts`).

**Presence.** `admin_notifications` is deactivatable. `returns` declares it under
`nonBindingDependencies` with `kind: 'degrades-without'`, asks `effectiveState.isPresent` before
the call, and records "not present" in the job log rather than catching the port's refusal (D-60).

**Rejected.** *`all_admins` audience*: tells administrators who cannot open returns (179 Q6
precedent). *A new "admins holding code X" port in `admin_roles`*: rejected in 179 for the same
small counts. *Organization and customer in the bell text with a per-admin scope check*: there is
no published per-admin organization-scope read; disclosing nothing is simpler and safe.

## R-4 — New-case recipients: a `string_list` setting, validated at send

**Decision.** `returns.new_case_recipients`, `valueType: 'string_list'`, default `[]`,
sales-channel scopable through the standard settings scoping (a channel value replaces the
global). At send time the worker trims, lower-cases and de-duplicates the list, takes the first 10,
skips an entry that is not an e-mail address and logs it with reason `invalid_recipient` (spec
FR-A01 as corrected).

**Rationale.** It is the shape of `orders.confirmation_recipients` (F11) and what an operator
already knows from the Settings screen.

**Rejected.** *A `format`/`maxItems` constraint added to the settings manifest*: a change to
`settings` and `@endora-commerce/contracts` for every consumer, outside this feature's owner;
recorded as a candidate follow-up. *Per-form recipients like `forms`*: returns has one form.

## R-5 — Customer e-mails: four new operator-editable templates

**Decision.** Four transactional e-mails declared in the `returns` manifest
(`transactionalEmails`), each with English and Polish defaults in
`src/backend/email-templates/transactional-defaults.ts`:

| Code | To | Variables |
| --- | --- | --- |
| `return_new_case` | the shop recipients (R-4) | `caseReference`, `kindLabel`, `customerName`, `organizationName`, `productList`, `offPlatform`, `adminCaseUrl`, `submittedAt` |
| `return_submitted` | the filing account | `caseReference`, `kindLabel`, `productList`, `submittedAt`, `caseUrl` |
| `return_comment_added` | the filing account | `caseReference`, `commentBody`, `caseUrl` |
| `return_status_entered` | the filing account | `caseReference`, `statusName`, `caseUrl` |

`caseReference` is the RMA number when assigned, else the derived reference (R-20, FR-A44); it
replaces the `rmaNumber` variable the two last templates had in the first draft, which would have
been empty on an unauthorized case.

The recipient is the account that filed the case (`customerAccountId`, 170 FR-054), resolved
through the existing `createCustomerEmailResolver`. The language is the channel's default
(`createChannelLanguageResolver`), as for the two existing e-mails; the shop e-mail uses the same
channel language. `statusName` is the status's `name[language]`, falling back to `defaultName`.
URLs: `caseUrl` is `<storefrontBaseUrl>/returns/<id>` from the container's `storefrontBaseUrl`
(what `organizations` builds its invitation links from, `packages/modules/organizations/src/backend/index.ts`);
`adminCaseUrl` is `<configuredAdminBaseUrl()>/returns/<id>` (`@endora-commerce/platform/kernel`,
as `crm`'s `event.adminUrl` and `tasks`' `task.adminUrl`). With no admin base URL configured the
variable is empty and the template's `{{if}}` omits the link.

**Rationale.** Feature 047 makes every module e-mail operator-editable and deactivatable; four
codes keep each one independently switchable (US1 scenario 4, US2 scenario 2).

**Rejected.** *One generic "return update" template with a type variable*: an operator could not
deactivate the comment e-mail without the status e-mail. *Translating in the backend from module
bundles*: e-mail content is the template's (`module-i18n.md`), not a bundle string.

## R-6 — Comment notification

**Decision.** `adminAddCommentRequestSchema` refuses `notifyCustomer: true` with
`isCustomerVisible: false` (422 `VALIDATION_FAILED`, detail code `notify_requires_customer_visible`);
the admin form disables the checkbox while the comment is internal. After the comment is stored,
`addByAdmin` enqueues `comment_notify`. Nothing is enqueued for rows written before the release
(FR-A22) because only the new code path enqueues.

**Rejected.** *Silently ignoring the flag on internal comments*: the operator would believe a
customer was told. *Sending on the stored flag by a sweep*: would send the historical rows.

## R-7 — Status-entry e-mail, and one e-mail per transition

**Decision.**

1. `return_statuses.notify_customer_on_entry boolean not null default false`, edited on the
   existing status configuration screen (`ReturnStatusesConfigPage.tsx`) and its existing write.
2. `ReturnTransitionService.apply` enqueues `status_entered` after its flush when the target status
   is marked, the actor is an admin or the system — **never a customer** (D-13, FR-A31) — and the
   target is not `authorized` or `rejected`. Filing a case creates it in the initial status
   without going through `apply`, so it never enqueues a status e-mail (D-2): the rule is
   structural and is pinned by a test, not by a check on the status code. The initial status's
   toggle therefore stays editable (it fires on a later transition *into* that status, if the
   graph has one) and the screen says under it "Not sent when a case is filed; the confirmation
   e-mail covers that."
3. **Entering `authorized` or `rejected` by any path has the dedicated effects** (repairs F3): the
   mutation that assigns the RMA number and stamps `authorizedAt`/`authorizedByAdminUserId`, and
   the dedicated e-mail, move from `ReturnAuthorizationService` into the transition service as the
   effect of entering that status. `authorize()` and `reject()` keep their signatures and call it.
   So those two statuses always send their dedicated e-mail and never the status e-mail
   (FR-A32), and the status screen shows their *notify* toggle disabled with a sentence saying why.
4. Marking a status sends nothing for cases already in it (FR-A33): only a transition enqueues.

**Rationale.** FR-A40 says "whichever admin path"; with F3 standing, a bulk transition into
`authorized` would leave a case authorized with no RMA, no time and no authorizer. Making the
effects belong to the status, not to one route, fixes the class of defect rather than one route.

**Rejected.** *Refusing generic transitions into `authorized`/`rejected`*: breaks the bulk flow
operators use, and the graph is operator-configurable. *Sending both e-mails and documenting it*:
contradicts FR-A32. *Refusing the initial status's toggle as `dedicated_email_status`* (the
designer's first option for D-2): the owner chose "filing is not an entry", which needs no refusal.

## R-8 — The authorizer: a column, stamped in the transition, back-filled from the audit log

**Decision.** `return_cases.authorized_by_admin_user_id uuid null`, stamped in the same flush as
`authorizedAt` (R-7.3). Names are resolved at read time through `adminUserReadPort.findByIds`
(including removed users, as the port's lookup options allow); an id with no user is shown as
*former administrator* (FR-A42); `null` with `authorizedAt` set is *unknown*. The list column is
filled per page with one batched lookup and is **not sortable** (spec corrected).

**Backfill.** phase A's migration fills the column for cases authorized before the release from the
kernel-owned `audit_log_entries`: for each case with `authorized_at is not null and
authorized_by_admin_user_id is null`, the `actor_admin_user_id` of the most recent
`return.status_changed` entry on that case whose `state_after->>'statusCode' = 'authorized'` and
whose actor is non-null. Reading a kernel-owned table from a module migration is outside both R1 and
R2 of `check:module-boundary` (`specs/conventions/module-migrations.md` item 4a). It writes only
`return_cases`, which `returns` owns, and is idempotent (it only fills nulls).

**Rationale.** It is the only record that exists (F4); a migration runs once, in order, on every
installation, with no runtime cost after it.

**Rejected.**
- *Read-time fallback to the audit log*: one audit query per row on every list page, and a module
  reading the audit table on the hot path.
- *An install hook or a boot-time backfill*: an install hook does not re-run on an upgrade of an
  installed module, and a boot step runs every boot to fill a column once.
- *No backfill*: FR-A43 asks for it, and the data is there.
- *Storing the admin's name*: a removed or renamed admin would show a stale name; the id plus a
  lookup is what `alternativeConsentByAdminUserId` already does.

Audit entries pruned by a retention policy leave the column `null`, shown as *unknown* — FR-A43's
"otherwise".

## R-9 — The no-order complaint in the data model

**Decision.** The case keeps one table; a no-order complaint is a `return_cases` row with
`order_id null`. *Off-platform* is derived: `orderId === null` (R5); no flag column. A check
constraint enforces `order_id is not null or kind = 'complaint'` (R3). New nullable columns hold
the purchase data, the contact data and the ship-back address as submitted (`contact jsonb`,
`return_address jsonb`, `purchase_proof_number`, `purchase_date`). The case's `currency` is the
channel's `defaultCurrency` and every amount stays `0.00` (FR-B15). `organization_id` is the
request's organization from `ReturnCustomerContext` — never null on this path (Principle XI).

Lines: `return_case_items.order_item_id` and `product_id` become nullable; `product_name` holds the
catalog name at submission (FR-B14) or the free-text model; a new `serial_number`. A no-order line
has `default_refund_amount = approved_refund_amount = 0.00`.

**Rationale.** Every list, filter, status, comment, export and saved view already works on
`return_cases`; a second table would duplicate all of them. Deriving off-platform from the order
column is the owner's ruling (R5), and a derived fact cannot drift.

**Rejected.** *A separate `off_platform_complaints` table*: duplicates the workflow and the list.
*An `is_off_platform` column*: a second source of truth for R5. *Runtime custom fields for the
purchase data*: the platform's behaviour depends on these values (the proof rule, the settlement
restriction, the filter), which Principle XIV's "add a field" case does not cover. *A synthetic
"external" order in `orders`*: a write into another module's aggregate, and it would make the case
look like a platform order.

## R-10 — Which code paths must stop assuming an order

**Decision.** Every read of `rc.orderId` in `returns` is classified and given a no-order answer:

| Site | No-order answer |
| --- | --- |
| `createCase` | a separate branch (no order context, no lock key on the order, no `caseDefaults`/`caseCharges`) |
| `mapDetail` (`orderContext.getReturnContext(rc.orderId)`) | skipped; detail carries the off-platform block instead |
| `ReturnSettlementService` prefill, settle, recompute (`loadOrderCases`, `returnCaseOrderLockKey`) | a no-order branch: options `replacement`, `repair`, `settled_outside`; no order lock, no money ports reached |
| `ReturnTransitionService` event `orderId` | `null` in `ReturnStatusEvent` (type widened; F10: no outside reader) |
| `ReturnListService` search (`orderId: query.q`) | unchanged (a no-order case simply does not match an order id) |
| export (`orderId` column) | empty cell, plus a new `offPlatform` column |
| `return-eligibility.ts`, `consumer-withdrawal.ts`, `free-return-window.ts` | not reached: they apply to `return` kind or to order cases only |

The WP for phase B starts with a test per row of this table.

## R-11 — Principle XIII: what becomes a Command

**Decision.**

| Write | Today | In this feature |
| --- | --- | --- |
| File a case (both kinds) | hand-audited in the transaction | **phase B: Command `return_case.create`**, customer actor; the hand call is removed in the same change |
| Add an attachment to an open case | `command-coverage-ignore` | **phase B: Command `return_case.attachment.add`** (it now gates FR-B21 evidence and carries personal data) |
| Erase a customer's case data | — | **phase B: Command `return_case.erase_personal_data`** (system actor; names-only state) |
| Clause create / update / delete | — | **phase B: Commands `return_case_clause.create` / `.update` / `.delete`** |
| Settle as `settled_outside` | settlement is hand-audited co-transactionally (`recordWithin`) | extends the existing settlement write; same audit, `stateAfter.resolutionType` + `hasNote` |
| Status configuration (`notifyCustomerOnEntry`) | hand-audited in the transaction | extends the existing write |
| Transitions, incl. `authorizedByAdminUserId` | hand-audited after the flush, best-effort | extends the existing write; **not converted here** |
| Comments, pending uploads | `command-coverage-ignore` | unchanged / same reason |

**Rationale.** Principle XIII binds **new** sensitive writes to the bus and lets an un-migrated
module keep hand-written audit on existing writes while it migrates. `return_case.create` is
converted because phase B rewrites it anyway — the no-order path is a new sensitive write sharing the
same method. Transitions are not converted: the guard/event/side-effect chain of
`ReturnTransitionService.apply` is shared by settlement and shipments, and converting it is a
change of its own that this feature does not need.

**Recorded residual.** Transitions stay hand-audited after the flush (an audit row can be lost
on a crash between the two). This is pre-existing, allowed by the principle's incremental-migration
clause, and is listed in the plan's Constitution Check rather than silently carried.

**Rejected.** *Converting transitions in phase A*: widens A beyond its stories and touches every
settlement path. *Leaving creation hand-audited in phase B*: the principle forbids a new sensitive
write by hand.

## R-12 — Customer uploads: bytes in the object store under `returns/`, never an asset

**Decision.** `returns` stores attachment bytes itself through **`objectStoragePort`**
(`assets_library`, `packages/contracts/src/assets-library.ts`), under its own locator prefix
`returns/<organizationId>/<attachmentId>`, with `visibility: 'private'`, and creates **no** asset
row. It serves the bytes through its own guarded routes, streaming `open()`:

- `POST /api/v1/returns/uploads` — customer, multipart, one file and a `type` per request; answers
  an upload id. The row is a `return_case_attachments` row with `return_case_id null`,
  `customer_account_id`, `organization_id`, and `expires_at = now + 24 h`.
- `POST /api/v1/returns/:id/attachments` — customer, multipart, one file and a `type`, attached to
  an open case the caller filed. **Replaces** today's JSON `{ assetId }` body (F5).
- `POST /api/v1/returns` claims uploads by id: only the caller's own, unclaimed, unexpired uploads
  (FR-B24); anything else is refused naming the id.
- `GET /api/v1/returns/:id/attachments/:attachmentId/file` — customer, under the case read's scope
  (`ReturnCaseScope`: the filer, or a member holding `returns.view_organization`).
- `GET /api/v1/admin/returns/:id/attachments/:attachmentId/file` — `returns:read`.

Responses: `Content-Disposition: attachment` (inline only for images on the admin route),
`X-Content-Type-Options: nosniff`, the sandbox CSP the asset route uses, `Cache-Control: private,
no-store`. Accepted types are decided by magic bytes, not the declared MIME: JPEG, PNG, WebP, PDF.
Limits: 10 MB per file (multipart `fileSize`), 10 files per case, 30 MB per submission (R-13).
The multipart parser is registered by `returns` in a child context of its own, as
`crm/src/backend/routes/routes.attachment-upload.ts` does.

Expired, unclaimed uploads are deleted (bytes, then row) by the maintenance job (R-15).

**Rationale.** `objectStoragePort` exists for exactly this: "a consumer of this port stores its own
bytes under its own locator prefix and creates no `Asset` row … they are not reachable through the
assets routes" — the `product_feeds` precedent. Customer evidence must not appear in the
operator's media library, count against its quotas, or be served by an id-addressed public route.
Serving through `returns` puts the case's audience rule (FR-B22) in front of every byte.
`assets_library` is `nonDeactivatable`, so the new `dependencies` edge costs no operator a control.

**Rejected.**
- *A customer upload endpoint in `assets_library`, with `visibility: 'private'`*: the asset would
  still be an operator media-library object; private assets are resolved for admin callers
  (`visibleToCaller`) and nothing there knows the case audience; it widens another module's
  public surface for one consumer.
- *Uploading inside the create request only*: an open case could not receive a later file
  (FR-B20), and a 30 MB create body would hold the case transaction's inputs in memory.
- *Upload after creation only*: FR-B21 is judged at submission, so the proof must exist first.
- *Keeping `assetId` linking with an ownership check*: there is no owner on an asset to check, and
  no client uses it (F5, F6).

**Existing `asset_id` rows.** The column becomes nullable and stays. Rows linked through the old
API (possible only through a direct API call) are not listed or served — recorded as an upgrade
note. This is a deliberate narrowing, not a loss: they were never readable (F6).

## R-13 — The storefront form posts to a route handler

**Decision.** The case form (both paths) posts `multipart/form-data` to a new storefront route
handler, `storefront/app/returns/submit/route.ts`, following `storefront/app/forms/submit/route.ts`:
it works without JavaScript, uploads each file to `POST /api/v1/returns/uploads` with the
customer's session, then calls `POST /api/v1/returns` with the upload ids and a submission key,
and answers 303 to the case page; a refusal 303s back to the form with the typed answers (never
the files) in a short-lived, path-scoped attempt cookie, and the uploads already accepted are kept
by id for the retry. With JavaScript the attachment field uploads each file as it is chosen
(same handler family, `POST /returns/uploads`) and shows progress. The handler refuses a body over
30 MB before reading it.

**The no-JavaScript submission over 30 MB (D-9).** The handler checks `Content-Length` before
reading the body, so nothing of the post can be kept. It answers **303 back to the form** with
`?error=too_large` and no attempt cookie (there is nothing it read to put in one). The form renders
this error summary at the top:

> **en** "Your files together were over 30 MB, so nothing was sent. Please fill in the form again
> and attach fewer or smaller files — you can add more files from the case page after submitting."
>
> **pl** "Załączone pliki miały razem ponad 30 MB, więc nic nie zostało wysłane. Wypełnij formularz
> ponownie i dołącz mniej lub mniejsze pliki — kolejne pliki dodasz na stronie zgłoszenia po jego
> wysłaniu."

The no-JS form states the total limit beside every file input ("up to 10 MB each, 30 MB in total"),
so the refusal is foreseeable. The JavaScript path never meets this case: it uploads file by file
and shows the running budget. Rejected for D-9: streaming the multipart body to keep the text parts
(the designer's option (a)) — it needs a streaming parser in the route handler for a case the hint
already prevents.

The case page gains an *Add attachment* form posting to `storefront/app/returns/[id]/attachments/route.ts`,
and an attachment link served by `storefront/app/returns/[id]/attachments/[attachmentId]/route.ts`,
which streams the backend response with the session.

**Rationale.** A server action has a body limit (1 MB by default) and raising it raises it for
every action in the storefront; a route handler bounds this one post. The `forms` handler is the
proven no-JavaScript pattern (Principle VII's SSR-first stance).

**Rejected.** *Server action with `serverActions.bodySizeLimit` raised*: global. *Browser direct
upload to the backend*: needs CORS and a customer bearer in the browser, which the storefront does
not expose. *Attachments only with JavaScript*: a customer without it could not meet FR-B21.

**Prefill (FR-B16)** is storefront-side: the account (`getMe`) and the organization's addresses
(`storefront/lib/api/organization.ts`, `customers.ts`), both already called on the account pages.
The backend stores what was submitted; it does not read `addresses`.

## R-14 — Clauses: a `returns`-owned table, per-language text, a revision per edit

**Decision.** `return_case_clauses` (platform-global configuration like `return_reasons`):
`text jsonb` (`{ en: '…', pl: '…' }`), `label jsonb` (short heading), `link_url jsonb null`
(`{ lang: https URL }`, optional per language), `applies_to` (`return` | `complaint` | `both`,
the `return_reasons.applies_to` shape), `mode` (`must_accept` | `inform_only`),
`sales_channel_id uuid null` (`null` = every channel), `weight`, `is_active`, `revision int`
(incremented on every edit of label, text, link, `applies_to` or `mode`). Every write is a Command
(R-11). Edited on a new admin page `/returns/clauses` built from `ModalDialog`,
`ContentLanguageTabs`, `Input`, `Textarea`, `SalesChannelPicker`, `Checkbox`, `ConfirmDialog`,
`ResponsiveTable` and `RowActionMenu` (D-10; design-review R-9), with a palette action.

**Which clauses a submission shows (D-1).** The active rows of the channel
(`sales_channel_id is null or = channel`) whose `applies_to` matches the kind, ordered by weight —
**minus every `must_accept` clause when the submission is a consumer's withdrawal**. The
classification is the one `createCase` already makes (`isConsumerWithdrawal`: a `return` by a
personal organization, from an order, while the withdrawal function is available). One function,
`clausesFor({ channel, kind, orderId, customer })`, answers both `form-config` (R-21) and the
acceptance check, so the form and the server cannot disagree. A clause never gates a consumer
withdrawal; an `inform_only` clause may still be shown on one.

A submission sends `acceptedClauses: [{ id, revision }]` for the `must_accept` clauses ticked and
`shownClauses: [{ id, revision }]` for every clause rendered. The server compares both with
`clausesFor(...)`: a missing, extra or stale `(id, revision)` is refused
`RETURN_CLAUSES_NOT_ACCEPTED` with detail `clauses_changed` or `clause_not_accepted`, so what is
stored is provably what was shown (edge case *clause configuration changed mid-submission*). The
case stores `accepted_clauses jsonb` — `[{ clauseId, revision, mode, language, label, text, linkUrl }]`
for every clause shown, in the submission language, falling back to the channel default language
when a translation is missing — and `clauses_accepted_at` (the submission time).

**Links (owner ruling).** A clause may link to a full terms page: the link is rendered after the
text, opens in a new tab, and is stored as the URL shown. The linked page's content is **not**
stored, so the "exactly as shown" guarantee covers the clause text and the link target, not the
page behind it — the operator who needs the full terms as evidence pastes them into the clause.
`link_url` accepts `https:` URLs only (≤ 2 000 characters).

**Rationale.** Per-language text with an operator UI is the shape `return_reasons.name` already
has; a revision makes "the text shown" checkable without sending the text back. The stored copy
follows `forms`' `entry.consents` (`FormConsentRecord`).

**Rejected.** *A settings `json` value per channel*: no per-language editor in the generic
Settings screen, and the channel value would replace rather than add to the global clauses.
*A CMS page as the clause itself*: the accepted text would not be stored, and an edit to the page
would rewrite history (FR-B32) — a link is allowed only beside the stored text. *Sending the clause
text back from the client*: the server must not trust it. *An origin scope (`any` | `off_platform`)*,
the designer's optional extra for D-1: not ruled, and `applies_to` covers the stated need.
*Markup or inline links inside the text*: the stored copy stays plain text.

## R-15 — Anonymisation, and the maintenance job

**Decision.** `returns` subscribes to `customer_account.anonymized.v1` (`ctx.subscribe`, stopped
with the module) and runs Command `return_case.erase_personal_data` for the account, in the system
scope with a reason: on every case **filed by** the account, `contact` and `return_address` are set
to `null` and a stamp `personal_data_erased_at` is written; every attachment of those cases, and
every pending upload of the account, has its bytes deleted from the store and its row deleted. The
audit entry records counts and field names, never values.

A repeatable **`returns-maintenance`** job (BullMQ, daily, the `forms-maintenance-worker.ts` model)
does two things: deletes expired unclaimed uploads, and reconciles anonymisations missed while
`returns` was off — cases whose filer is anonymised (`customerAccountReadPort.findByIds` →
`anonymizedAt`) and whose `personal_data_erased_at` is null.

Comment bodies and accepted clause texts are not erased: comments are an existing record outside
this feature, and a clause text is the shop's own words. Purchase number and date, serial numbers
and product names are not personal data and stay, so the case remains workable.

**Rationale.** It is `forms`' proven pair (event + state-based reconciliation, F9), and it covers
exactly the personal data this feature introduces (FR-B43).

**Rejected.** *Event only*: an anonymisation while `returns` is off would be lost. *Deleting the
cases*: they are commercial records an operator still has to settle. *Erasing on the
organization's anonymisation*: the filer is the data subject; a personal organization's account is
announced by the same event.

## R-16 — Settings and presence

**Decision.** Three new settings in `returns`' manifest, all sales-channel scopable:
`returns.new_case_recipients` (`string_list`, `[]`, phase A), `returns.off_platform_complaints_enabled`
(`boolean`, `false`, phase B), `returns.proof_of_purchase_required` (`boolean`, `false`, phase B). They
are read from the case's channel (or, at submission, from the request's resolved channel,
Principle XII) through the settings read the module already uses for `free_return_days`.

Presence (Principle XVII): everything new is behind `returns`' own gates — routes through
`ctx.routes`, both workers through `ctx.worker`, the anonymisation subscriber through
`ctx.subscribe`. The no-order toggle is checked **after** the module gate, so module-off still
answers as if never installed. `admin_notifications` is `degrades-without` (R-3). New
`dependencies`: `admin_users` (names, recipients; non-deactivatable in practice), `assets_library`
(phase B, `objectStoragePort`; `nonDeactivatable`), `catalog` (phase B, availability and names;
non-deactivatable).

**Rejected.** *Making the no-order toggle the activation of a sub-module*: a second module for one
path of one form fails Principle I's ownership test; it is a setting of the module that owns the form.

## R-17 — Catalog products on a no-order line

**Decision.** The storefront offers a product picker backed by the storefront's existing product
search, with a free-text *model* field beside it (and alone without JavaScript). The backend accepts
a `productId` only if `catalogProductAvailabilityPort.filterAvailable([id], { channel, audience })`
answers it for the request's channel and organization, and snapshots the name through
`effectiveTexts` in the submission language. An unavailable id is refused as unknown (one
not-found answer, no existence leak).

**Rejected.** *Free text only*: loses the link an operator uses to find the product. *Accepting any
product id*: discloses and records products not offered to that buyer (Principle XII).

## R-18 — Idempotent submission

**Decision.** The form carries a `submissionKey` (a UUID rendered into the form). `return_cases`
gains `submission_key uuid null` with a unique index on `(customer_account_id, submission_key)`;
a repeated key answers the case already created (200 with the same body) instead of a second case,
so a double click or a retried post produces one case and one set of e-mails (edge case).

**Rejected.** *Client-side button disabling only*: no protection without JavaScript or on retry.

## R-19 — Settlement of an off-platform case

**Decision.** `resolutionTypeSchema` gains `settled_outside`; `return_cases` gains
`resolution_note text null`. For a case with `orderId === null` the prefill answers
`resolutionOptions: ['replacement', 'repair', 'settled_outside']` and `defaultResolution: 'repair'`;
`settle` refuses `refund` and `credit` and any `createCorrectiveInvoice: true` with
`RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM`. `settled_outside` requires `resolutionNote` (1–2 000
characters) and is refused on an order case with the same code. It reaches no settlement port, and
completes like `repair` (status move, `resolvedAt`). Audited by the existing settlement audit with
`hasNote: true`, never the note text (D-288's rule for free text).

**When (D-5).** `settled_outside` is allowed on an off-platform case that is authorized
(`authorizedAt` set), not yet settled (`resolutionType` null) and not in a terminal status —
"from authorization until closed". Repair and replacement keep today's precondition (a transition
into `resolved` the graph permits, in practice from `received`). Because the shipped graph has no
`authorized → resolved` edge, the `settled_outside` settlement enters `resolved` through
`ReturnTransitionService.apply` with a **settlement-only option** (`viaOutsideSettlement: true`)
that skips the graph's edge check for that one target. The before-guards, events, audit and status
effects still run. The admin detail shows the settlement card for an off-platform case from
`authorized` onwards, offering only `settled_outside` until the case reaches a status from which
`resolved` is permitted.

**Rejected for D-5.** *Seeding an `authorized → resolved` edge*: it would let any case, order cases
included, be moved to *Resolved* by a plain transition with no settlement. *Requiring the operator
to add the edge*: the default install would not do what the ruling says. *Walking the case through
`received`*: the designer's objection — goods that never move.

**Rejected.** *Hiding refund in the UI only*: SC-007 says "through any surface". *Reusing `repair`
with a note*: misreports what happened.

## R-20 — The case reference (D-4, FR-A44)

**Decision.** A pure function `caseReference(rc)` in `rt/src/backend/domain/case-reference.ts`:
`rc.rmaNumber ?? '#' + rc.id.replace(/-/g, '').slice(0, 8).toUpperCase()`. It is computed on read
(DTO field `reference` on summary and detail) and passed to every e-mail as `caseReference`; the
admin list uses it as the row's link text and the admin `q` search also matches
`id::text ilike '<8 hex>%'` when `q` looks like `#XXXXXXXX`. The customer and admin page titles use
it when there is no RMA number. Nothing is stored.

**Rationale.** The first eight hex characters of a v4 UUID give 2³² values; a collision between two
cases a human compares is negligible, and the reference is a display aid, not a key — the link
carries the id.

**Rejected.** *Assigning the RMA number at submission*: out of scope by the spec's assumption.
*A stored sequence*: a migration and a counter for a display string. *`—` as link text*: fails WCAG
2.4.4.

## R-21 — What the form needs from the server (D-11, D-12, D-1)

**Decision.** `GET /api/v1/returns/form-config?kind=&orderId=` (customer) answers, for the
request's channel and language:
- `offPlatformComplaintsEnabled`, `proofOfPurchaseRequired`.
- `confirmationEmailEnabled` (D-11) — whether `return_submitted` is active.
- `today` (D-12) — the shop's date in `returns.time_zone`.
- `clauses` — `clausesFor(...)` of R-14 for that kind and order; without `kind`, the clauses of
  `complaint`, and without `orderId`, the no-order case.
- `attachmentLimits`.

**`confirmationEmailEnabled` needs a read `transactional_emails` does not publish.** The sender
only answers after a send (`deactivated`), and `TemplateEmailPort`/`EmailDefaultsRegistryPort`
expose no active state. The decision is a **new read-only port** in `transactional_emails`:
`transactionalEmailStatePort.isActive(code): Promise<boolean>`. The flag is per code, not per
channel: it is `TransactionalEmail.active`, the field the sender reads before answering
`deactivated` (`packages/modules/transactional_emails/src/backend/services/transactional-email.service.ts`).
It answers `false` for a deactivated e-mail and for a code with no definition. It fails closed like every
`providePort` seam; that can only happen while `returns` is off too, because `transactional_emails`
is a binding dependency of `returns`. It lives in
`packages/contracts/src/transactional-emails.ts` and is registered with `ctx.di.providePort`.
`returns` already declares `transactional_emails` in `dependencies`. It does not report transport
availability: a promise on a deployment with no mail server is a configuration fault the e-mail log
already reports.

**Rejected.** *Words the page cannot keep* (always promising the e-mail): contradicts D-11.
*Reading the `transactional_emails` table from `returns`*: another module's internals
(Principle I). *Never mentioning the e-mail*: loses the reassurance US2 asks for.

## R-22 — The "no recipient" alert (D-7)

**Decision.** `GET /api/v1/admin/returns/notification-health` (`returns:read`) answers
`{ recipientsMissing: { global: boolean, salesChannelIds: uuid[] } }` — the channels whose
effective `returns.new_case_recipients` (channel value, else global) holds no valid address. The
statuses page (`ReturnStatusesConfigPage`) shows one `Alert variant="warning"` at the top when
either is set: "New-case e-mails go to nobody: no recipient is configured for {channel names | any
channel}.", with a link to `/settings?group=returns`.

**Rejected.** *The page reading the settings admin API*: an operator holding `returns:read` may not
hold the settings permission, and the effective-value rule (channel replaces global, R-4) is the
module's to apply. *A warning on the generic settings screen*: it renders none (D-7).

## R-23 — List rows the customer can recognise (D-3, D-8)

**Decision.**
- **Summary.** It gains `reference` (R-20), `productLabel` (the first line's `product_name`),
  `lineCount` and `purchaseDate` (null on order cases). The consumer composes "+N more" from
  `lineCount` in its own language (`module-i18n.md`: the reader translates). The list service reads
  the first line per case in one query for the page (`distinct on (return_case_id)` ordered by the
  line's id).
- **Detail.** It gains `personalDataErasedAt` (date) in place of the boolean of the first draft, so
  the admin can say "erased on {date}" and tell an empty list after erasure from "none sent".

**Rejected.** *A localized `productLabel` with "+N more" built in the backend*: the reader's language
is the consumer's to apply.
