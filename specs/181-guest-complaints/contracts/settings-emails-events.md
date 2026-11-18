# Contract: settings, e-mails, events, ports, error codes, queues (`returns`)

**Feature**: `specs/181-guest-complaints/`

## 1. Settings (`packages/modules/returns/src/manifest.ts`, `RETURNS_SETTING_CODES`)

| Code | `valueType` | Default | Scope | Notes |
| --- | --- | --- | --- | --- |
| `returns.guest_complaints_enabled` | `boolean` | `false` | global + sales channel | The description says it requires *Complaints without a platform order*. The effective state is the conjunction of the two (research R-12). |
| `returns.guest_data_retention_days` | `number` | `90` | global (read without a channel) | Clamped to 30–3 650 when read (research R-9). The description states the range. |

There are no secrets. Names and descriptions are in English in the manifest, with Polish in
`i18n/pl.json` under the module's existing settings keys.

## 2. Transactional e-mails (`manifest.transactionalEmails`)

All are in group `returns`, with defaults in `en-US` and `pl-PL` in
`src/backend/email-templates/transactional-defaults.ts` (`simpleEmailBodyTree`). They are sent in the
sales channel's language. Every guest e-mail carries `trackingUrl` (FR-044), and no default promises
a processing time.

| Code | Variables | `nonDeactivatable` | `messageId` |
| --- | --- | --- | --- |
| `return_guest_verification` | `verifyUrl`, `linkValidMinutes`, `hasAccount` (`'yes'`/`''`), `signInUrl` | `{ reason: 'The only way a guest can start a complaint.' }` | `return_guest_verification:<verificationId>` |
| `return_guest_submitted` | `caseReference`, `productList`, `submittedAt`, `trackingUrl` | `{ reason: 'The guest\'s only lasting way back to the case.' }` | `return_guest_submitted:<caseId>` |
| `return_guest_comment_added` | `caseReference`, `commentBody`, `trackingUrl` | — | `return_guest_comment:<commentId>` |
| `return_guest_status_entered` | `caseReference`, `statusName`, `trackingUrl` | — | `return_guest_status:<eventId>` |
| `return_guest_authorized` | `caseReference`, `rmaNumber`, `trackingUrl` (+ the authorized e-mail's instruction variables) | — | `return_guest_authorized:<caseId>:<rmaNumber>` |
| `return_guest_rejected` | `caseReference`, `rejectionReason`, `trackingUrl` | — | `return_guest_rejected:<caseId>` |
| `return_guest_link_reissued` | `caseReference`, `trackingUrl` | — | `return_guest_link:<caseId>:<trackingVersion>` |

**The shop's `return_new_case` is unchanged in shape.** For a guest case, `customerName` = *"{name}
(guest)"* (translated) and `organizationName` = `''` (FR-050).

The choice between an account template and its guest twin is one function, `customerMessageFor`
(research R-7). After erasure it answers nothing (FR-072).

## 3. Events

- `return_case.created.v1` gains `guest: boolean`. `organizationId` widens to `uuid | null` (it is
  `null` exactly when `guest`). The constant and schema are in `packages/contracts/src/returns.ts`.
  `returns` is the only subscriber (180).
- `ReturnStatusEvent.customerAccountId` is already optional and is absent for a guest case.

## 4. Error codes (`manifest.errorCodes`; sentences `errors.<CODE>` in `i18n/{en,pl}.json`)

| Code | Status | `details` |
| --- | --- | --- |
| `RETURN_GUEST_COMPLAINTS_DISABLED` | 403 | — |
| `RETURN_GUEST_SESSION_REQUIRED` | 401 | — |
| `RETURN_GUEST_LINK_INVALID` | 410 | — |
| `RETURN_TRACKING_LINK_INVALID` | 404 | — |
| `RETURN_GUEST_LIMIT_REACHED` | 429 | `{ limit: 'cases_per_session' \| 'cases_per_address' \| 'comments_per_case' }` |
| `RETURN_GUEST_DATA_ERASED` | 409 | — |

A write on a terminal case reuses the answers for a finished case (issue #625): `409 RETURN_COMMENTS_CLOSED` for a comment, `409 RETURN_CASE_CLOSED` for a file. No new code.

## 5. Commands (Principle XIII, research R-6)

| Action | Object | Actor (as recorded) | `stateAfter`: names and counts only |
| --- | --- | --- | --- |
| `return_case.create` (reused) | `return_case` | `system` (anonymous) | 180's + `by: 'guest'`, `guestSessionId` |
| `return_case.comment.add_by_guest` (new) | `return_case` | `system` (anonymous) | `commentId`, `length`, `by: 'guest'` |
| `return_case.attachment.add` (reused) | `return_case` | `system` (anonymous) | `attachmentId`, `type`, `by: 'guest'` |
| `return_case.tracking_link.reissue` (new) | `return_case` | admin | `trackingVersion` |
| `return_case.guest_data.erase` (new) | `return_case` | admin (`request`) / system (`retention`) | `trigger`, `attachmentCount`, `fields: ['contact','returnAddress']` |

The verification request, the session redeem and pending uploads are `command-coverage-ignore`, each
with its reason.

## 6. Ports

**Consumed (all edges already declared):**

| Port | Owner | Use |
| --- | --- | --- |
| `adminTenantScopePort` | `organizations` (`nonDeactivatable`, existing dependency) | bell audience for guest cases (`allowAll` only) |
| `customerAccountReadPort` | `customer_accounts` | `hasAccount` in the verification e-mail only |
| `TransactionalEmailSender` | `transactional_emails` | the seven templates |
| `objectStoragePort` | `assets_library` | guest file bytes under `returns/guest/` |
| `catalogProductAvailabilityPort` | `catalog` | the anonymous audience's availability |

**Platform registration (not a port):** `cursorSeal`, resolved from the container and typed locally
(research R-5). This needs the ruling in plan § *Rulings*.

No port is published or added to another module.

## 7. Queues and workers (Principle X)

| Queue | New job | Trigger |
| --- | --- | --- |
| `returns-notifications` | `guest_verification { verificationId }` | verification request (after the row commits) |
| `returns-notifications` | `guest_link_reissued { caseId, trackingVersion }` | Command `return_case.tracking_link.reissue` |
| `returns-notifications` | existing `case_submitted`, `comment_notify`, `status_entered` | route to guest twins through `customerMessageFor` |
| `returns-maintenance` | existing daily `sweep`, extended | guest-data retention erasure, then the 7-day verification purge |

## 8. Admin surfaces

- **New permission** `returns:erase_personal_data` (admin-api §A5).
- **No new palette action and no new route in `src/admin/index.ts`.**
