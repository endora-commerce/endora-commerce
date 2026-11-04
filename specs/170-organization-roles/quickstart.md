# Quickstart: verifying organization roles end to end

For the reviewer of the final integration MR and for each work package's author. Assumes a worktree
stood up with `scripts/setup-worktree.sh` and `pnpm run build:packages` done.

## 1. Fresh instance

```bash
pnpm run dev:infra
pnpm run setup                       # db:fresh, then module:install --all (runs every installHook)
pnpm run dev
```

The demo seed gives at least one company Organization with an administrator and a regular user.

## 2. Storefront, as the administrator (US 1, US 5, US 6)

1. Sign in, open **Organization → Roles**. Two rows: *Administrator* ("All permissions", no actions)
   and *Member* (*Edit permissions*).
2. **New role** → *Junior buyer*, tick *Create and edit carts* and *Create and edit shopping lists*,
   save. The list shows it with 0 members.
3. Creating a second role named `junior BUYER ` is refused (*name already used*). So is a role named
   `Member` or `Członek`.
4. **Organization → Members**: change the regular user's role to *Junior buyer*.
5. **Organization → Members → Invite**: the role select offers all three roles, *Member* preselected;
   invite with *Junior buyer*; the e-mail (Mailpit) names *Junior buyer* — in Polish when the
   storefront is Polish, the custom name verbatim either way (#667).
6. Delete *Junior buyer*: the dialog asks for a replacement (*Member* preselected) and states
   "1 member, 1 invitation". Confirm; the member and the invitation now hold *Member*.
7. Admin UI → Audit log, `?objectType=organization&objectId=<org id>`: one `organization_role.create`,
   one `customer_account.change_role` (step 4), one `organization_invitation.create`, one
   `organization_role.delete` and one `customer_account.change_role` child — each naming the
   storefront administrator as actor.

## 3. Storefront, as the regular user (US 1.3, US 3, US 4)

With *Junior buyer* re-created and assigned:

```bash
# each answers 403 ORGANIZATION_PERMISSION_REQUIRED naming the label
curl -b cookies -X POST localhost:3000/api/v1/quote-requests -d '{…}'
curl -b cookies -X POST localhost:3000/api/v1/quick-order/one-click -d '{…}'
```

- The PDP shows no one-click button; *Request a quote* is absent from PDP, cart and lists.
- The cart's primary action is *Submit for approval*; placing the order before approval is refused.
- **Account** shows *Your role: Junior buyer* and the two things it allows.

## 4. Approvers (US 3)

Give a third member a role with *Approve and reject colleagues' carts* and *Place orders without
approval*. They see **Organization → Carts to approve** with a count, approve the junior buyer's cart,
and are refused approving a cart of their own. The submitter receives the approval e-mail (#651).

Then grant *Place orders without approval* to *Junior buyer*: the pending cart returns to *not
required* and checks out directly (FR-034).

## 5. Operator (US 7)

- An admin role with `organizations:read-roles` sees the **Roles** tab read-only on
  `/organizations/:id`; with `organizations:manage-roles` edits a role under the same refusals;
  with neither, no tab and `403` on `GET /api/v1/admin/organizations/:id/roles`.
- The member table's role select changes a member's role under `customers:manage` alone.
- A personal Organization shows no Roles tab.

## 6. Switching a module off (US 8)

On `/platform/modules` switch **Shopping lists** off. The role editor (storefront and Admin UI) no
longer lists its two permissions; `GET /api/v1/organizations/mine/role` no longer reports them. Save
*Junior buyer* unchanged. Switch it on: the role still holds *Create and edit shopping lists*.

## 7. Upgrade (US 2, FR-072)

```bash
pnpm run dev:infra:test
pnpm --filter backend exec vitest run test/integration/organizations/roles-upgrade-replay.test.ts
```

Green means every pre-upgrade outcome recorded by WP-00's oracle is reproduced after the migration,
except the 26 rows of the expected-differences table (`contracts/migration-and-replay.md` §6.1),
each of which reaches exactly its stated new outcome.

## 8. Checks to run before the integration MR

```bash
pnpm -r run typecheck && pnpm -r run lint
pnpm run check:naming && pnpm run check:language
pnpm --filter backend run test:unit:fast
pnpm --filter '!backend' run test
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts
pnpm --filter backend run check:port-dependencies && pnpm --filter backend run check:port-catches
pnpm --filter backend run check:module-boundary && pnpm --filter backend run composer:check
pnpm --filter backend run i18n:hardcoded
# the inventory (research R-14) — both commands must print nothing outside migrations and tests
R14_GLOBS=(--glob '!**/*.test.ts' --glob '!**/*.test.tsx' --glob '!**/test/**' --glob '!**/docs/**'
   --glob '!**/dist/**' --glob '!**/migrations/**' --glob '!**/*.md' --glob '!specs/**' --glob '!**/ledgers/**')
# word boundaries: `CustomerAccountRole` must not match 170's own `CustomerAccountRole*Command*`
# symbols, nor `organization_admin` the audit action `customer_account.promote_organization_admin`
rg "\b(organization_admin|regular_user|isOrgAdmin|CustomerAccountRole|organizationRoleSchema|countByOrganizationRole|requiresCartApproval)\b" \
   "${R14_GLOBS[@]}" .
# the legacy `OrganizationRole` type of `@endora-commerce/contracts`. The `organizations` entity
# class has the same name, so skip its declaration and every file that imports it (one scope
# cannot hold both names unaliased).
rg -l --files-without-match "entities/organization-role\.entity" "${R14_GLOBS[@]}" \
   --glob '!**/organization-role.entity.ts' --type ts . | xargs -r rg -n "\bOrganizationRole\b"
# and, because D-198 keeps them off merge requests, the complete suite locally
pnpm --filter backend run test
```
