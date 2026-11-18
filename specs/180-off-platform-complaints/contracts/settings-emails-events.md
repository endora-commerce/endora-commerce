# Contract: settings, e-mails, events, ports, error codes, queues (`returns`)

**Feature**: `specs/180-off-platform-complaints/`

## 1. Settings (`packages/modules/returns/src/manifest.ts`, `RETURNS_SETTING_CODES`)

| Code | `valueType` | Default | Scope | MR |
| --- | --- | --- | --- | --- |
| `returns.new_case_recipients` | `string_list` | `[]` | global + sales channel (channel replaces) | A |
| `returns.off_platform_complaints_enabled` | `boolean` | `false` | global + sales channel | B |
| `returns.proof_of_purchase_required` | `boolean` | `false` | global + sales channel | B |

Names and descriptions in the manifest (English) and in `i18n/{en,pl}.json` under the settings keys
the module already uses. No secret.

## 2. Transactional e-mails (`manifest.transactionalEmails`, feature 047)

| Code | Group | Variables (`key` — sample) | MR |
| --- | --- | --- | --- |
| `return_new_case` | `returns` | `caseReference`, `kindLabel`, `customerName`, `organizationName`, `productList`, `offPlatform` (`'yes'`/`''`), `submittedAt`, `adminCaseUrl` | A |
| `return_submitted` | `returns` | `caseReference`, `kindLabel`, `productList`, `submittedAt`, `caseUrl` | A |
| `return_comment_added` | `returns` | `caseReference`, `commentBody`, `caseUrl` | A |
| `return_status_entered` | `returns` | `caseReference`, `statusName`, `caseUrl` | A |

`caseReference` = the RMA number, else the derived `#XXXXXXXX` (FR-A44, research R-20). The
subjects of all four defaults name it. No default promises a processing time.

Defaults in `en-US` and `pl-PL` in `src/backend/email-templates/transactional-defaults.ts`
(`simpleEmailBodyTree`, as `RETURN_AUTHORIZED_DEFAULT`). `messageId`s:
`return_new_case:<caseId>:<recipientKey>`, `return_submitted:<caseId>`,
`return_comment:<commentId>`, `return_status:<eventId>` (research R-2). None is
`nonDeactivatable`.

## 3. Events

- `return_case.created.v1` — new, phase B; exported constant `RETURN_CASE_CREATED_EVENT` and
  `ReturnCaseCreatedEventV1Schema` in `packages/contracts/src/returns.ts`:
  `{ eventId, occurredAt, returnCaseId, organizationId, salesChannelId, kind, offPlatform }`, strict.
  Emitted by Command `return_case.create`, dispatched after commit.
- `ReturnStatusEvent.orderId` → `string | null` (phase B).
- `customer_account.anonymized.v1` — consumed (phase B), unchanged.

## 4. Error codes (`manifest.errorCodes`; sentences `errors.<CODE>` in `i18n/{en,pl}.json`)

| Code | Status | `details` | MR |
| --- | --- | --- | --- |
| `RETURN_OFF_PLATFORM_DISABLED` | 403 | — | B |
| `RETURN_PROOF_OF_PURCHASE_REQUIRED` | 422 | — | B |
| `RETURN_CLAUSES_NOT_ACCEPTED` | 422 | `{ reason, clauseIds }` | B |
| `RETURN_ATTACHMENT_REJECTED` | 413 / 422 | `{ reason, maxMb?, uploadId? }` | B |
| `RETURN_RESOLUTION_UNAVAILABLE_OFF_PLATFORM` | 422 | `{ resolution }` | B |

phase A adds no error code: its refusals are `VALIDATION_FAILED` with detail codes
`notify_requires_customer_visible` and `dedicated_email_status`.

## 5. Commands (Principle XIII, research R-11)

| Action | Object type | Actor | `stateAfter` (names-only for free text) | MR |
| --- | --- | --- | --- | --- |
| `return_case.create` | `return_case` | customer | `kind, orderId, offPlatform, statusCode, lineCount, attachmentCount, clauseCount, consumerWithdrawal` | B |
| `return_case.attachment.add` | `return_case` | customer | `attachmentId, type` | B |
| `return_case.erase_personal_data` | `return_case` (one entry per account run, object = account) | system | `caseCount, attachmentCount, fields: ['contact','returnAddress']` | B |
| `return_case_clause.create` / `.update` / `.delete` | `return_case_clause` | admin | `salesChannelId, appliesTo, mode, hasLink, weight, isActive, revision, languages` (never the text or URL) | B |

`return_case.create` replaces the hand-written `recordAuditFromContext` call in
`ReturnCaseService.createCase` in the same change.

## 6. Ports

**Published (new, D-11, research R-21)** — in `transactional_emails`, not `returns`:

```ts
// packages/contracts/src/transactional-emails.ts
/** Container name: `transactionalEmailStatePort`. Owner: `transactional_emails`. */
export interface TransactionalEmailStatePort {
  /** `TransactionalEmail.active` for the code; `false` for an unknown code. */
  isActive(code: string): Promise<boolean>;
}
```

Registered with `ctx.di.providePort` in `packages/modules/transactional_emails/src/backend/index.ts`;
`mod-transactional-emails` and `@endora-commerce/contracts` take a minor bump for it.

**Consumed:**

| Port | Owner | Use | Edge | Phase |
| --- | --- | --- | --- | --- |
| `TransactionalEmailSender` | `transactional_emails` | four new e-mails | existing `dependencies` | A |
| `transactionalEmailStatePort` | `transactional_emails` | `confirmationEmailEnabled` in `form-config` | existing `dependencies` | B |
| `customerAccountReadPort` | `customer_accounts` | recipient address; anonymised check | existing | A |
| `adminNotificationRecordPort` | `admin_notifications` | bell entries | **new** `nonBindingDependencies` `degrades-without` | A |
| `adminUserReadPort` | `admin_users` | authorizer names; bell recipients | **new** `dependencies` | A |
| `permissionService` | `auth` | bell recipients holding `returns:read` | existing (`auth`) | A |
| `objectStoragePort` | `assets_library` | attachment bytes | **new** `dependencies` (`nonDeactivatable`) | B |
| `catalogProductAvailabilityPort` | `catalog` | product availability and name snapshot | **new** `dependencies` (non-deactivatable) | B |

`nonBindingDependencies` entry for `admin_notifications`:
`whenAbsent: 'no bell entry is recorded for a new return or complaint; the case, the shop e-mail and
the customer e-mails are unaffected'`.

## 7. Queues and workers (Principle X)

| Queue | Job(s) | Trigger | Attempts | MR |
| --- | --- | --- | --- | --- |
| `returns-notifications` | `case_submitted`, `comment_notify`, `status_entered` | enqueue after commit | 5, exponential from 10 s | A |
| `returns-maintenance` | `sweep` (repeatable, daily) | scheduler | 3 | B |

Both through `ctx.worker`, built only where the host consumes queues and offers a connection
(`moduleQueueRedis`, `processRunsWorkers`), as `forms`.

## 8. Admin surfaces (`specs/conventions/module-admin-surfaces.md`)

- No new permission code.
- New palette action (phase B): `{ id: 'return-clauses', labelKey: 'actions.returnClauses.label',
  descriptionKey: 'actions.returnClauses.description', icon: 'FileCheck', targetRoute:
  '/returns/clauses', requiredPermission: 'returns:read', keywordsKey:
  'actions.returnClauses.keywords', weight: 236 }` — read-gated like `return-statuses` (issue #232's
  reasoning).
- New admin route `/returns/clauses` registered in `src/admin/index.ts` beside
  `ReturnReasonsPage`.
