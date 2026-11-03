# Contract: operator (Admin UI) HTTP API and permissions

**Normative for**: WP-02a (role endpoints, codes), WP-03 (member endpoints, impersonation),
WP-04 (removed policy endpoints), WP-08 (Admin UI). Owner ruling OR-7.

## 1. Operator permission codes — `organizations` manifest

```ts
permissions: [
  // existing three unchanged
  { code: 'organizations:read-roles',   label: 'View organization roles' },
  { code: 'organizations:manage-roles', label: 'Manage organization roles',
    requires: ['organizations:read-roles'] },
]
```

Labels in `packages/modules/organizations/i18n/{en,pl}.json` as `adminRoles.permission.<code>`
(`specs/conventions/module-admin-surfaces.md` item 4). *Platform administrator* holds them through
`*`. No palette action: the Roles tab lives on `/organizations/:id`, a detail screen no action can
target (item 7); `open-organizations` remains the module's landing action. The permission
inventory's enforced ⇒ grantable direction is satisfied by §2.

## 2. Role endpoints — new, `organizations/routes.admin-roles.ts` — WP-02a

| Method & path | Gate | Body / answer |
| --- | --- | --- |
| `GET /api/v1/admin/organizations/:id/roles` | `organizations:read-roles` or `organizations:manage-roles` (`requireAdminAny`) | `{ data: OrganizationRoleView[] }` (shape of `storefront-api.md` §2) |
| `GET /api/v1/admin/organizations/:id/permission-catalogue` | same | as the storefront catalogue, in the operator's language |
| `POST /api/v1/admin/organizations/:id/roles` | `organizations:manage-roles` | as storefront |
| `PATCH /api/v1/admin/organizations/:id/roles/:roleId` | `organizations:manage-roles` | as storefront |
| `DELETE /api/v1/admin/organizations/:id/roles/:roleId` | `organizations:manage-roles` | as storefront |

The same Commands serve both surfaces; the actor comes from the ambient context (R-10, R-21), so
the audit entry names the operator. A scoped operator outside the Organization's reach gets `404`
(the tenant guard; Principle XI). Personal Organizations answer `404`.

## 3. Member endpoints — `organizations/routes.admin.ts` — WP-03 (FR-062: `customers:manage`)

| Endpoint | Change |
| --- | --- |
| `POST /api/v1/admin/organizations/:id/members/invite` | body `role` → `roleId?` (default *Member*) |
| `POST /api/v1/admin/organizations/:id/members` (direct create) | body `role` → `roleId?` (default *Member*) |
| `PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/role` | body `{ roleId, expectedUpdatedAt? }`; runs `customer_account.change_role` |
| `GET /api/v1/admin/organizations/:id` (members embedded) | member `role` → `organizationRole` |
| `POST /api/v1/admin/organizations/:id/recover-admin-access` | unchanged body; assigns the administrator-kind role through `customer_account.change_role` |
| impersonation start (`customers/routes.admin.ts`, `impersonationStartResponseSchema` in `packages/contracts/src/admin.ts`) | `impersonatedCustomerAccount.role` → `organizationRole` |

## 4. Removed (OR-3) — WP-04

`GET` and `PATCH /api/v1/admin/organizations/:id/cart-approval-policy` (`carts/routes.admin.ts`), the
`organization.detail.after` zone `CartApprovalPolicy` and `CartApprovalPolicyPanel.tsx`
(`packages/modules/carts/src/admin/`), and — in WP-12 — `organizationCartApprovalWritePort`,
`organization.set_cart_approval_policy` and `setCartApprovalPolicySchema` /
`cartApprovalPolicyResponseSchema`.

## 5. Admin UI — WP-08

- `OrganizationDetail.tsx`: the members table's role column and the invite / direct-create forms read
  the Organization's roles from §2 (`customers:manage` is enough to *assign*, FR-062, so the
  dropdown's data comes from `GET …/roles` when the operator holds `organizations:read-roles`, and
  from the members' own `organizationRole` plus the two predefined roles otherwise). Last-admin
  disabling keys off `organizationRole.kind === 'administrator'`.
- New `packages/modules/organizations/src/admin/components/OrganizationRolesTab.tsx`, mounted only
  when the operator holds one of the two codes and the Organization is not personal: table of roles,
  editor grouped by module (admin-kit primitives, Principle IX), delete dialog with replacement
  select, and a *History* link to `/audit-log?objectType=organization&objectId=<id>` (R-32).
- Every string in `organizations`' admin bundle, EN + PL; `i18n:hardcoded` stays at its ledger.
