# Contract: join requests — Commands, port, hooks, events, errors, notices (#1832)

Owner: `organizations`. Zod schemas and types in `packages/contracts/src/organization-join-requests.ts`
(new); hookable refs appended to `packages/contracts/src/organization-hooks.ts`. Data:
`data-model.md` §1. Research R-8 – R-19.

## 1. Commands

All run through `CommandBus.run`, object type `organization_join_request`, object id = the request
id, one audit entry each (names and codes only, R-22). None is reversible.

| Action | Hookable | Run | Event on commit |
| --- | --- | --- | --- |
| `organization.join_request.create` | `beforeCommit`, `afterCommit` | R-10: re-resolve the target, count + lock, provision the personal Organization (registration origin only), child `customer_account.create`, write the request and the confirmation token | `organization.join_request.created.v1` |
| `organization.join_request.submit` | `afterCommit` | lock; `awaiting_email_confirmation` → `pending`; capture routing (R-12) | — |
| `organization.join_request.approve` | `beforeCommit`, `afterCommit` | lock; checks of data-model §1 *Validation*; child `membershipPort.changeCommand({ …, source: 'join_request' })`; → `approved` | `organization.join_request.decided.v1` (`outcome: 'approved'`) |
| `organization.join_request.reject` | `afterCommit` | lock; `pending` → `rejected`, optional reason | `…decided.v1` (`rejected`) |
| `organization.join_request.withdraw` | `afterCommit` | lock; open → `withdrawn` | `…decided.v1` (`withdrawn`) |
| `organization.join_request.expire` | `afterCommit` | lock; open and `expires_at <= now` → `expired` | `…decided.v1` (`expired`) |
| `organization.join_request.erase_texts` | no | null `note`, `requested_name`, `rejection_reason` of one account's requests; `skipAudit` when nothing was set | — |

`create` from **registration** also creates the account and the personal Organization, each its
own child entry (`customer_account.create`; the personal Organization is a system invariant written
by its provisioner, as in `createStandalone`). `create` from the **port** takes an existing account,
which must be live, unblocked and in its own personal Organization (`409
ORGANIZATION_JOIN_REQUEST_NOT_APPROVABLE`, `account_moved`); when its e-mail is already confirmed
the request is created `pending` and `submit`'s routing runs inside `create`.

### Hook data and outbox (`organization-hooks.ts`)

```ts
export interface OrganizationJoinRequestHookData {
  requestId: string;
  organizationId: string;          // the target
  customerAccountId: string;
  state: OrganizationJoinRequestState;
  origin: 'registration' | 'port';
  routing: 'organization_administrators' | 'operator' | null;
  operatorReason: 'setting' | 'no_active_administrator' | 'target_not_active' | null;
  salesChannelId: string | null;
  grantedOrganizationRoleId: string | null;  // approve only
}
export type OrganizationJoinRequestOutbox = {
  requestId: string; organizationId: string; customerAccountId: string;
  state: string; routing: string | null; operatorReason: string | null;
};
export const ORGANIZATION_HOOKABLE_ACTIONS = { /* … existing six …, */
  joinRequestCreate:   hookableAction<…>('organization.join_request.create',   'organization_join_request', ['beforeCommit', 'afterCommit']),
  joinRequestSubmit:   hookableAction<…>('organization.join_request.submit',   'organization_join_request', ['afterCommit']),
  joinRequestApprove:  hookableAction<…>('organization.join_request.approve',  'organization_join_request', ['beforeCommit', 'afterCommit']),
  joinRequestReject:   hookableAction<…>('organization.join_request.reject',   'organization_join_request', ['afterCommit']),
  joinRequestWithdraw: hookableAction<…>('organization.join_request.withdraw', 'organization_join_request', ['afterCommit']),
  joinRequestExpire:   hookableAction<…>('organization.join_request.expire',   'organization_join_request', ['afterCommit']),
};
```

