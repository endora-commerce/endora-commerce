# Contract: storefront API and the reference storefront's pages

Zod schemas in `packages/contracts/src/organization-join-requests.ts` and
`packages/contracts/src/organizations.ts` (registration). Routes are `organizations'`, mounted
through `ctx.routes`. Refusals that would reveal a record answer `404 NOT_FOUND`; the member-management
refusal is the existing `403 FORBIDDEN` (`routes.members.ts`, reserved *Administrator* capability).

## 1. Registration

### `POST /api/v1/organizations/register` (anonymous, `salesChannelAccess: 'open'`, unchanged path)

Request: `registerOrganizationRequestSchema` gains one optional field:

```ts
joinRequestNote: z.string().trim().max(500).optional(),   // ignored unless a join request is created
```

Response — `registerOrganizationResponseSchema` becomes a discriminated union on `outcome` (R-16):

```ts
| { outcome: 'organization_registered'; organization; customerAccount; emailVerificationSent }   // 201, as today + outcome
| { outcome: 'join_request_sent'; customerAccount; emailConfirmationSent: boolean }              // 202
```

`customerAccount` is the same `CustomerAccount` view the 201 returns (the registrant's own account,
in their personal Organization). Nothing names the target. Refusals added:
`429 ORGANIZATION_JOIN_REQUEST_LIMIT`, `409 REGISTRATION_CONFLICT_CHANGED`. Under `refuse`, an
existing tax ID still answers `409 ORGANIZATION_TAX_ID_EXISTS`.

### `GET /api/v1/organizations/registration-options` (anonymous)

Gains `joinRequestsOffered: boolean` — the setting `organizations.registration.conflict_policy`
equals `join_request`. The storefront renders the optional note field only when `true` (R-21). The
revalidation tag `organizations:registration-options` is invalidated when that setting changes.

### `POST /api/v1/auth/email-verification/verify` (anonymous, unchanged path)

Unchanged reply. Side effect added: the account's open request, if `awaiting_email_confirmation`,
is submitted (R-11).

## 2. The registrant (`routes.customer.ts`, `requireCustomer`)

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/v1/me/join-request` | — | `{ data: RegistrantJoinRequestView \| null }` — the account's latest request decided in the last 30 days or still open; `no-store` |
| `POST /api/v1/me/join-request/:id/withdraw` | `{ expectedVersion: int }` | `{ data: RegistrantJoinRequestView }`; `404` when not the caller's; `409 ORGANIZATION_JOIN_REQUEST_DECIDED` |

```ts
RegistrantJoinRequestView = {
  id; state; requestedTaxId; requestedName: string | null; note: string | null;
  createdAt; expiresAt; decidedAt: string | null;
  rejectionReason: string | null;     // only when state = rejected
  version;
}
```

`requestedTaxId` is the tax ID the registrant entered, normalised (stored on the request,
data-model §1); no field reads the target Organization.

`GET /api/v1/me` gains nothing: the account area asks `/me/join-request` itself, so `/me` stays
cacheable by its existing rules.

## 3. Company administrators (`routes.members.ts`, `requireCustomer` + `isAdministrator`)

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/v1/organizations/mine/join-requests?state=pending\|decided&page=&pageSize=` | — | requests of the caller's Organization routed to `organization_administrators`; `decided` = the last 90 days; oldest first for `pending` |
| `GET /api/v1/organizations/mine/join-requests/:id/placements?q=&limit=` | — | `{ data: JoinRequestPlacementList }` (`join-requests.md` §2) — for an administrator **without** roll-up exactly one item, their company; with roll-up the company and its live, `active` branches (research R-27, R-30); `no-store` |
| `POST /api/v1/organizations/mine/join-requests/:id/approve` | `{ placementOrganizationId?: uuid, organizationRoleId?: uuid, expectedVersion: int }` | `{ data: CompanyJoinRequestView }` |
| `POST /api/v1/organizations/mine/join-requests/:id/reject` | `{ reason?: string ≤ 500, expectedVersion: int }` | `{ data: CompanyJoinRequestView }` |

```ts
CompanyJoinRequestView = {
  id; state; registrant: { customerAccountId; firstName; lastName; email };
  requestedName: string | null; note: string | null;
  createdAt; submittedAt; expiresAt; decidedAt: string | null;
  decidedByKind: string | null;
  /**
   * Approved requests only. `organization` and `grantedRole` are null when the placement is outside
   * the viewer's reach (an operator placed the person in a branch this administrator does not see):
   * the list then says "approved into a branch" without naming it.
   */
  placement: { isTarget: boolean; organization: { id; name } | null } | null;
  grantedRole: OrganizationRoleRef | null; version;
}
```

