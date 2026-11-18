# Tasks: Complaints from guests without a customer account

**Input**: [spec.md](./spec.md) (G1–G11, Clarifications 2026-11-16), [plan.md](./plan.md) (WP G-1 … G-9,
owner rulings 1–3), [research.md](./research.md) (F1 … F18, R-1 … R-14), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Where.** In the current working tree, on top of 180's uncommitted work (`feat/180-off-platform-complaints`),
with no new branch (owner ruling 2). Never `git stash`. Commits are made at the end, when the tree is
split into the 180 MR and the stacked 181 MR against `.git/f180-snapshot-2026-11-16`. No task here
commits. `update-agent-context.sh` stays deferred to commit time.

**Tests are mandatory** (Constitution III, NN). In every WP the test task comes first and is run
**red** before its implementation task turns it green. Contract and integration files do not run on
merge requests (D-198). Run them locally:

```bash
pnpm run dev:infra:test   # once
export TEST_DATABASE_URL=postgres://b2b:b2b@localhost:5441/b2b_test REDIS_URL=redis://localhost:26379
pnpm --filter backend exec vitest run <paths>
```

## Hand-off batches

Each batch is one implementer run. Each ends on its phase's verification task, green.

| Batch | Phases | Task ids | Ends green at |
| --- | --- | --- | --- |
| **1** | Setup, G-1 contracts, G-2 schema + nullable account (**gate**), G-3 guest identity | T001 – T024 | T024 |
| **2** | G-4 guest filing + notifications, G-5 tracking link | T025 – T044 | T044 |
| **3** | G-6 admin + Principle XI matrix, G-7 erasure | T045 – T060 | T060 |
| **4** | G-8 storefront (opens with the designer review) | T061 – T075 | T075 |
| **5** | G-9 manifest wrap-up, docs, changesets, off-state, final verification | T076 – T087 | T087 |

## Format

`- [ ] T### [P?] [USn?] Description — paths`

- **[P]**: may run in parallel with the other [P] tasks **of the same WP**. Their files are disjoint
  and they depend on no unfinished task of that WP.
- **[USn]**: the spec's user story (US1 file, US2 track, US3 admin, US4 erasure, US5 settings).
- Abbreviations:
  - `rt` = `packages/modules/returns`;
  - `ct` = `packages/contracts/src`;
  - `it` = `backend/test/integration/returns`;
  - `ctt` = `backend/test/contract/returns`;
  - `adm` = `admin/test/modules/returns`;
  - `sf` = `storefront`;
  - `sft` = `storefront/test/returns-guest`.

---

## Setup (batch 1)

- [x] T001 Baseline:
  - run `pnpm run build:packages`;
  - run `pnpm --filter @endora-commerce/mod-returns run test` and
    `pnpm --filter backend exec vitest run backend/test/integration/returns` (with the exported test
    env), so 180's state is known green before 181 touches it;
  - run quickstart § *Preflight* SQL on the dev database and note the count in the batch report.

  Paths: repository root.

---

## G-1 — Contracts (batch 1)

- [x] T002 [P] Test (red): guest schemas in `ct/returns.test.ts`:
  - G2 `guestVerificationRequestSchema` (strict; `hp` optional);
  - G3/G5/G7/G8 shapes;
  - `createGuestComplaintRequestSchema` refuses `customerAccountId`, `organizationId`, `orderId`,
    `contact.email` and `kind: 'return'`;
  - `adminReturnsListQuerySchema.origin` accepts the four values;
  - `customerAccountId` is nullable on summary and detail;
  - `guest`, `contactVerifiedAt`, `trackingLinkValidUntil`, `guestDataErasureDueAt` on the detail;
  - `authorKind` includes `guest` and `uploadedByGuest` is present;
  - `return_case.created.v1` carries `guest` and a nullable `organizationId`.

  Paths: `ct/returns.test.ts`.
- [x] T003 [P] Test (red): new error codes are present and unique. Paths: `packages/contracts/test/errors.unit.test.ts` (or the existing errors test beside `ct/errors.ts`).
- [x] T004 Impl: contracts/guest-api.md G1–G10 and admin-api.md A1–A3/A5 schemas, plus the event change. Paths: `ct/returns.ts`.
- [x] T005 [P] Impl: `RETURN_GUEST_COMPLAINTS_DISABLED`, `RETURN_GUEST_SESSION_REQUIRED`, `RETURN_GUEST_LINK_INVALID`, `RETURN_TRACKING_LINK_INVALID`, `RETURN_GUEST_LIMIT_REACHED`, `RETURN_GUEST_DATA_ERASED`. Paths: `ct/errors.ts`.
  *Batch 1 note:* only the three codes G-3 raises landed (with their manifest declaration,
  `errors.<CODE>` sentences and minting-ledger entries). `check:error-translations` P7 refuses a
  declared code nothing raises, and its `UNRAISED_ERROR_CODES` ledger forbids additions, so
  `RETURN_TRACKING_LINK_INVALID` (T040), `RETURN_GUEST_LIMIT_REACHED` (T031/T040) and
  `RETURN_GUEST_DATA_ERASED` (T041) join `ct/errors.ts`, `rt/src/manifest.ts`, `rt/i18n/{en,pl}.json`,
  `backend/test/fixtures/error-code-routing/reference-ledgers.ts` and T003's list with their first raise.
- [x] T006 Verify G-1:
  - `pnpm --filter @endora-commerce/contracts run build`;
  - `pnpm --filter @endora-commerce/contracts run test`;
  - `pnpm --filter @endora-commerce/contracts run typecheck`;
  - `pnpm --filter @endora-commerce/contracts run lint`.

  Consumers may not compile yet (nullable `customerAccountId`); that is G-2's job. Paths: repository root.

---

## G-2 — Schema, entities, nullable account (batch 1) — **gate: green before any guest behaviour**

- [x] T007 Test (red): migration and constraints in `it/guest-migration.test.ts`:
  - an insert with `customer_account_id null` and an organization is refused (`return_cases_guest_no_org_check`);
  - a guest row missing `guest_session_id` or `tracking_version`, or with an order or kind `return`, is refused;
  - a customer row carrying `guest_session_id` is refused;
  - existing rows survive;
  - `return_case_comments_guest_author_check`, `return_case_attachments_owner_check` and the `return_guest_verifications` checks hold;
  - the partial unique on (`guest_session_id`, `submission_key`) holds;
  - `down` raises when a guest case exists.

  Paths: `it/guest-migration.test.ts`.
- [x] T008 [P] Test (red), two cases:
  - `closed_at` is set on entry into every `isTerminal` status (default *Closed*, *Rejected*,
    *Cancelled*) and not on a non-terminal one, in `it/closed-at.test.ts`;
  - unit: the graph refuses an edge out of a terminal status (FR-074 pin), in
    `rt/src/backend/domain/return-status-graph.test.ts` (extend or create).

  Paths: `it/closed-at.test.ts`, `rt/src/backend/domain/return-status-graph.test.ts`.