No note, name or reason in either. A `beforeCommit` hook on `create` (a CRM check) or `approve`
(a deployment's "approval needs our ERP to know the person") may veto.

### Events (`organization` family, R-25)

```ts
'organization.join_request.created.v1': EventBase & { requestId: string; organizationId: string; customerAccountId: string };
'organization.join_request.decided.v1': EventBase & {
  requestId: string; organizationId: string; customerAccountId: string;
  outcome: 'approved' | 'rejected' | 'withdrawn' | 'expired';
  decidedByKind: 'organization_administrator' | 'operator' | 'registrant' | 'system';
};
```

## 2. The port

```ts
/**
 * Container name: `organizationJoinRequestPort`. Owner: `organizations`.
 *
 * Join requests for server-side callers — a deployment, an integration, another module. Each
 * method runs the Command of §1 with the ambient actor (`automation` under a system scope, D-293).
 * **No permission is checked here**: the caller is the gate. Never resolve it for a
 * customer-facing route; the storefront routes of `contracts/storefront-api.md` are the
 * customer surface. The conflict policy is **not** consulted — a caller asking explicitly is not a
 * registration.
 *
 * Owner off: `organizations` is non-deactivatable; the gate exists and is never closed.
 */
export interface OrganizationJoinRequestPort {
  /** For an existing account in its own personal Organization. Refusals: 404 target, 409 OPEN, 409 NOT_APPROVABLE, 429 LIMIT. */
  requestToJoin(input: { customerAccountId: string; organizationId: string; note?: string | null }): Promise<OrganizationJoinRequestView>;
  approve(input: { requestId: string; organizationRoleId?: string; expectedVersion?: number }): Promise<OrganizationJoinRequestView>;
  reject(input: { requestId: string; reason?: string | null; expectedVersion?: number }): Promise<OrganizationJoinRequestView>;
  withdraw(input: { requestId: string; expectedVersion?: number }): Promise<OrganizationJoinRequestView>;
  /** The account's open request, if any — for a module deciding whether to show something. */
  findOpenForAccount(customerAccountId: string): Promise<OrganizationJoinRequestView | null>;
}
```

`OrganizationJoinRequestView` (Zod `organizationJoinRequestViewSchema`): `{ id, organizationId,
customerAccountId, state, origin, routing, operatorReason, requestedName, note, decidedAt,
decidedByKind, rejectionReason, grantedOrganizationRoleId, submittedAt, expiresAt, version,
createdAt }`. Server-side only; the storefront and admin views (`storefront-api.md`, `admin-api.md`)
are narrower or wider projections of it.

## 3. Error codes

Declared in `organizations' manifest.ts` `errorCodes`, added to `ERROR_CODES`, translated under
`errors.<CODE>` in `packages/modules/organizations/i18n/{en,pl}.json`.

| Code | Status | When |
| --- | --- | --- |
| `ORGANIZATION_JOIN_REQUEST_LIMIT` | 429 | the target's daily limit (R-15) |
| `ORGANIZATION_JOIN_REQUEST_OPEN` | 409 | the account already has an open request (R-14) |
| `ORGANIZATION_JOIN_REQUEST_DECIDED` | 409 | the request is not in a state the action accepts, or the version moved |
| `ORGANIZATION_JOIN_REQUEST_NOT_APPROVABLE` | 409 | `details[0].issue`: `target_not_active` \| `account_unavailable` \| `account_moved` |
| `REGISTRATION_CONFLICT_CHANGED` | 409 | the target changed between the pre-check and the write (R-10) |

## 4. Notices (`afterCommit` hooks registered by `organizations` on its own actions, R-17)

Each delivery runs under `withSystemScope('organizations: tell the parties of a join request')`
and re-reads the request by id.

| On | To | Channel | Template code |
| --- | --- | --- | --- |
| route, after `create` commits | registrant | e-mail (sent by the route, carries the token) | `organization_join_request_email_confirmation` |
| `submit` (routing `organization_administrators`) | every active Administrator of the target, each in their language | e-mail | `organization_join_request_received` |
| `submit` (routing `operator`) | operators | in-app (`adminNotificationRecordPort`, non-binding edge) | — |
| `approve` | registrant | e-mail + storefront notification centre (if `customer_notifications` present) | `organization_join_request_approved` |
| `reject` | registrant | same | `organization_join_request_rejected` |
| `expire` | registrant | same | `organization_join_request_expired` |
| `withdraw` | nobody | — | — |

Templates are declared in `transactionalEmails` (group `organizations`) with en + pl defaults in
`packages/modules/organizations/src/backend/email-templates/join-request-defaults.ts`. Variables:
`requestedName`, `taxId` (confirmation and received — the registrant typed it; the administrators'
own company's), `registrantName`, `registrantEmail` (received only), `organizationName` (approved
only — the person is now a member), `reason` (rejected, optional), `confirmUrl`, `reviewUrl`,
`expiresOn`.

## 5. Subscribers (R-19)

| Event | Handler |
| --- | --- |
| `customer_account.anonymized.v1` | `organization.join_request.erase_texts` for that account |
| `customer_account.organization_changed.v1` with `source !== 'join_request'` | `organization.join_request.withdraw` of that account's open request, actor system |

## 6. Worker

`packages/modules/organizations/src/backend/workers/join-request-expiry-sweep-worker.ts`,
`ctx.worker`, repeatable every 15 minutes, `exists` probe before entering a scope, batches of 200,
one `expire` Command each, a `409` skipped (R-18). Registered only where the host runs workers.
