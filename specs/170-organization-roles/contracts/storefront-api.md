# Contract: storefront (buyer) HTTP API

**Normative for**: WP-01 (schemas in `packages/contracts/src/organization-roles.ts` and
`organizations.ts`), WP-02a (role routes), WP-03 (members, invitations, session, addresses),
WP-04–WP-07 (gates), WP-09/WP-10 (consumers). All paths stay under `/api/v1` (R-8). Every request
schema below is `.strict()` (R-24); a body carrying `role` answers `400 VALIDATION_FAILED`.

Guards are written `C` = `requireCustomer`, `A` = administrator-kind role (reserved, `403
FORBIDDEN`), `P(code)` = `organizationPermissionPreHandler(…, code)` (`403
ORGANIZATION_PERMISSION_REQUIRED`), `Pg(code)` = the same guard with `{ guests: 'pass' }` — a
signed-in customer is judged, a guest keeps the guest basket unjudged (owner ruling PR-4, research
R-35).

**Personal Organizations (owner ruling PR-3, research R-34).** A personal Organization's sole member
holds *Administrator*. The role routes answer `404` for a personal Organization (spec *Edge Cases*),
since the screen is not offered there; inviting answers `422 VALIDATION_FAILED` before the role id is
resolved (feature 051, unchanged rule); every other `A` route answers as for any administrator. The
storefront offers none of the organization-management screens there — gated by
`organization.isPersonal` on `/api/v1/me`, never by the role.

## 1. Session views (FR-056, FR-073) — WP-03

| Endpoint | Change |
| --- | --- |
| `POST /api/v1/auth/customer/login` (`organizations/routes.public.ts`) | `customerAccount.role` **removed**; adds `organizationRole: OrganizationRoleRef`, `permissions: string[]` |
| `GET /api/v1/me` (`organizations/routes.customer.ts`) | `role` removed from the customer; adds `organizationRole`, `permissions` |
| `GET /api/v1/me/customer` (`customers/routes.self.ts`) | `role` removed; adds `organizationRole` |

`OrganizationRoleRef.name` is the translated label for `administrator` / `member` in the response
language and the stored name for `custom` (FR-008). `permissions` is `effective(subject).permissions`.

## 2. Roles — new, `organizations/routes.roles.ts` — WP-02a

| Method & path | Guards | Body / answer |
| --- | --- | --- |
| `GET /api/v1/organizations/mine/roles` | C, A | `{ data: OrganizationRoleView[] }` — every role, ordered administrator, member, then custom by name; each with `memberCount`, `pendingInvitationCount` (pending as FR-010a defines it: not accepted, revoked or expired) |
| `GET /api/v1/organizations/mine/roles/:id` | C, A | `{ data: OrganizationRoleView }` |
| `POST /api/v1/organizations/mine/roles` | C, A | `createOrganizationRoleRequestSchema` `{ name, description?, permissions: string[] }` → `201 { data: OrganizationRoleView }` |
| `PATCH /api/v1/organizations/mine/roles/:id` | C, A | `updateOrganizationRoleRequestSchema` `{ expectedVersion, name?, description?, permissions? }` (name/description refused for `member`) |
| `DELETE /api/v1/organizations/mine/roles/:id` | C, A | `deleteOrganizationRoleRequestSchema` `{ expectedVersion, replacementRoleId? }` → `200 { data: { reassignedMembers, reassignedInvitations } }` |
| `GET /api/v1/organizations/mine/permission-catalogue` | C, A | `{ data: { groups: [{ moduleId, moduleLabel, permissions: [{ code, label, description, memberDefault }] }] } }` — present codes only, translated (R-31) |
| `GET /api/v1/organizations/mine/role` | C | `{ data: { role: OrganizationRoleRef, permissions: [{ code, label, description }] } }` — the member's own (FR-058) |

```ts
OrganizationRoleView = {
  id, kind, name, description: string | null,
  permissions: string[],          // stored grants, present codes only; administrator: every present code
  memberCount: number, pendingInvitationCount: number,
  version: number, updatedAt: IsoDateTime,
}
```

`OrganizationRoleView.permissions` omits grants of absent modules (they are kept server-side,
FR-025); the editor therefore never has to round-trip them.

**A new custom role is created with exactly the submitted `permissions`** (OR-9, FR-004a, R-39):
`permissions: []` is valid and creates a role that allows nothing; no member default is added to a
custom role, ever. The storefront create form opens with every catalogue entry unchecked and offers
no "copy from *Member*"; `memberDefault` in the catalogue describes *Member* and is not a pre-tick.

## 3. Members and invitations — `organizations/routes.members.ts` — WP-03