- [x] T009 Impl: migration. Scaffold with `pnpm --filter backend run migration:new -- --module returns --name returns_guest_complaints`, write data-model §7's SQL, then run `pnpm --filter backend run composer:generate`. Paths: `rt/src/migrations/<ts>_returns_guest_complaints.ts`, `rt/src/migrations/index.ts`, `backend/src/db/migrations-registry.generated.ts`.
- [x] T010 Impl: entities:
  - `ReturnCase.customerAccountId: string | null`, plus `guestSessionId`, `contactVerifiedAt`, `trackingVersion`;
  - `ReturnCaseComment.authorGuest`;
  - `ReturnCaseAttachment.guestSessionId`, `uploadedByGuest`;
  - new `ReturnGuestVerification` (`@GlobalEntity`, data-model §4), registered where the module lists its entities;
  - the test helper's entity list.

  Paths: `rt/src/backend/entities/return-case.entity.ts`, `…/return-case-comment.entity.ts`, `…/return-case-attachment.entity.ts`, `…/return-guest-verification.entity.ts` (new), `rt/src/backend/index.ts`, `backend/test/helpers/package-entities.ts`.
- [x] T011 Impl: nullable-account ripple, compile-driven (`pnpm --filter @endora-commerce/mod-returns run typecheck` until clean):
  - `filedWithKey`, `cancelByCustomer` and the customer routes keep `{ customerAccountId: <string> }` predicates;
  - `mapDetail` and summary emit `guest: customerAccountId === null` plus the new nullable fields;
  - erasure-by-account unchanged;
  - the notifications' `customers.findById` is guarded for `null` (temporarily answering "no recipient" until G-4 routes guests);
  - the admin pages render a null customer without crashing.

  Paths: `rt/src/backend/services/{return-case-service,return-list-service,return-export-service,return-case-scope,return-comment-service,return-attachment-service,return-email-notifier,notification-context,return-delivery-method-service,return-transition-service,return-erasure-service}.ts`, `rt/src/backend/services/notifications/dispatch.ts`, `rt/src/backend/routes.customer.ts`, `rt/src/backend/routes.admin.ts`, `rt/src/admin/pages/{ReturnsList,ReturnDetail}.tsx`, `rt/src/admin/api/returns-client.ts`.
- [x] T012 Impl: write `closedAt` on entry into an `isTerminal` status, in the same flush as the status. Paths: `rt/src/backend/services/return-transition-service.ts`.
- [x] T013 Verify G-2 (**gate**):
  - `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint`;
  - `pnpm --filter backend run test:unit:fast`;
  - `pnpm --filter backend exec vitest run backend/test/unit/tenancy/classification-check.test.ts`;
  - `pnpm --filter @endora-commerce/mod-returns run test`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns backend/test/contract/returns` (test env exported): every 180 test is still green, plus T007 and T008;
  - `pnpm --filter admin exec vitest run test/modules/returns`;
  - `pnpm --filter storefront exec vitest run test/account`.

  Paths: repository root.

---

## G-3 — Guest identity: seal, verification, session (batch 1)

- [x] T014 Owner ruling 1: amend `cursor-seal.ts`'s header. The derived key now serves purpose-bound tokens for more than pagination, and the purpose (GCM additional data) separates them; name `returns.guest-tracking.v1` and `returns.guest-verify.v1` as the second consumer. Comment only. Record an empty changeset with `pnpm changeset --empty`, naming the file `.changeset/181-cursor-seal-second-purpose.md`. Paths: `packages/platform/src/composition/cursor-seal.ts`, `.changeset/181-cursor-seal-second-purpose.md`.
- [x] T015 [P] Test (red), unit tests for the link tokens:
  - a verify token never opens as a tracking token, and the reverse;
  - a tampered token answers `null`;
  - the tracking token is stable for one (`caseId`, `version`) and changes with the version.

  Paths: `rt/src/backend/services/guest/guest-tracking-link.test.ts`.
- [x] T016 [P] Test (red): the honeypot, as in forms' rule (whitespace is not a hit). Paths: `rt/src/backend/services/guest/honeypot.test.ts`.
- [x] T017 [P] [US1] Test (red), integration for verification (`it/guest-verification.test.ts`):
  - identical 202 body for an address with an account, without one, throttled (4th in an hour) and with the honeypot filled;
  - a row plus a `guest_verification` job only when not throttled and not a bot;
  - a new request supersedes earlier links;
  - the e-mail carries `hasAccount` only for an account's address;
  - redeem is one-time, expires after 60 min, refuses another channel, and gives the same 410 for unknown, altered, used and superseded tokens;
  - the session lives 24 h; `DELETE` ends it; an ended or expired session gives 401;
  - IP throttle gives 429 on the 6th request in 10 min;
  - setting off gives 403; availability G1 matches the two settings (US5).

  Paths: `it/guest-verification.test.ts`.
- [x] T018 [P] [US5] Test (red), integration `it/guest-availability.test.ts`:
  - off by default;
  - guest on but no-order off → disabled;
  - per channel;
  - setting changes audited (FR-001, FR-002, US5).

  Paths: `it/guest-availability.test.ts`.
- [x] T019 Impl: `guest-tracking-link.ts`, which seals and opens through a locally typed `cursorSeal` resolved from the container (never `@endora-commerce/platform/composition`), and `honeypot.ts`. Paths: `rt/src/backend/services/guest/guest-tracking-link.ts`, `rt/src/backend/services/guest/honeypot.ts`, `rt/src/backend/index.ts`.
- [x] T020 Impl: settings `returns.guest_complaints_enabled` (channel-scopable, default `false`) and `returns.guest_data_retention_days` (default `90`), plus an effective-state reader (no-order ∧ guest, request channel). Paths: `rt/src/manifest.ts`, `rt/src/backend/services/guest/guest-availability.ts` (new), `rt/i18n/{en,pl}.json`.
- [x] T021 Impl: `GuestVerificationService` (request with supersession and per-address throttles, research R-8; redeem; session lookup by hash; leave) and the `guest_verification` job in dispatch, using the template `return_guest_verification` (`nonDeactivatable`, `en-US` + `pl-PL` defaults). Paths: `rt/src/backend/services/guest/guest-verification-service.ts` (new), `rt/src/backend/services/notifications/dispatch.ts`, `rt/src/backend/email-templates/transactional-defaults.ts`, `rt/src/manifest.ts`.
- [x] T022 Impl: `routes.guest.ts` with G1–G4. Each route gets `config.rateLimit` (research R-8), checks run in the order module → setting → session → body, and the session is read from the `b2b_returns_guest` cookie. Register it through `ctx.routes`. Paths: `rt/src/backend/routes.guest.ts` (new), `rt/src/backend/index.ts`.
- [x] T023 [P] Contract test: G1–G4 shapes and error envelopes. Paths: `ctt/guest-identity.contract.test.ts`.
- [x] T024 Verify batch 1:
  - `pnpm run build:packages && pnpm --filter @endora-commerce/mod-returns run typecheck && pnpm --filter @endora-commerce/mod-returns run lint && pnpm --filter backend run typecheck`;
  - `pnpm --filter @endora-commerce/mod-returns run test`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns/guest-verification.test.ts backend/test/integration/returns/guest-availability.test.ts backend/test/integration/returns/guest-migration.test.ts backend/test/contract/returns/guest-identity.contract.test.ts`;
  - `pnpm --filter backend run composer:generate` leaves no diff.

  Paths: repository root.

