# Quickstart: verifying membership moves and join requests by hand

Prerequisites: a worktree with `pnpm run build:packages` done, `pnpm run dev:infra`, then
`pnpm run setup` (db:fresh **then** module:install --all) and `pnpm run dev`. The demo seed gives
one company (tax ID shown on its Organization screen) with an administrator.

## 1. Move an account to a branch (US1)

1. Admin UI → Organizations → the demo company → *Hierarchy* → add a branch.
2. Customers → the demo buyer → *Assign to organization* → the branch.
3. Sign in on the storefront as that buyer: the account area shows the branch; the basket of the
   head office is not there (it stayed with the head office).
4. Audit log: one `customer_account.organization.change` entry, `mode: move`, `source: operator`,
   `changedFields: organizationId, organizationRoleId`, no Organization id in the state.
5. Background path (no operator): `pnpm --filter backend exec vitest run backend/test/integration/customer_accounts/membership-worker-move.test.ts`
   — the actor kind is `automation`.

## 2. Join request, approved by the company (US2, US3)

1. Settings → Organizations → *Registration — tax ID already registered*: `join_request`.
2. Storefront → Register a business with the demo company's tax ID and a new e-mail address. The
   page says *Request sent*; Mailpit has the confirmation e-mail.
3. Sign in with the new account before confirming: the account home shows *Waiting to join* with
   the name and tax ID you typed, state *awaiting e-mail confirmation*. The company's
   administrator sees nothing yet.
4. Open the confirmation link. The administrator receives *New request to join*.
5. As the administrator: Organization → Members → *Join requests* → Approve, role *Member*.
6. As the registrant, reload: the account is in the company; the approval e-mail arrived.

## 3. Rejected, withdrawn, expired, limited (US3, US6)

- Reject with a reason → the registrant stays private; the e-mail carries the reason.
- Withdraw from the account home → the administrator's list no longer shows it; no e-mail.
- Settings: expiry 1 day; move the clock or set `expires_at` in the past in a test database; the
  sweep closes it as expired.
- Settings: daily limit 1; the second registration naming the same company the same day is refused
  *Too many requests to join this company today*.

## 4. Operator queue (US4)

1. Settings → *Join requests — who decides*: `operator`.
2. Register another join request and confirm it. The operator bell shows it; ⌘K → *Join requests*.
3. Approve with a role. Log in as an admin whose reach excludes the company: the request is not found.

## 5. Default untouched (SC-001)

Set the policy back to `refuse`: registering with an existing tax ID answers
*An organization with this tax ID already exists*, exactly as before.