A request routed to the operator, or of another Organization, answers `404`. Approve refusals:
`404` (a placement the caller may not choose — a branch named without roll-up, an Organization above,
beside or outside the tree, a deleted one — or a role not of the placement),
`409 ORGANIZATION_JOIN_REQUEST_DECIDED`, `409 ORGANIZATION_JOIN_REQUEST_NOT_APPROVABLE`
(`placement_not_active` among its tokens), and a hook veto.

The roll-up read is the request's own tenant context: the route runs as the administrator, whose
allowed set is the company's subtree with roll-up and the company alone without it; nothing in the
body or the query widens it (Principle XI). Roll-up widens **where a person may be placed**, never
**which requests** an administrator decides: every route in this table also constrains
`organization_id = <the caller's own Organization>` explicitly, so a roll-up administrator does not
see or decide requests addressed to a branch (possible under the `global` scope, where a branch may
hold its own tax ID) — those belong to that branch's administrators. The registrant's data comes from
`customerAccountReadPort.findByIds` (`customer_accounts`, acknowledged edge already declared).

`GET /api/v1/organizations/mine/members` gains `pendingJoinRequestCount` beside the existing
pending-invitation count, so the members screen can show the tab without a second request.

## 4. The reference storefront (`storefront/`)

| Where | Change |
| --- | --- |
| `app/(auth)/register/actions.ts` | a `202 join_request_sent` reply redirects to `/register?status=join-requested` (no address or tax ID in the URL — issue #745) |
| `app/(auth)/register/page.tsx` | the `join-requested` state: "Request sent. Confirm your e-mail address, then sign in to follow your request." The note field when `joinRequestsOffered`; refusal copy for the two new codes |
| `app/(account)/account/` (home) | `JoinRequestNotice` — "Waiting to join {requestedName} (tax ID {requestedTaxId})", state, withdraw (confirm dialog), and the decided states for 30 days |
| `app/(account)/organization/members/` | a *Join requests* tab for administrators: list, approve, reject (reason dialog); hidden when the count is 0 and nothing was decided in 90 days. The approve dialog (`DecideJoinRequestDialog`) reads the request's placements when it opens; it shows a *Place in* select **only when more than one placement is listed** (the company first, labelled as such, then branches indented by `depth`, a search field above 10 items), and a role select filled from the chosen placement's roles with *Member* preselected — re-filled when the placement changes. A `404` or `placement_not_active` on submit keeps the dialog open, shows the refusal and reloads the placements. Decided rows show *Approved — {placement name}* or *Approved into a branch* |
| `lib/api/join-requests.ts` | the five client calls, parsed with the contracts' schemas |
| `messages` (`en`, `pl`) | every string above; the placement strings are listed below |

Placement strings (keys under `account.joinRequests.approve.*`; en / pl):

| Key | en | pl |
| --- | --- | --- |
| `placement.label` | Place in | Dodaj do |
| `placement.help` | The company or one of its branches. The person becomes a member of the one you choose. | Firma lub jeden z jej oddziałów. Osoba zostanie członkiem wybranej organizacji. |
| `placement.thisCompany` | {name} (this company) | {name} (ta firma) |
| `placement.search` | Search branches | Szukaj oddziałów |
| `placement.empty` | No branch matches. | Żaden oddział nie pasuje. |
| `role.label` | Role in {name} | Rola w {name} |
| `refusal.placementUnavailable` | The selected branch is no longer available. Choose another one. | Wybrany oddział nie jest już dostępny. Wybierz inny. |
| `decided.approvedInto` | Approved — {name} | Zatwierdzono — {name} |
| `decided.approvedIntoBranch` | Approved into a branch | Zatwierdzono do oddziału |

All three surfaces are Server Components with server actions, like `components/account/Payers.tsx`
and its reject dialog (`RejectPayerRequestButton.tsx`), whose structure they follow.

## 5. Tests

- contract: the 202 shape carries no `organization` and no target id (SC-006); the 201 shape is a
  superset of today's;
- contract: an administrator of another Organization gets `404` on approve; a member without the
  *Administrator* role gets `403 FORBIDDEN`; the registrant's withdraw of another account's id is `404`;
- contract (placement): without roll-up the placements list is the company alone and naming a
  branch is `404`; with roll-up a branch is listed and accepted, a blocked branch is not listed and
  naming it is `409 placement_not_active`, a sibling tree's Organization and the target's parent are
  `404`, a role of the company used with a branch is `404`; the person's next request is scoped to
  the branch;
- storefront Vitest: the register page's `join-requested` state; the notice; the tab hidden for a
  non-administrator; the approve dialog without a *Place in* select for one placement, with it for
  several, the role list following the placement, *Member* preselected, pl strings.