---

## G-4 — Guest filing and notifications (batch 2)

- [x] T025 [P] [US1] Test (red), `it/guest-submit.test.ts`:
  - the case has `customer_account_id` and `organization_id` null, the session's `guest_session_id`, `contact.email` = the verified address, `contactVerifiedAt` and `trackingVersion` 1;
  - 180's rules hold (proof required, clauses, purchase date, `unknown_product` judged for the anonymous audience);
  - a `submissionKey` replayed in the same session answers 200 with the same case, and in another session creates a new case;
  - the honeypot answers like a success and creates nothing;
  - 5 cases per session and 10 per address per 24 h give 429 `RETURN_GUEST_LIMIT_REACHED`;
  - a body naming an account, organization or order is refused;
  - a signed-in customer cookie alongside does not attribute the case;
  - `return_case.create` is audited once with `by: 'guest'`.

  Paths: `it/guest-submit.test.ts`.
- [x] T026 [P] [US1] Test (red), `it/guest-uploads.test.ts`:
  - an upload is owned by the session;
  - another session or a customer cannot claim it (`unknown_upload`);
  - a customer's upload cannot be claimed by a guest;
  - the storage locator is `returns/guest/<id>`;
  - a session holds at most 10 pending uploads.

  Paths: `it/guest-uploads.test.ts`.
- [x] T027 [P] [US1] Test (red), `it/guest-notifications.test.ts`:
  - `return_guest_submitted` goes to the verified address with `trackingUrl`, **even with `return_submitted` deactivated**;
  - the shop's `return_new_case` names "{name} (guest)" and no organization;
  - bell entries go only to `returns:read` holders whose admin scope is `allowAll`; none to a sales representative; a failing port means skip;
  - nothing is sent on verification alone.

  Paths: `it/guest-notifications.test.ts`.
- [x] T028 [P] Test (red), unit: `customerMessageFor` picks the guest twin and recipient for a guest case, answers nothing after erasure, and keeps 180's behaviour for accounts. Paths: `rt/src/backend/services/notifications/customer-message.test.ts`.
- [x] T029 Impl: `GuestCaseAccess` with `pendingUploadsOf(sessionId)`. Its `load(token)` and `attachmentOf` are added in G-5. Paths: `rt/src/backend/services/guest/guest-case-access.ts` (new).
- [x] T030 Impl: guest uploads (G6): session ownership, `uploadedByGuest`, `returns/guest/` prefix, claim through `GuestCaseAccess`. Paths: `rt/src/backend/services/return-attachment-service.ts`, `rt/src/backend/routes.guest.ts`.
- [x] T031 Impl: the guest filing branch in `createCase` (stamped nulls, verified contact, session-scoped idempotency, limits, event `guest: true`), with G5 form-config and G7 routes. Paths: `rt/src/backend/services/return-case-service.ts`, `rt/src/backend/routes.guest.ts`.
- [x] T032 Impl: `customerMessageFor`, plus the templates `return_guest_submitted` (`nonDeactivatable`), `return_guest_comment_added`, `return_guest_status_entered`, `return_guest_authorized`, `return_guest_rejected` and `return_guest_link_reissued`, with `en-US` + `pl-PL` defaults that each carry `trackingUrl`. Route `toCustomer` and the authorized/rejected notifier through it, and add the guest-name variant of `customerName`. Paths: `rt/src/backend/services/notifications/customer-message.ts` (new), `rt/src/backend/services/notifications/dispatch.ts`, `rt/src/backend/services/return-email-notifier.ts`, `rt/src/backend/email-templates/transactional-defaults.ts`, `rt/src/manifest.ts`, `rt/i18n/{en,pl}.json`.
- [x] T033 Impl: narrow the bell audience to `allowAll` admins for a guest case, through `adminTenantScopePort` (fail closed). Paths: `rt/src/backend/services/notifications/admin-bell.ts`, `rt/src/backend/index.ts`.
- [x] T034 [P] Contract test: G5–G7. Paths: `ctt/guest-filing.contract.test.ts`.
- [x] T035 Verify G-4:
  - `pnpm --filter @endora-commerce/mod-returns run typecheck && pnpm --filter @endora-commerce/mod-returns run lint && pnpm --filter @endora-commerce/mod-returns run test`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns/guest-submit.test.ts backend/test/integration/returns/guest-uploads.test.ts backend/test/integration/returns/guest-notifications.test.ts backend/test/integration/returns/notifications.test.ts backend/test/integration/returns/notifications-bell.test.ts backend/test/contract/returns/guest-filing.contract.test.ts`.

  Paths: repository root.

---

## G-5 — Tracking link (batch 2)

- [x] T036 [P] [US2] Test (red), `it/guest-tracking.test.ts`:
  - G8 view: customer-visible comments only, no `resolutionNote`, status label in the request language;
  - token A cannot read, comment on or download from case B;
  - expired (`closed_at` + 90 d), replaced (version + 1), erased, garbage and missing tokens all give the identical 404 `RETURN_TRACKING_LINK_INVALID`;
  - a closed case refuses a comment or file with 409 (`RETURN_COMMENTS_CLOSED` / `RETURN_CASE_CLOSED` since issue #625);
  - a comment is customer-visible with `author_guest` and audited through `return_case.comment.add_by_guest`;
  - a file is audited with `by: 'guest'` and `uploaded_by_guest`;
  - 20 comments per day per case is the limit;
  - the token is never in the request URL.

  Paths: `it/guest-tracking.test.ts`.
- [x] T037 [P] [US2] Test (red), `it/guest-emails.test.ts`:
  - a notified comment, entry into a notifying status, authorization and rejection each send the guest twin to the verified address with the **current** `trackingUrl`;
  - after a reissue the next e-mail carries the new link;
  - nothing is sent after erasure.

  Paths: `it/guest-emails.test.ts`.
- [x] T038 [P] [US3] Test (red), `it/guest-link-reissue.test.ts` (A3):
  - increments the version, the old link fails, and `return_guest_link_reissued` is sent;
  - refuses a customer case (`not_guest_case`) and an erased case (409);
  - is audited;
  - needs `returns:write`.

  Paths: `it/guest-link-reissue.test.ts`.
- [x] T039 Impl: `GuestCaseAccess.load(token)` (open the seal, `customerAccountId: null`, version, validity per research R-5) and `attachmentOf`; plus a unit test asserting that `routes.guest.ts` imports no entity class and reaches rows only through `GuestCaseAccess` (research R-1 static rule). Paths: `rt/src/backend/services/guest/guest-case-access.ts`, `rt/src/backend/services/guest/guest-case-access.test.ts`.
- [x] T040 Impl: tracking routes G8–G10 (header `X-Returns-Tracking-Token`, throttles, 180's download headers). The Command `return_case.comment.add_by_guest` lives in the comment service. Paths: `rt/src/backend/routes.guest.ts`, `rt/src/backend/services/return-comment-service.ts`, `rt/src/backend/services/return-attachment-service.ts`, `rt/src/backend/attachment-response.ts`.
- [x] T041 Impl: the reissue route A3, the Command `return_case.tracking_link.reissue` and the `guest_link_reissued` job. Paths: `rt/src/backend/routes.admin.ts`, `rt/src/backend/services/guest/guest-tracking-link.ts`, `rt/src/backend/services/notifications/dispatch.ts`.
- [x] T042 Impl: put `trackingUrl` (storefront base + `/returns/track/<token>`) into every guest job's variables, re-derived at send time. Paths: `rt/src/backend/services/notifications/dispatch.ts`, `rt/src/backend/services/return-email-notifier.ts`.
- [x] T043 [P] Contract test: G8–G10 and A3. Paths: `ctt/guest-tracking.contract.test.ts`.
- [x] T044 Verify batch 2:
  - `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint`;
  - `pnpm --filter @endora-commerce/mod-returns run test`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns backend/test/contract/returns` (all of `returns`, the 180 tests included);
  - `pnpm --filter backend run check:command-coverage && pnpm --filter backend run check:module-boundary && pnpm --filter backend run check:platform-surface && pnpm --filter backend run check:queue-names`.

  Paths: repository root.

  *Batch 2 note:* `RETURN_TRACKING_LINK_INVALID`, `RETURN_GUEST_LIMIT_REACHED` and
  `RETURN_GUEST_DATA_ERASED` joined `ct/errors.ts`, the manifest, `i18n/{en,pl}.json` and T003's
  list with their raise sites. Their `MINTED_ERROR_CODES` entries in
  `backend/test/fixtures/error-code-routing/reference-ledgers.ts` were **not** added (lead
  instruction on batch 2: no ledger entries), so `test/unit/kernel/error-code-routing-equality.test.ts`
  and `test/unit/_i18n/error-code-migration-progress.test.ts` are red on those three codes until a
  ruling lands. Everything T044 lists is green.