| Method & path | Guards | Change |
| --- | --- | --- |
| `GET /api/v1/organizations/mine/members` | C, A | each member: `role` → `organizationRole` |
| `PATCH /api/v1/organizations/mine/members/:id/role` | C, A | body `{ roleId }` (was `{ role }`); runs `customer_account.change_role`; refusals unchanged (`CANNOT_DEMOTE_LAST_ADMIN`) plus `404` for a role of another Organization (FR-005) |
| `DELETE /api/v1/organizations/mine/members/:id` | C, A | unchanged shape; runs `customer_account.remove_member` |
| `GET /api/v1/organizations/mine/invitations` | C, A | each invitation: `role` → `organizationRole`; lists **pending** invitations only — an expired one (`expiresAt <= now`) is no longer listed (FR-010a, owner ruling PR-7) |
| `POST /api/v1/organizations/mine/invitations` | C, A | body `{ email, roleId? }` (default: the Organization's *Member* role); runs `organization_invitation.create`; the e-mail's `roleLabel` comes from the role (#667, US 5.1a); a personal Organization → `422 VALIDATION_FAILED`, before `roleId` is resolved |
| `POST /api/v1/organizations/invitations/:token/accept` | public | `customerAccount.role` → `organizationRole` |

## 4. Organization addresses — `organizations/routes.customer.ts` — WP-03 (OR-8, #668)

| Method & path | Guards |
| --- | --- |
| `GET /api/v1/organizations/mine/addresses` | C (unchanged — reading stays open) |
| `POST /api/v1/organizations/mine/addresses` | C, P(`addresses.manage`) |
| `PATCH /api/v1/organizations/mine/addresses/:id` | C, P(`addresses.manage`) |
| `DELETE /api/v1/organizations/mine/addresses/:id` | C, P(`addresses.manage`) |

## 5. Commerce gates — WP-04 to WP-07, WP-14 (returns, OR-11), WP-15 (quick-order import, OR-10), WP-16 (reorder, clone to quote)

| Endpoint (owner file) | New guard |
| --- | --- |
| `POST /api/v1/cart/items`, `PATCH`/`DELETE /api/v1/cart/items/:itemId`, `POST`/`DELETE /api/v1/cart/coupon`, any batch-add or empty-cart route that admits a guest today (`carts/routes.ts`) | Pg(`carts.create`) — a guest still adds to and edits the guest basket (`200`, as today); a signed-in member lacking the code → `403` (PR-4) |
| `POST /api/v1/cart/from-quote-request/:quoteRequestId` | P(`carts.create`) |
| `POST /api/v1/cart/from-shopping-list/:shoppingListId` | P(`shopping_lists.convert`), P(`carts.create`) |
| `POST /api/v1/cart/items/:itemId/save-to-shopping-list` | P(`shopping_lists.create`) |
| `POST /api/v1/cart/convert-to-quote-request` | P(`quote_requests.create`) |
| `POST /api/v1/cart/submit-for-approval` | refused `422 CART_APPROVAL_NOT_REQUIRED` when the buyer holds `carts.order_without_approval` (was: Organization policy off → `CART_APPROVAL_NOT_REQUIRED`, buyer is admin → `CART_APPROVAL_SELF_SUBMIT`, which is no longer raised) |
| `GET /api/v1/cart` | none — still lazily creates and returns the basket (R-5); `primaryCta` judged by `carts.order_without_approval` |
| `GET /api/v1/organization/carts`, `GET …/:id` (`carts/routes.organization.ts`) | P(`carts.approve`) (was: admin) |
| `POST /api/v1/organization/carts/:id/approve`, `…/reject` | P(`carts.approve`); a cart that is not pending → `422 CART_APPROVAL_NOT_PENDING` (checked first, as today); approving or rejecting **one's own** pending cart → `422 CART_APPROVAL_SELF_APPROVE` (new, `carts`) |
| `PATCH /api/v1/organization/policies/cart-approval` | **removed** (OR-3) |
| `POST /api/v1/quote-requests`, `POST …/:id/resubmit` (`quote_requests/routes.customer.ts`) | P(`quote_requests.create`) |
| `POST /api/v1/quote-requests/:id/convert-to-order` | P(`carts.create`) (it fills the basket) |
| `POST /api/v1/shopping-lists`, `PATCH`/`DELETE /api/v1/shopping-lists/:id`, `…/items`, `…/items/:itemId`, `…/default/items`, `…/set-default` | P(`shopping_lists.create`) |
| `POST /api/v1/shopping-lists/:id/convert-to-cart` | P(`shopping_lists.convert`), P(`carts.create`) |
| `POST /api/v1/shopping-lists/:id/convert-to-rfq` | P(`shopping_lists.convert`), P(`quote_requests.create`) |
| `POST /api/v1/quick-order/build` (`mode: cart`) | P(`carts.create`) |
| `POST /api/v1/quick-order/import` | **either** `carts.create` **or** `quote_requests.create` (OR-10, FR-030b; was P(`carts.create`), WP-06) — a module-local pre-handler after `requireCustomer`, before the body is parsed, asking `can` for `carts.create` then `quote_requests.create`; a member holding neither → `403 ORGANIZATION_PERMISSION_REQUIRED` with `details.permission = 'carts.create'` (raised by `assert(…, 'carts.create')`, R-40). The import writes nothing; the build that follows is judged by its target (the two `build` rows) |
| `POST /api/v1/quick-order/build` (`mode: quote`) | P(`quote_requests.create`) — inside the handler's mode branch, through `assert`, since the mode is in the body |
| `GET /api/v1/quick-order/one-click/eligibility` (or the eligibility field the PDP reads) | answers `disabled` with reason `permission_required` (no `quick_order.one_click`) or `cart_approval_required` (holds it, but no `carts.order_without_approval`), checked in that order and before the setting and default reasons (FR-050); lacking both reads `permission_required` |
| `POST /api/v1/quick-order/one-click` | refused before any basket write: `403 ORGANIZATION_PERMISSION_REQUIRED` for the first missing of the two codes, in the same order (`quick_order.one_click` first) |
| `PUT /api/v1/quick-order/preferences` with Organization scope | A (FR-012; was `role === 'organization_admin'`) |
| Orders list/read, reorder, clone to quote, returns started from an order, its documents (`orders`, `returns`, `invoices` through `OrderReadPort`) | colleague's order reachable only with `orders.view_organization`; without it the order is `404`, never `403` (Principle XI existence rule). Reorder and clone to quote also need their own code (the two rows below), starting a return `returns.create` (row below) |
| `POST /api/v1/orders/:id/reorder` (`orders/routes.ts`) | P(`carts.create`) — it replaces the active basket (WP-16). Judged after `requireCustomer` and **before** the order is read, as the composite gates above are: a member lacking the code → `403 ORGANIZATION_PERMISSION_REQUIRED` whichever order the id names (own, colleague's, none); a holder then meets the order scope unchanged (`404 ORDER_NOT_FOUND` out of it). The operator route `POST /api/v1/admin/orders/:id/reorder` is unchanged |
| `POST /api/v1/orders/:id/clone-to-quote` (`orders/routes.ts`) | P(`quote_requests.create`) — it creates a quote request (WP-16); the same check order as the reorder. With `quote_requests` off its code leaves every effective set (FR-007), so the guard refuses (`403` naming the code) before the service's `503 MODULE_DISABLED`, which only the operator route still meets (owner ruling of 2026-11-04: the buyer's answer stays `403`). The operator route `POST /api/v1/admin/orders/:id/clone-to-quote` is unchanged |
| `POST /api/v1/returns` (`returns/routes.customer.ts`) | P(`returns.create`) — `403 ORGANIZATION_PERMISSION_REQUIRED` before the order is read (FR-052); then the order through `orderReadPort.findByIdForCustomer` — out of the member's order scope → `404 NOT_FOUND` (FR-054, Q-R1 = A; today: placer only) |
| `GET /api/v1/orders/:orderId/returnable` (`returns`) | none (a read, FR-052); the order through `orderReadPort.findByIdForCustomer` → `404 NOT_FOUND` out of scope (FR-054; today: placer only) |
| `GET /api/v1/returns`, `GET /api/v1/returns/:id` (`returns`) | holder of `returns.view_organization` (or *Administrator*): every case of the Organization through the tenant filter (subtree for a roll-up login); anyone else: the cases they filed; out of reach → `404 NOT_FOUND` (FR-053). `ReturnCaseSummary` gains `customerAccountId` (the filer, additive) |
| `POST /api/v1/returns/:id/comments`, `…/attachments`, `…/select-delivery-method`, `…/cancel` (`returns`) | unchanged: the filer only, anyone else `404 NOT_FOUND`, whatever their permissions (FR-053, Q-R2 = A); `returns.create` is **not** required (FR-052) |
| `GET /api/v1/returns/reasons` | unchanged, open to every signed-in member |
| MFA policy (`mfa/routes.org.ts`) | A (FR-011, unchanged rule) |

The exact route list is the implementing WP's to enumerate from its route files; this table names
every family the FRs require, and the inventory's `unchecked-declaration` finding refuses a code
that ends up gating nothing.
