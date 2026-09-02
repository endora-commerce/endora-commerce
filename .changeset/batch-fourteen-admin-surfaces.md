---
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-i18n': minor
---

`customers`, `organizations` and `sales_channels` ship their admin screens, and two icon names
join the allowlist.

**Three packages' `./admin` subpath gains `routes` and `nav`, and two of them gain the subpath
itself.** `@endora-commerce/mod-sales-channels/admin` already exported `contributions` with a
`zones` array and nothing else; it now declares its screens there too. `@endora-commerce/mod-customers`
and `@endora-commerce/mod-organizations` had no `./admin` subpath at all and now declare one.
Eight routes and six sidebar entries between them, at the paths and codes the hand-written host
registrations carried. The exported symbol is the same one every other module package uses —
`contributions`, an `AdminContributions` object, and nothing else — so a consumer already
reading `sales_channels`' zones needs no edit.

- `@endora-commerce/mod-customers` — **new `./admin` subpath**, exporting `contributions`.
  `/customers` (the landing route), `/customers/online` and `/customers/:id`, all on
  `customers:read`, which is the code every `GET` behind them enforces; the detail screen keeps
  gating its block, unblock, impersonate, delete and restore controls on `customers:manage`
  inside itself. Two sidebar rows, in the `customers` section at weights 100 and 200. The detail
  screen is reached from the roster and has no row of its own. `CustomerDetail` renders the
  `customer.detail.after` zone, which is unchanged.
- `@endora-commerce/mod-organizations` — **new `./admin` subpath**, exporting `contributions`.
  `/organizations` and `/organizations/:id`, both on the **any-of pair**
  `['customers:read', 'customers:manage']`, which is what
  `requireAdminAny(['customers:read', 'customers:manage'])` enforces on every organization
  endpoint. `AdminNavDeclaration.requiredPermission` and `AdminRouteDeclaration.requiredPermission`
  both take a `PermissionRequirement`, so the pair is declared rather than collapsed: naming only
  the read code hides the screen from a role holding just `customers:manage`. One sidebar row, in
  the `customers` section at weight 300. `OrganizationDetail` renders the
  `organization.detail.after` zone — four modules contribute there — and that is unchanged.
- `@endora-commerce/mod-sales-channels` — `/sales-channels` and `/sales-channels/:code` on
  `sales_channels:read`, and `/sales-channels/new` on `sales_channels:write`. **That last one is a
  behaviour change for a consumer rendering these routes**: the create form is a screen whose only
  purpose is a write, `POST /api/v1/admin/sales-channels` enforces `sales_channels:write`, and the
  module's own `new-sales-channel` palette action already advertised that code. It was ungated
  while the route was the admin application's, so an operator holding only `sales_channels:read`
  could open a form whose save then refused; the roster's *+ New channel* button is gated on the
  same code in this release, so the dead end is closed at both ends. `credentials` ships the
  identical split for `/credentials/new`. One sidebar row, in the `channels` section at weight 100.
  `SalesChannelEditPage` renders the `sales_channel.editor.after` zone, which is unchanged.

**`@endora-commerce/contracts` — two members join `KnownIconNameSchema`: `Building2` and
`Store`.** They are the glyphs the admin application drew for `/organizations` and
`/sales-channels` by hand. A contribution names its icon rather than importing it, so a name that
is not on the allowlist degrades to the fallback; adding them is what keeps the two rows looking
as they did. Widening an enum is additive for a consumer validating against it and breaking for
one exhaustively switching over `KnownIconName` — there is no such consumer in this repository.

**`@endora-commerce/admin-kit` — `resolveIcon` answers for both new names.** `ICON_MAP` gains
`Building2` and `Store`; the function's signature is unchanged and every existing name resolves
exactly as before.

**`@endora-commerce/mod-customers`, `@endora-commerce/mod-organizations` and
`@endora-commerce/mod-sales-channels` ship new i18n keys, and `@endora-commerce/mod-i18n` loses
six.** `nav.customers.label`, `nav.customersOnline.label`, `nav.organizations.label`,
`nav.salesChannels.label` and the two new actions' `label`/`description` pairs are in the three
modules' own `i18n/{en,pl}.json`; `appShell.nav.customers`, `appShell.nav.customersOnline`,
`appShell.nav.organizations`, `appShell.nav.salesChannels`,
`appShell.palette.sub.customerAccounts` and `appShell.palette.sub.storefrontChannels` are removed
from the shared bundle in both shipped languages, nothing rendering them any more. **A consumer
resolving one of those six keys out of the `core` namespace will get a raw key**; each has a
module-namespaced replacement above.

**`organizations` and `sales_channels` declare a new palette action each.**
`open-organizations` (`/organizations`, `customers:read`) and `open-sales-channels`
(`/sales-channels`, `sales_channels:read`) replace hand-written rows in the admin's own palette
table — copies the server was never asked about, which went on advertising the screens whatever
the effective enabled-set said. One narrowing comes with `open-organizations`:
`ModuleActionSchema.requiredPermission` is a single string, so it names `customers:read` and a
role holding only `customers:manage` loses the palette entry while keeping the sidebar one.