---

## G-6 — Admin and the Principle XI matrix (batch 3)

- [x] T045 [P] [US3] Test (red), `it/guest-admin-visibility.test.ts`, the **Principle XI matrix** from research R-1:
  - a sales representative and an allowed-set admin get 404 on a guest case for detail, comments, transition, settlement, shipments, attachments, file, reissue and erase;
  - the list, count, search (including by contact e-mail), export and saved views omit it;
  - an unrestricted admin sees all of it;
  - a signed-in customer whose e-mail matches neither lists nor reads it.

  Paths: `it/guest-admin-visibility.test.ts`.
- [x] T046 [P] [US3] Test (red), extend `it/list-and-bulk.test.ts`:
  - the `origin` values `platform`, `off_platform` (both kinds), `off_platform_customer` and `guest`;
  - a saved view keeps `guest`;
  - the export's `guest` column;
  - exact contact-e-mail search with no substring match.

  Paths: `it/list-and-bulk.test.ts`.
- [x] T047 [P] [US3] Test (red), `it/guest-settlement.test.ts`:
  - repair, replacement (including a `ReturnShipment` row of direction `replacement`) and `settled_outside` work on a guest case;
  - refund, credit and corrective invoice give `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM` (research R-11).

  Paths: `it/guest-settlement.test.ts`.
- [x] T048 [P] [US3] Test (red), admin component tests:
  - the list shows the guest badge and the origin options;
  - the detail shows the guest lines (verified, link valid until, erasure due), the two actions (erase only with `returns:erase_personal_data`, each with a `ConfirmDialog`) and the *Guest* comment label.

  Paths: `adm/ReturnsList.guest.test.tsx`, `adm/ReturnDetail.guest.test.tsx`.
- [x] T049 Impl: list and export (origin predicates, `guest` flag, guest customer label, e-mail search on the expression index). Paths: `rt/src/backend/services/return-list-service.ts`, `rt/src/backend/services/return-export-service.ts`, `rt/src/backend/services/return-list-view-service.ts`.
- [x] T050 Impl: the detail's guest fields (computed `trackingLinkValidUntil` and `guestDataErasureDueAt` with the clamped retention), `authorKind: 'guest'` and `uploadedByGuest`. Paths: `rt/src/backend/services/return-case-service.ts` (`mapDetail`), `rt/src/backend/services/return-comment-service.ts`.
- [x] T051 Impl: the permission `returns:erase_personal_data` (`requires: ['returns:read']`) with `adminRoles.permission.*` labels in English and Polish. Paths: `rt/src/manifest.ts`, `rt/i18n/{en,pl}.json`.
- [x] T052 Impl: the admin UI: origin `Select`, `Badge`, the guest card lines, the `RowActionMenu` items with `ConfirmDialog`, the comment label, the client calls for A3 and A5. Paths: `rt/src/admin/pages/ReturnsList.tsx`, `rt/src/admin/pages/ReturnDetail.tsx`, `rt/src/admin/api/returns-client.ts`, `rt/i18n/{en,pl}.json`.
- [x] T053 Verify G-6:
  - `pnpm --filter @endora-commerce/mod-returns run typecheck && pnpm --filter @endora-commerce/mod-returns run lint`;
  - `pnpm --filter admin exec vitest run test/modules/returns`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns/guest-admin-visibility.test.ts backend/test/integration/returns/list-and-bulk.test.ts backend/test/integration/returns/guest-settlement.test.ts backend/test/contract/admin_users/permission-inventory.test.ts`;
  - `pnpm --filter backend run i18n:hardcoded && pnpm --filter backend run check:action-route-permissions && pnpm --filter backend run check:admin-surface`.

  Paths: repository root.

---

## G-7 — Erasure and retention (batch 3)

- [x] T054 [P] [US4] Test (red), `it/guest-erasure.test.ts`:
  - the sweep erases a guest case once `closed_at` is older than the retention period: contact and address nulled, files' bytes and rows deleted, `personal_data_erased_at` set, comments, lines, purchase data, clauses and resolution kept, tracking link refused;
  - a case not yet due is untouched;
  - a retention of `10` is read as 30 and `9999` as 3 650;
  - the audit entry `return_case.guest_data.erase` (trigger `retention`) carries counts and field names only;
  - the sweep is idempotent;
  - verification rows older than 7 days are purged;
  - with `returns` off nothing runs; switched back on, the overdue erasure runs at the next sweep.

  Paths: `it/guest-erasure.test.ts`.
- [x] T055 [P] [US4] Test (red), `it/guest-erase-request.test.ts` (A5):
  - erases an open case at once and no further e-mail goes out;
  - idempotent;
  - refuses a customer case;
  - needs `returns:erase_personal_data`, and a scoped admin gets 404.

  Paths: `it/guest-erase-request.test.ts`.
- [x] T056 [P] [US4] Test (red), extend `it/erasure.test.ts`: anonymising a customer account leaves a guest case with the same e-mail untouched (FR-075). Paths: `it/erasure.test.ts`.
- [x] T057 Impl: the Command `return_case.guest_data.erase` (`trigger: 'retention' | 'request'`; deletes objects then rows) and the clamped retention reader. Paths: `rt/src/backend/services/guest/guest-erasure.ts` (new).
- [x] T058 Impl: the sweep steps (retention erasure in batches of 100 under `withSystemScope('returns: guest data retention')`, then the 7-day verification purge). Paths: `rt/src/backend/workers/returns-maintenance-worker.ts`.
- [x] T059 Impl: route A5. Paths: `rt/src/backend/routes.admin.ts`.
- [x] T060 Verify batch 3:
  - `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint`;
  - `pnpm --filter @endora-commerce/mod-returns run test`;
  - `pnpm --filter admin exec vitest run test/modules/returns`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns backend/test/contract/returns backend/test/contract/admin_users/permission-inventory.test.ts`;
  - `pnpm --filter backend run check:command-coverage && pnpm --filter backend run check:off-state-coverage && pnpm --filter backend run check:subscribe-seam`.

  Paths: repository root.

  *Batch 3 note:* T047 (`guest-settlement.test.ts`) and T056 (`erasure.test.ts` extension)
  were green on first run, as research R-11 and R-9 predict ("nothing to change"); they pin
  the behaviour. T054 was proved red for the right reason by running it with the two new
  sweep steps removed. The admin list's search box still sends `rmaNumber`, not `q`, so
  the contact e-mail search (A1) is reachable through the API only; and the export has no
  customer column for A1's "contact name until erasure" to fill. Both are listed for a
  ruling in the batch report. 180's `list-and-bulk.test.ts` export header and two
  `endsWith` assertions now include the appended `guest` column.

