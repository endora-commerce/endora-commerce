---
title: Permissions — admin and organization codes, and which one you are looking at
description: How admin permission codes and organization permission codes are declared, granted, enforced and switched off.
---

# Permissions

The platform has **two permission vocabularies**, and they never meet:

| Vocabulary | Who holds it | Shape | Declared in a manifest as | Granted on |
| --- | --- | --- | --- | --- |
| Admin (operator) permissions | platform administrators, through admin roles | `<area>:<action>`, e.g. `catalog:write` | `permissions` | `/admin-roles` in the Admin UI |
| Organization permissions | members of a customer Organization, through organization roles | `<module>.<action>`, e.g. `carts.approve` | `organizationPermissions` | the Organization's *Roles* screen on the storefront, and the *Roles* tab of the Organization in the Admin UI |

No string may be both. The first half of this page is the admin vocabulary; the
second, [Organization permissions](#organization-permissions), is the buyer's.

An admin permission in this platform is a code, and a code has **three separate
notions attached to it**. Only one of them used to be visible anywhere, and that
is why this page exists: a reader who sees `module: 'quote_requests'` on
`rfqs:handle` reasonably concludes that `quote_requests` is the one thing that
decides whether the code is there. That conclusion is wrong often enough to have
caused a shipped defect; an audit found five instances of it.

## 1. `module` — a display grouping

`module` is the heading the role editor files a code under. Nothing more.

It is **not** guaranteed to be a module id: `_lifecycle` declares its codes under
`module: 'module_lifecycle'`, which names no module in any deployment. Filtering
anything on `module` therefore deletes the lifecycle permissions from every
platform that tries it.

## 2. `owners` — whose presence keeps the code grantable

`owners` is the **set** of modules that declare the code. `/admin-roles` offers
the code while **any** owner is effectively present — both axes of module
presence, platform availability *and* operator activation.

It is a set because a code can be shared. `integrations:manage` gates the API
keys admin surface and the webhooks one, and both `api_keys` and `webhooks`
declare it; switching `webhooks` off must not take the API keys screen's own gate
off the role editor. Co-declaration is the mechanism, and it is the repair for a
module that enforces a code another module owns — see *foreign gates* below.

`owners` and `module` are different strings and treating them as one is a defect
waiting to happen. Both are on the wire on `GET /api/v1/admin/permissions`, and
the role editor shows the owner set wherever it says something the grouping does
not.

## 3. The vocabulary, and the grantable set inside it

Two questions, deliberately answered differently:

| Question | Method | Presence-filtered |
| --- | --- | --- |
| What may an operator **newly grant**? | `listAssignable()` | yes |
| What codes does the platform **know**? | `listKnownCodes()` | no |

A role upsert validates against the **vocabulary**, never the grantable set, and
the difference is what keeps *"switching a module off is non-destructive and
reversible"* true. An "Editor" role holds `blog.read`; an operator switches
`blog` off and then renames the role. Validating the submitted list against the
grantable set would answer `400 Unknown permission(s): blog.read` — so the
operator either loses the role or silently drops a grant that has to come back
when `blog` does. The grant is harmless meanwhile: the routes behind it answer
`503 MODULE_DISABLED` at their own seam.

The role editor relies on this. It seeds its selection from the **role's** codes
and renders a checkbox only for the ones the catalogue offers, so an absent
module's grant survives the round trip with no checkbox to un-tick.

`PermissionCatalogueService`
(`packages/modules/admin_roles/src/backend/services/permission-catalogue.service.ts`)
is where all three notions are merged, and it is the only place they are.

## Foreign gates: enforcing a code you do not own

A module may enforce a permission code another module owns. Nothing declares
that coupling, and the cost is one-directional: the owner's presence decides
whether the code is offered, so switching the owner off takes the code off
`/admin-roles` while the consumer's routes — if the consumer cannot be switched
off with it — go on enforcing it. The screen sits there behind a permission
nobody can be granted.

It is **derived, not declared**. `backend/test/helpers/foreign-gates.ts` reads
every enforcement site the permission inventory resolves and every manifest, and
classifies each pair; every verdict comes off the manifests on every run, so
withdrawing a module's `nonDeactivatable` lock re-opens every finding that was
resting on it, in the same pipeline, with no ledger to edit.

Three repairs, in the order to reach for them:

1. **The consumer gates on a code it owns.** Apply the label test: does the
   code's label read as a sentence about the consumer's own screen? *"Handle
   quote requests"* is not a sentence about a price-resolution endpoint, so
   `price_lists` gates that route with `price_lists:read`.
2. **Both modules declare the code**, making the consumer a second owner, so the
   code survives while either surface is on. This is the shape `api_keys` and
   `webhooks` already use.
3. **Declare the owner in `dependencies`** — last, and usually wrong. A consumer
   that cannot be switched off, declaring an owner that can, makes the lifecycle
   orchestrator refuse to switch that owner off at all: the operator-toggleable
   rule inverted, decided by somebody else's manifest.

## Declared dependencies: `requires`

A permission declaration may name other codes a role holding it needs:

```ts
permissions: [
  { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
],
```

It is **advisory and costs nothing at runtime**. No guard reads it, no upsert is
refused, and it is not a lifecycle edge — it puts no module in anybody's
`dependencies`. What it does is put a sentence where an operator can read it: the
role editor shows the shortfall for the codes currently ticked, with a one-click
add, and a role saved without them is saved.

The example above is real. `RfqCreatePage` prefills an agreed price from a
`price_lists` route deliberately gated with `price_lists:read`, so a
role holding only `rfqs:handle` loses the prefill and falls back to manual entry.
That sentence was written in a ruling, in a route comment and in a seed, and in
nothing an operator could read.

**Do not write a derived fact here.** *A module enforces a code another module
owns* is the previous section's question, it is derived from the gates and the
manifests, and declaring it in a manifest as well would be two answers to one
question waiting to disagree. `requires` carries something no instrument in this
repository can work out: a coupling that runs from an admin screen's own fetches
to another module's route, plus the judgement of whether a role without the
second code is broken or merely degraded in a way somebody accepted.

What *is* machine-checked is that a requirement names a code the platform's
vocabulary holds — a typo, or a code its owner renamed, would otherwise advise an
operator forever to grant something that does not exist. That is
`backend/test/contract/admin_users/permission-inventory.test.ts`, in the same
file as the inventory's two-way sweep, because the inventory already reads every
manifest code and two derivations of one population are two answers waiting to
disagree.

A code more than one module declares takes the **union** of its declarers'
requirements: a shared code opens more than one surface, each with its own needs,
and advising more is the direction that cannot strand anybody.

## When the gate runs

A route declares its gate as a `preHandler` — `{ preHandler: requireAdmin('catalog:write'),
schema: { body } }` — and the platform runs it **before the request is validated**: the
`preHandler` chain a route declares in its own options is moved to that route's `preValidation`
phase when the route is registered. The order for one request is therefore:

1. `onRequest` — the session is resolved, the tenant scope and the sales channel are established,
   a switched-off module answers `503`, the rate limiter counts the request;
2. the body is parsed;
3. **the route's guards** — `401` without the session the route accepts, `403` without the
   permission;
4. the request is validated against the route's schema — `400 VALIDATION_FAILED`;
5. API interceptors, then the handler.

So a caller the route refuses is told `401` or `403` and nothing about the request shape, whatever
the request holds. Before this ordering the validator answered first, and an unauthenticated
caller could read an admin route's field names and constraints out of the `400`.

What that means for a guard you write yourself: it sees `request.params` and `request.query` as
the router produced them and `request.body` **parsed but not validated** — any JSON value, with no
coercion or default applied. Compare what you read against what you expect and abstain or refuse
on anything else. Work that needs the validated request belongs in the handler, in an
[API interceptor](./api-interceptor.md), or in a `preHandler` added with `addHook` on your own
plugin scope; none of those is moved.

**That last option now runs after the route's guards, where it used to run before them.** A
`preHandler` added with `addHook` stays in the `preHandler` phase while the route's own guards have
moved ahead of it, so anything such a hook puts on the request is no longer there when a route
guard reads it. Whatever a route guard depends on must be established in `onRequest` or
`preValidation` — an `addHook('preValidation')` on a plugin scope runs before the guards of the
routes inside it.

Two things still answer before any guard: a request the body parser refuses (malformed JSON, an
unsupported media type, a body over the limit) and a route that checks the session inside its
handler instead of declaring a guard — the schema of such a route is validated first. Declare the
guard.

## Adding a permission

Declare the code in your own module's `manifest.ts`, label it in your own module's
`i18n/en.json` and `i18n/pl.json` under `adminRoles.permission.<code>`, enforce it
with a `requireAdmin('…')` literal that matches exactly, and run

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
pnpm --filter backend run check:action-route-permissions
```

The first sweeps both directions — every enforced code is grantable, every
grantable code is enforced — plus label coverage and the `requires` declarations.
The second answers a question the two-direction sweep structurally cannot:
whether the code a palette action declares is the one enforced on that action's
own route.

## Organization permissions

An organization permission says what a **member of a customer Organization** may
do on the storefront: fill a cart, approve a colleague's cart, request a quote,
see the Organization's orders. Each Organization has **roles**, each member holds
exactly one, and a role is a set of these codes. The Organization's administrator
edits the roles on the storefront (`/organization/roles`); an operator can view
and repair them on the Organization's *Roles* tab in the Admin UI, with the admin
permissions `organizations:read-roles` and `organizations:manage-roles`.

The roles, the role cache, the permission port and the refusal belong to
`organizations`. The **codes** do not: each is declared by the module whose
buyer action it gates.

### The roles

| Role | Kind | What it holds |
| --- | --- | --- |
| *Administrator* | `administrator` | Every **present** code, including codes declared after the role was created. It cannot be edited, renamed or deleted, and it alone holds the reserved capabilities: managing members, invitations and roles, the Organization's two-factor policy and the Organization-wide one-click defaults. A custom role holding every code is still not the administrator. |
| *Member* | `member` | The default role of a new member. Its codes are editable; it cannot be renamed or deleted. A code declared `memberDefault: true` is held by *Member* from the moment its module is first offered to the Organization — and never granted again once an administrator has saved *Member* without it, through any module switch or reinstall (`member_defaults_offered` on the role row). |
| custom | `custom` | Exactly the codes ticked when it was saved. **A new custom role starts with none**: the storefront and Admin UI create forms open with every permission unchecked and offer no "copy from another role", and `memberDefault` is at most a hint there — it is granted to *Member* only. A role saved with nothing ticked allows nothing. Up to 50 per Organization. |

Both predefined roles are created with the Organization by a database trigger,
whichever path creates it.

**A personal (B2C) Organization's only member holds *Administrator***, on
every path that puts an account there — self-registration, federated sign-in,
`ensureForCustomerAccount` and the operator's detach. That is what lets a B2C buyer do everything a buyer can without a second rule. What a
personal Organization must not show — *Members*, *Roles*, *Carts to approve*,
the role line on the account page — is hidden because the Organization is
personal (`organization.isPersonal`), **never by reading the role**. Its member
and invitation routes answer as for any administrator; only its role
routes answer `404`.

### Declaring a code

A module declares its codes in its own `manifest.ts`, beside the operator
`permissions` field, which is untouched:

```ts
organizationPermissions: [
  {
    code: 'carts.approve',
    label: "Approve and reject colleagues' carts",
    description: 'See the carts of the organization and approve or reject the ones sent for approval.',
    memberDefault: false,
  },
],
```

- **The code is `<manifest id>.<action>`** in lower snake case
  (`ORGANIZATION_PERMISSION_CODE` in `packages/contracts/src/modules.ts`).
  `defineModuleManifest` refuses, when the manifest is defined, a code outside
  the module's own namespace and a code declared twice.
- **`label` and `description` are the English fallback.** The translations are
  in the module's own `i18n/en.json` and `i18n/pl.json`, under
  `organizationPermissions.<code>.label` and
  `organizationPermissions.<code>.description` — both keys, both languages.
- **`memberDefault`** decides whether *Member* receives the code when it is first
  offered, as above. Choose `true` for what every buyer could do before the code
  existed, so that adding the code changes nothing for anybody.

**A custom or overlay module declares its own codes**, in its own manifest and
namespace, exactly as a core module does (constitution XIV, XV): an overlay
module under `backend/src/apps/<deployment>/modules/<id>/` gates its buyer
action with `<id>.<action>`. It never adds a code to a core module's manifest,
and never reuses one: a code is declared by one module, and its prefix says
which.

The codes this release declares:

| Code | Declared by | *Member* holds it by default |
| --- | --- | --- |
| `carts.create` | `carts` | yes |
| `carts.approve` | `carts` | no |
| `carts.order_without_approval` | `carts` | yes |
| `quote_requests.create` | `quote_requests` | yes |
| `shopping_lists.create` | `shopping_lists` | yes |
| `shopping_lists.convert` | `shopping_lists` | yes |
| `quick_order.one_click` | `quick_order` | yes |
| `orders.view_organization` | `orders` | no |
| `addresses.manage` | `addresses` | yes |
| `returns.create` | `returns` | yes |
| `returns.view_organization` | `returns` | no |

Each module's own page says what its codes gate.

### Enforcing a code on a route

The route guard is `organizationPermissionPreHandler` from
`@endora-commerce/contracts` (`packages/contracts/src/organization-roles.ts`),
declared after `requireCustomer`:

```ts
// In the module's composition: a proxy that resolves the port on every call.
const permissions = lazyPort<OrganizationPermissionPort>(ctx, 'organizationPermissionPort');

// In its routes (the `carts` module's `routes.organization.ts`):
const approver = [requireCustomer, organizationPermissionPreHandler(() => permissions, 'carts.approve')];
app.post('/api/v1/organization/carts/:id/approve', { preHandler: approver }, handler);
```

- **The port is reached through a thunk, on every request** — never captured
  into a singleton at registration.
- **A customer actor is judged**, impersonation included: the guard builds the
  subject from `request.actor` (`customerAccountId`, `organizationId`,
  `organizationRoleId`) and calls `assert` in the response language.
- **`guests`** decides what happens to a request without a customer.
  `'refuse'`, the default, answers `401 UNAUTHORIZED`. `'pass'` lets it through
  **unjudged**, and is only for routes that admit a guest today: the guest
  basket's line and coupon routes in `carts`. An anonymous
  visitor keeps the guest basket exactly as before roles existed.
- **A composite action is two guards**, never a combined code: converting a
  shopping list into a cart is `shopping_lists.convert` and then `carts.create`,
  and the refusal names the first one missing.
- **An either-of action is a module-local guard.** The quick-order import
  previews a file that may become a cart or a quote request, so it admits
  `carts.create` **or** `quote_requests.create`.
  `importPermissionPreHandler` in the `quick_order` module's `routes.ts` builds the subject as the shared guard does, asks `can` for each code in
  turn, and when neither holds calls `assert` with the first, so the refusal
  keeps its one shape. The build that follows is judged by its target alone.

The refusal is the same everywhere:

```json
HTTP/1.1 403
{ "error": {
    "code": "ORGANIZATION_PERMISSION_REQUIRED",
    "message": "Your role does not allow this: “Create quote requests”.",
    "details": { "permission": "quote_requests.create", "permissionLabel": "Create quote requests" } } }
```

It is distinct from `401` (not signed in), `503 MODULE_DISABLED` (the module is
off; its own seam answers first) and `404`. **Reach is answered with `404`, not
`403`:** a colleague's order without `orders.view_organization`, another
Organization's role, a case the member may not see — each answers as an id that
does not exist (constitution XI).

### Asking inside a service

`organizationPermissionPort` (owner: `organizations`) answers the questions a
guard cannot:

| Method | Use |
| --- | --- |
| `can(subject, code)` | A yes/no for a call to action or a widened read, e.g. whether the orders list reaches colleagues' orders |
| `assert(subject, code, { language })` | The guard's refusal, from inside a service — the quick-order build judges its body's target this way |
| `isAdministrator(subject)` | The reserved capabilities, which follow the role **kind**, not a code |
| `effective(subject)` | The member's role and sorted present codes — what the session views carry as `permissions` |
| `rolesHolding(organizationId, code)` | The role ids whose effective set holds a code, *Administrator* included — e.g. who receives the "cart sent for approval" e-mail |

`organizationRoleReadPort` answers role facts: `predefinedRoleId(organizationId,
kind)` for an Organization's *Administrator* or *Member*, `findRole` and
`roleRef` for a role named by id (`null` for another Organization's role). It
reads committed rows; a caller that has just created the Organization in its own
open transaction takes the *Administrator* id from the provisioning answer
instead.

Both are reached with `lazyPort` and a string-literal name. A subject whose role
cannot be found fails **closed**: `can` and `isAdministrator` answer `false`,
`effective` an empty set. A code outside the vocabulary is a programming error:
`can` answers `false`, `assert` throws `500`. Roll-up (a head-office login
acting across its subtree) widens where a code reaches; it never adds a code.

Role changes apply on the member's next request. Each process caches an
Organization's roles for at most 30 seconds and drops the entry when any
process announces a change; assignments are not cached.

### Code arguments the inventory can read

`backend/test/contract/admin_users/permission-inventory.test.ts` holds the
organization vocabulary to the same two-way sweep as the admin one (its
`[organization-permissions]` block; the scanner is
`backend/test/helpers/organization-permissions.ts`). It reads every
`organizationPermissionPreHandler(…, code)` and every `can`, `assert` and
`rolesHolding` member call in a file that names the port, in core modules,
module packages and the active overlay, and reports:

| Finding | Meaning |
| --- | --- |
| `cross-vocabulary` | a string declared as both an admin and an organization code |
| `foreign-declarer` | a code whose prefix is not its declaring module |
| `undeclared-check` | a code a guard or a port call names that no manifest declares |
| `unchecked-declaration` | a declared code nothing enforces — a grant that grants nothing |
| `missing-label` / `split-label` | a code without its label or description in English, or in one shipped language and not the other |
| `unresolved-argument` | a code argument the scanner cannot read |

So **write the code argument in a form the scanner resolves**: a string literal;
a module-local `const` bound to one; a `const` in a file imported by a relative
path; or a member `NAME.key` of a `const` object literal of such strings. A code
computed at run time, imported through a package specifier or built from a
template with an interpolation is `unresolved-argument`, and the test is red. An
implementation that forwards its own typed parameter (the port's `assert`
calling `this.can(subject, code)`) is a runtime value, not a site; its caller is
checked instead. Run it with:

```bash
pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts
```

### On the storefront

`storefront/lib/organization-permissions.ts` is the storefront's one reading of
the role: `can(session, code)` for a buyer action and `isAdministrator(session)`
for the organization-management screens, over the `permissions` and
`organizationRole` that `GET /api/v1/me` carries. Both are **presentation
only** — the backend's guards are the boundary, and an action shown that the
server refuses is the safe failure. What a member lacks is hidden or disabled,
or a page says why in one line (*"Your role does not allow changing the
cart…"*). A signed-out visitor is not judged at all: add-to-cart and cart
editing stay offered. `storefront/lib/commerce-permissions.ts` spells the
commerce rules once over `can`; `storefront/lib/account/organization-area.ts`
decides the *Members*, *Roles* and *Carts to approve* screens, by role and by
`isPersonal`.

### When a module is switched off

A code whose declaring module is not present — on either axis, platform
availability or operator activation — **leaves the catalogue**: the role editors
do not list it, nobody holds it (*Administrator* included) and it is not in any
member's `permissions`. **Grants are kept.** A save cannot drop what the editor
could not show, so when the module comes back every role holds exactly what it
held before. The module's own routes answer `503 MODULE_DISABLED` meanwhile. A
code that no installed module declares any more — its module was uninstalled —
is ignored when reading and dropped from a role the next time that role is saved.

### A rule for module authors: only the filer acts on a return case

`returns.view_organization` lets a member **read** colleagues' returns and
complaints; it never lets them act on one. Commenting,
attaching files, choosing the return delivery method and cancelling stay with
the member who filed the case, whatever anyone else's permissions.

Any future control on a return case — a new follow-up action, an attachment
type, a delivery option, a way to withdraw — must apply the same rule:

- **Backend:** look the case up by `{ id, customerAccountId }` of the caller, as
  the existing follow-up services do, and answer anyone else `404 NOT_FOUND`.
  Do not widen it through the `returns` module's read scope
  (`return-case-scope.ts`), which is for the list and the detail only.
- **Storefront:** offer the control only when
  `filedByColleague(case.customerAccountId, viewerId)` is false
  (`storefront/lib/returns/returnForm.ts`); on a colleague's case the detail page
  shows its one-line read-only note instead.

A new code that would let somebody act on a colleague's case is a product
decision, not an implementation detail: decide it in the specification first.