---

## G-8 — Storefront (batch 4)

- [x] T061 **Designer review** (`endora-commerce-designer`, before any page):
  - the entry choice, the e-mail field and the *sent* page;
  - the scanner-safe *Continue* page and the *link no longer works* page;
  - the guest form's locked verified e-mail and the signed-in note;
  - the success page with *Copy link*;
  - the tracking page (open and read-only) and the neutral invalid-link page.

  Write the findings into this feature directory as the review artefact; spec, plan and contract changes need an owner ruling. Paths: `specs/181-guest-complaints/design-review.md`.
- [x] T062 [P] [US1] Test (red), `sft/entry.test.tsx`:
  - a signed-out `/returns/new?origin=elsewhere` redirects to `/returns/guest?from=…` only while availability is enabled, and to `/login?next=…` otherwise (path and query kept);
  - the entry page offers *Sign in* (`next` = `from`) and *Continue without an account*.

  Paths: `sft/entry.test.tsx`.
- [x] T063 [P] [US1] Test (red), `sft/verification-routes.test.ts`:
  - the request handler always 303s to *sent*;
  - GET `/returns/guest/verify` does not redeem;
  - POST redeems and sets `b2b_returns_guest` (`HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age`);
  - a refused link with any live guest session continues to the form (owner ruling O-2);
  - an invalid link shows the *no longer works* page.

  Paths: `sft/verification-routes.test.ts`.
- [x] T064 [P] [US1] Test (red), `sft/guest-form.test.tsx` and `sft/guest-submit-route.test.ts`:
  - the e-mail is locked and nothing is prefilled;
  - the no-JS post works, with the attempt cookie on refusal;
  - uploads are forwarded with the cookie;
  - success goes to `/returns/guest/submitted/<ref>` with the tracking link and *Copy link*;
  - the 30 MB rule matches 180's.

  Paths: `sft/guest-form.test.tsx`, `sft/guest-submit-route.test.ts`.
- [x] T065 [P] [US2] Test (red), `sft/track-page.test.tsx` and `sft/track-routes.test.ts`:
  - the view renders; read-only when closed;
  - the neutral page for 404;
  - `Referrer-Policy: no-referrer`, `noindex`, and `rel="noreferrer"` on outbound links;
  - the token is forwarded as a header, never in the backend URL;
  - the comment, file and download proxies work.

  Paths: `sft/track-page.test.tsx`, `sft/track-routes.test.ts`.
- [x] T066 [P] Test (red), `sft/routing-and-off-state.test.tsx`:
  - `returns/guest` and `returns/track` win over `(account)/returns/[id]`;
  - every new page is not found while `returns` is off (`requireModulePresent`).

  Paths: `sft/routing-and-off-state.test.tsx`.
- [x] T067 Impl: the guest API client and cookie helpers (allow-listed `Cookie` forwarding, as `b2b_cart_anon`). Paths: `sf/lib/api/returns-guest.ts` (new), `sf/lib/session.ts`.
- [x] T068 Impl: layouts with `requireModulePresent('returns')`, the entry page, the request handler, the *sent* page. Paths: `sf/app/returns/guest/layout.tsx`, `sf/app/returns/guest/page.tsx`, `sf/app/returns/guest/request/route.ts`, `sf/app/returns/guest/sent/page.tsx`.
- [x] T069 Impl: the verify page and handler, and the leave handler. Paths: `sf/app/returns/guest/verify/page.tsx`, `sf/app/returns/guest/verify/continue/route.ts` (Next refuses a `route.ts` beside a `page.tsx`), `sf/app/returns/guest/leave/route.ts`.
- [x] T070 Impl: the guest form, reusing 180's leaves through a `guest` mode prop with no new primitive; then uploads, submit and the success page. Paths: `sf/app/returns/guest/new/page.tsx`, `sf/app/returns/guest/uploads/route.ts`, `sf/app/returns/guest/submit/route.ts`, `sf/app/returns/guest/submitted/[ref]/page.tsx`, `sf/components/returns/{OffPlatformForm,OffPlatformLines,AttachmentField,CopyField}.tsx` (`OffPlatformForm` extracted from `sf/app/(account)/returns/new/page.tsx`, design review F-10), `sf/lib/returns/{returnForm,guest}.ts`.
- [x] T071 Impl: the tracking page and its handlers. Paths: `sf/app/returns/track/layout.tsx`, `sf/app/returns/track/[token]/page.tsx`, `sf/app/returns/track/[token]/comments/route.ts`, `sf/app/returns/track/[token]/attachments/route.ts`, `sf/app/returns/track/[token]/files/[attachmentId]/route.ts`.
- [x] T072 Impl: the signed-out redirect in both account entry pages. Paths: `sf/app/(account)/returns/new/page.tsx`, `sf/app/(account)/returns/page.tsx`.
- [x] T073 Impl: copy under `returns.guest.*` in English and Polish. Paths: `sf/lib/i18n/messages/account.ts` (design review F-11).
- [x] T074 Apply the designer review's accepted findings from T061. Paths: as named in `design-review.md`.
- [x] T075 Verify batch 4:
  - `pnpm run build:packages && pnpm --filter storefront run typecheck && pnpm --filter storefront run lint`;
  - `pnpm --filter storefront exec vitest run test/returns-guest test/account`;
  - `pnpm --filter backend run check:rsc-discipline && pnpm --filter backend run check:storefront-indexability`;
  - `pnpm --filter storefront run build`.

  Paths: repository root.

  *Batch 4 note:* owner rulings O-1 (`rejectionReason` on G8), O-2 (any live guest session
  continues to the form) and O-3 (prefill only from this browser's pending cookie) are applied
  to the spec, contract G8, research R-3/R-13 and the code. The guest form needs complaint
  reasons, and `/api/v1/returns/reasons` requires a customer, so G5 gained an additive
  `reasons` field (contract, backend and tests) — listed for a ruling. Design review A-1
  (`RowActionMenu` focus, admin-kit changeset `181-admin-kit-row-action-menu-focus.md`), A-2
  (search sends `q`) and F-1 – F-22 are applied.

---

## G-9 — Wrap-up, docs, release, off state, final verification (batch 5)

- [x] T076 [P] Test (red), extend `it/off-state.test.ts`: with `returns` off, every G1–G10 route and A3/A5 is absent (the platform's `503 MODULE_DISABLED`; batch 5 note), no `guest_verification` job is enqueued, and the sweep does not run; switched back on, a tracking link from before works. Paths: `it/off-state.test.ts`.
- [x] T077 [P] Test (red), extend `it/audit.test.ts`: each guest Command is recorded once with `by: 'guest'`, and no audit state carries an e-mail, name, phone, address, comment body or token (FR-073, FR-091). Paths: `it/audit.test.ts`.
- [x] T078 Impl: anything T076 or T077 reveals. Then finalise the manifest (error codes with `errors.<CODE>` sentences in English and Polish, the 7 templates, settings descriptions stating the dependency and the 30–3 650 range). Run `pnpm --filter backend run composer:generate`, `pnpm --filter backend run manifests:generate` and `pnpm install --lockfile-only`; the last two produce no diff unless `mod-returns`' `package.json` changed. Paths: `rt/src/manifest.ts`, `rt/i18n/{en,pl}.json`, `backend/src/db/migrations-registry.generated.ts`, generated manifest index, `pnpm-lock.yaml`.
- [x] T079 Docs (English) in `rt/docs/returns.md`:
  - a new section, *Complaints from guests*, covering: verification and the scanner-safe link; the session; the tracking link (who can see it; it expires 90 days after closing; replacement; key rotation voids links); who sees guest cases (unrestricted admins only); retention and the *close settled cases* advice; module-off postponement; manual erasure and its permission; anonymisation does not match guest cases;
  - additions to *Notifications* (guest twins, two that cannot be switched off), *Attachments* (guest files), *In the audit log* and *Schema*.

  Paths: `rt/docs/returns.md`.
- [x] T080 Docs (Polish), per `docs/docs/contributing/documentation-i18n.md`. Then run `pnpm --filter backend run docs:translations:pin packages/modules/returns/docs/returns.md` and the generated module-reference page's pin, then `pnpm --filter backend run check:docs-translations && pnpm --filter backend run check:module-docs`. Paths: `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/returns.md`, `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/returns.md`, `docs/translation-cache/pl/*returns*`.
- [x] T081 Changeset for 181: `@endora-commerce/contracts` minor (guest schemas; `customerAccountId` nullable on summary and detail, which admin consumers must handle) and `@endora-commerce/mod-returns` minor (guest complaints, tracking link, retention, new permission, 7 templates). Then `pnpm --filter backend run check:release-intent`. The empty changeset of T014 stays separate. Paths: `.changeset/181-returns-guest-complaints.md`.
- [x] T082 Grep `backend/test/**`, `admin/**`, `storefront/**` and `packages/**` for every assumption that `customerAccountId` is a string on a case (fixtures, factories, snapshots), and fix the stragglers. Re-derive anything derived from changed locations (AGENTS.md trap 3). Paths: repository root.
- [x] T083 Check estate:
  - `pnpm run check:naming && pnpm run check:language`;
  - `pnpm --filter backend run i18n:hardcoded`;
  - `check:bundle-pairing`, `check:error-translations`, `check:command-coverage`, `check:module-boundary`, `check:platform-surface`, `check:port-dependencies`, `check:port-catches`, `check:off-state-coverage`, `check:queue-names`, `check:subscribe-seam`, `check:action-route-permissions`, `check:admin-surface`, `check:module-docs`, `check:docs-translations`, `check:release-intent`, `check:test-ownership`, `check:rsc-discipline`, `check:storefront-indexability`, `check:env-inputs`, each through `pnpm --filter backend run`.

  Fix every finding. If a read-size band refuses, re-record only per `specs/conventions/check-estate.md`. Paths: repository root.
- [x] T084 Freshness: `composer:generate` and `manifests:generate` leave no diff, and `pnpm install --frozen-lockfile` passes. Paths: repository root.
- [x] T085 Full targeted verification:
  - `pnpm run build:packages && pnpm -r run typecheck && pnpm -r run lint`;
  - `pnpm --filter backend run test:unit:fast`;
  - `pnpm --filter backend exec vitest run backend/test/integration/returns backend/test/contract/returns backend/test/contract/admin_users/permission-inventory.test.ts backend/test/unit/tenancy/classification-check.test.ts` (test env exported);
  - `pnpm --filter '!backend' run test`, which covers contracts, mod-returns, platform, admin and storefront.

  Paths: repository root.
- [ ] T086 Walk through quickstart.md §1–§8 on `pnpm run dev` with the mail catcher, and note any deviation in the batch report. Paths: repository root.
- [x] T087 Batch 5 report for the commit-time split: list every file 181 added or changed against `.git/f180-snapshot-2026-11-16`, so the 180 MR and the stacked 181 MR can be cut. Record that `update-agent-context.sh` runs at commit time. Paths: repository root (no git writes).

  *Batch 5 note.*
  - **T076, T077** were green on first run, as batch 3's T047/T056 were: guest routes ride
    `ctx.routes`, the maintenance worker and the notifications processor already gate on the
    module, and every guest Command already wrote names and counts only. They pin the behaviour.
    The off-state answer is the platform's `503 MODULE_DISABLED` envelope (the shared harness,
    `test/helpers/off-state.ts`), not the `404` T076 and `contracts/guest-api.md` read; the
    contract is corrected. The sweep's module-off postponement is asserted on both axes here, and
    on the operator axis in `guest-erasure.test.ts`.
  - **T078** needed no implementation: the manifest's error codes, sentences, 7 templates and
    setting descriptions were already final. `composer:generate` and `manifests:generate` leave
    no diff; 181 changes no `package.json`, so the lockfile change is 180's.
  - **T081** also wrote `.changeset/181-i18n-returns-search-keys.md` (`@endora-commerce/mod-i18n`
    patch): A-2 removed two shared keys from `_i18n`, a published package no other changeset
    named. The `contracts` / `mod-returns` changeset covers G5's `reasons` (accepted by the lead)
    and G8's `rejectionReason` (O-1).
  - **T082** found no straggler: every reader of a case's `customerAccountId` in `returns`, the
    admin and the storefront handles `null` (`filedByColleague` takes `string | null`). The
    storefront's customer-facing `ReturnCaseSummary.customerAccountId: string` stays: a customer
    route never answers a guest case (research R-1). 181 deletes and moves no file, so nothing
    derived from a location went stale.
  - **T084** ran `pnpm install --frozen-lockfile --lockfile-only` (exit 0, lockfile unchanged)
    rather than a full install, so as not to rewrite `node_modules` under a running dev stack.
  - **T085**: the full non-backend run had 5 `packages/cli` failures (`install-wizard-tty` ×4,
    `new-storefront` *blocks:generate*), the known local-only ones, and one admin test
    (`EmailsList.activation`) that failed under the parallel load and passes alone (3/3) and in a
    whole-admin rerun (583 files).
  - **T086 not done**: it needs `pnpm run dev` against the development database, outside this
    batch's test-database-only constraint. Needs a ruling, or a human walk-through.
  - `update-agent-context.sh` runs at commit time, on 181's own branch (plan § *Agent context*);
    `AGENTS.md` was not edited.

  **Commit-time inventory.** Derived against `.git/f180-snapshot-2026-11-16`: `tracked.patch`
  applied to `bf68d3a66` and `untracked.tar` extracted into a scratch directory, never over the
  working tree; `packages/modules/.claude/` and `.DS_Store` excluded. Of 285 changed
  paths, **121 are 180's alone** (byte-identical to the snapshot), **60 are 180 files that 181
  changed further** (the 180 MR takes the snapshot's content, the 181 MR the difference), and
  **104 are 181's alone** (new, or changed from `master` by 181 only). 181 deletes nothing.

  180 files changed further by 181 (60):

  - `admin/test/modules/returns/ReturnsList.saved-views.test.tsx`
  - `backend/src/db/migrations-registry.generated.ts`
  - `backend/test/fixtures/error-code-routing/reference-ledgers.ts`
  - `backend/test/helpers/package-entities.ts`
  - `backend/test/integration/returns/audit.test.ts`
  - `backend/test/integration/returns/list-and-bulk.test.ts`
  - `backend/test/integration/returns/off-state.test.ts`
  - `docs/docs/module-reference/returns.md`
  - `docs/i18n/pl/docusaurus-plugin-content-docs/current/module-reference/returns.md`
  - `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/returns.md`
  - `docs/translation-cache/pl/generated:module-reference--returns.json`
  - `docs/translation-cache/pl/packages--modules--returns--docs--returns.md.json`
  - `packages/contracts/src/errors.ts`
  - `packages/contracts/src/returns.test.ts`
  - `packages/contracts/src/returns.ts`
  - `packages/modules/returns/docs/returns.md`
  - `packages/modules/returns/i18n/en.json`
  - `packages/modules/returns/i18n/pl.json`
  - `packages/modules/returns/src/admin/api/returns-client.ts`
  - `packages/modules/returns/src/admin/pages/ReturnDetail.tsx`
  - `packages/modules/returns/src/admin/pages/ReturnsList.tsx`
  - `packages/modules/returns/src/backend/domain/return-status-graph.test.ts`
  - `packages/modules/returns/src/backend/email-templates/transactional-defaults.ts`
  - `packages/modules/returns/src/backend/entities/return-case-attachment.entity.ts`
  - `packages/modules/returns/src/backend/entities/return-case.entity.ts`
  - `packages/modules/returns/src/backend/index.ts`
  - `packages/modules/returns/src/backend/plugin.ts`
  - `packages/modules/returns/src/backend/routes.admin.ts`
  - `packages/modules/returns/src/backend/services/return-attachment-service.ts`
  - `packages/modules/returns/src/backend/services/return-case-service.ts`
  - `packages/modules/returns/src/backend/services/return-comment-service.ts`
  - `packages/modules/returns/src/backend/services/return-email-notifier.ts`
  - `packages/modules/returns/src/backend/services/return-export-service.ts`
  - `packages/modules/returns/src/backend/services/return-list-service.ts`
  - `packages/modules/returns/src/backend/services/return-transition-service.ts`
  - `packages/modules/returns/src/manifest.ts`
  - `packages/modules/returns/src/migrations/index.ts`
  - `storefront/app/(account)/returns/[id]/page.tsx`
  - `storefront/app/(account)/returns/new/page.tsx`
  - `storefront/app/(account)/returns/page.tsx`
  - `storefront/app/globals.css`
  - `storefront/lib/i18n/messages/account.ts`
  - `storefront/lib/returns/returnForm.ts`
  - `backend/test/integration/returns/attachments-tenancy.test.ts`
  - `backend/test/integration/returns/erasure.test.ts`
  - `backend/test/integration/returns/notification-jobs.ts`
  - `backend/test/integration/returns/off-platform-migration.test.ts`
  - `packages/modules/returns/src/backend/email-templates/transactional-defaults.test.ts`
  - `packages/modules/returns/src/backend/routes.uploads.ts`
  - `packages/modules/returns/src/backend/services/notifications/admin-bell.test.ts`
  - `packages/modules/returns/src/backend/services/notifications/admin-bell.ts`
  - `packages/modules/returns/src/backend/services/notifications/dispatch.test.ts`
  - `packages/modules/returns/src/backend/services/notifications/dispatch.ts`
  - `packages/modules/returns/src/backend/services/notifications/store.ts`
  - `packages/modules/returns/src/backend/services/return-erasure-service.ts`
  - `packages/modules/returns/src/backend/workers/returns-maintenance-worker.ts`
  - `packages/modules/returns/src/backend/workers/returns-notifications-worker.test.ts`
  - `packages/modules/returns/src/backend/workers/returns-notifications-worker.ts`
  - `storefront/components/returns/AttachmentField.tsx`
  - `storefront/components/returns/OffPlatformLines.tsx`

  181's alone (104):

  - `admin/test/components/RowActionMenu.test.tsx`
  - `packages/admin-kit/src/components/RowActionMenu.tsx`
  - `packages/modules/_i18n/i18n/en.json`
  - `packages/modules/_i18n/i18n/pl.json`
  - `packages/modules/returns/src/backend/entities/return-case-comment.entity.ts`
  - `packages/platform/src/composition/cursor-seal.ts`
  - `storefront/app/(account)/layout.tsx`
  - `storefront/app/(auth)/login/mfa/page.tsx`
  - `storefront/app/(auth)/login/page.tsx`
  - `storefront/app/(auth)/login/setup/page.tsx`
  - `storefront/app/layout.tsx`
  - `storefront/components/CartSubmitButton.tsx`
  - `storefront/components/analytics/PageViewTracker.tsx`
  - `storefront/lib/analytics/gtag.ts`
  - `storefront/lib/session.ts`
  - `storefront/middleware.ts`
  - `storefront/next.config.js`
  - `storefront/test/seo/middleware-effect.test.ts`
  - `storefront/test/url-errors/no-free-text-in-url.test.ts`
  - `.changeset/181-admin-kit-row-action-menu-focus.md`
  - `.changeset/181-cursor-seal-second-purpose.md`
  - `.changeset/181-i18n-returns-search-keys.md`
  - `.changeset/181-returns-guest-complaints.md`
  - `admin/test/modules/returns/ReturnDetail.guest.test.tsx`
  - `admin/test/modules/returns/ReturnsList.guest.test.tsx`
  - `backend/test/contract/returns/guest-filing.contract.test.ts`
  - `backend/test/contract/returns/guest-identity.contract.test.ts`
  - `backend/test/contract/returns/guest-tracking.contract.test.ts`
  - `backend/test/integration/returns/closed-at.test.ts`
  - `backend/test/integration/returns/guest-admin-visibility.test.ts`
  - `backend/test/integration/returns/guest-availability.test.ts`
  - `backend/test/integration/returns/guest-emails.test.ts`
  - `backend/test/integration/returns/guest-erase-request.test.ts`
  - `backend/test/integration/returns/guest-erasure.test.ts`
  - `backend/test/integration/returns/guest-fixtures.ts`
  - `backend/test/integration/returns/guest-link-reissue.test.ts`
  - `backend/test/integration/returns/guest-migration.test.ts`
  - `backend/test/integration/returns/guest-notifications.test.ts`
  - `backend/test/integration/returns/guest-settlement.test.ts`
  - `backend/test/integration/returns/guest-submit.test.ts`
  - `backend/test/integration/returns/guest-tracking.test.ts`
  - `backend/test/integration/returns/guest-uploads.test.ts`
  - `backend/test/integration/returns/guest-verification.test.ts`
  - `packages/contracts/test/errors.unit.test.ts`
  - `packages/modules/returns/src/backend/entities/return-guest-verification.entity.ts`
  - `packages/modules/returns/src/backend/routes.guest.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-availability.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-case-access.test.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-case-access.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-erasure.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-tracking-link.test.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-tracking-link.ts`
  - `packages/modules/returns/src/backend/services/guest/guest-verification-service.ts`
  - `packages/modules/returns/src/backend/services/guest/honeypot.test.ts`
  - `packages/modules/returns/src/backend/services/guest/honeypot.ts`
  - `packages/modules/returns/src/backend/services/notifications/customer-message.test.ts`
  - `packages/modules/returns/src/backend/services/notifications/customer-message.ts`
  - `packages/modules/returns/src/migrations/20261116T104415_returns_guest_complaints.ts`
  - `specs/181-guest-complaints/checklists/requirements.md`
  - `specs/181-guest-complaints/contracts/admin-api.md`
  - `specs/181-guest-complaints/contracts/guest-api.md`
  - `specs/181-guest-complaints/contracts/settings-emails-events.md`
  - `specs/181-guest-complaints/data-model.md`
  - `specs/181-guest-complaints/design-review.md`
  - `specs/181-guest-complaints/plan.md`
  - `specs/181-guest-complaints/quickstart.md`
  - `specs/181-guest-complaints/research.md`
  - `specs/181-guest-complaints/spec.md`
  - `specs/181-guest-complaints/tasks.md`
  - `storefront/app/returns/guest/layout.tsx`
  - `storefront/app/returns/guest/leave/route.ts`
  - `storefront/app/returns/guest/new/page.tsx`
  - `storefront/app/returns/guest/page.tsx`
  - `storefront/app/returns/guest/request/route.ts`
  - `storefront/app/returns/guest/sent/page.tsx`
  - `storefront/app/returns/guest/submit/route.ts`
  - `storefront/app/returns/guest/submitted/[ref]/page.tsx`
  - `storefront/app/returns/guest/verify/continue/route.ts`
  - `storefront/app/returns/guest/verify/page.tsx`
  - `storefront/app/returns/track/[token]/attachments/route.ts`
  - `storefront/app/returns/track/[token]/comments/route.ts`
  - `storefront/app/returns/track/[token]/files/[attachmentId]/route.ts`
  - `storefront/app/returns/track/[token]/not-found.tsx`
  - `storefront/app/returns/track/[token]/page.tsx`
  - `storefront/app/returns/track/layout.tsx`
  - `storefront/components/returns/CaseSections.tsx`
  - `storefront/components/returns/CopyField.tsx`
  - `storefront/components/returns/GuestLinkRequestForm.tsx`
  - `storefront/components/returns/GuestNotices.tsx`
  - `storefront/components/returns/OffPlatformForm.tsx`
  - `storefront/components/returns/ResendButton.tsx`
  - `storefront/lib/analytics/secret-paths.ts`
  - `storefront/lib/api/returns-guest.ts`
  - `storefront/lib/auth/next-path.ts`
  - `storefront/lib/returns/caseView.ts`
  - `storefront/lib/returns/guest.ts`
  - `storefront/test/returns-guest/entry.test.tsx`
  - `storefront/test/returns-guest/guest-form.test.tsx`
  - `storefront/test/returns-guest/guest-submit-route.test.ts`
  - `storefront/test/returns-guest/pending-and-copy.test.tsx`
  - `storefront/test/returns-guest/routing-and-off-state.test.tsx`
  - `storefront/test/returns-guest/track-page.test.tsx`
  - `storefront/test/returns-guest/track-routes.test.ts`
  - `storefront/test/returns-guest/verification-routes.test.ts`


---

## Dependencies

- Phases run in order: Setup → G-1 → G-2 (**gate**) → G-3 → G-4 → G-5 → G-6 → G-7 → G-8 → G-9.
- G-6 and G-7 depend on G-4 and G-5 (guest cases must exist). G-8 depends on every backend route (G-3 to G-7) and on T061.
- Within a WP, every *Impl* waits for that WP's red tests. [P] tests of one WP can be written together.

## Requirement → task map

| FR | Tasks |
| --- | --- |
| FR-001, FR-002 | T018, T020, T022 |
| FR-010, FR-011 | T062, T068, T072, T065 |
| FR-020 – FR-026 | T015 – T017, T019, T021, T022, T054 (purge), T058, T063, T069 |
| FR-030 – FR-036 | T025, T026, T030, T031, T064, T070 |
| FR-040 – FR-046 | T015, T036 – T042, T065, T071 |
| FR-050 – FR-052 | T027, T032, T033 |
| FR-060 – FR-064 | T045 – T052 |
| FR-070 – FR-075 | T008, T012, T054 – T059 |
| FR-080 | T066, T076 |
| FR-090 – FR-093 | T073, T077, T051, T079, T080 |
