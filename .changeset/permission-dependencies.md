---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-roles': minor
'@endora-commerce/mod-admin-users': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-i18n': minor
---

A permission declares what it depends on, and a catalogue row says who owns it.

**`@endora-commerce/contracts`.** `modulePermissionDeclarationSchema` gains an
optional `requires: string[]` — the codes a role holding this one also needs
before the surface it opens is whole. It is advisory: no guard reads it, no role
upsert is refused, and it is **not** a lifecycle edge, so declaring it does not
put the named code's owner into your module's `dependencies` and does not stand
in the way of an operator switching that owner off.

```ts
// packages/modules/<id>/src/manifest.ts
permissions: [
  { code: 'rfqs:handle', label: 'Handle quote requests', requires: ['price_lists:read'] },
],
```

`permissionCatalogueEntrySchema` — the row `GET /api/v1/admin/permissions`
returns, and the return type of `PermissionCataloguePort.listAssignable()` —
gains `owners: string[]` (required) and `requires?: string[]`. `owners` is the
set of modules whose presence keeps the code grantable, and it is **not** the
existing `module` field, which is a display grouping: `_lifecycle` files its
codes under `module: 'module_lifecycle'`, which is no module id, and a shared
code such as `integrations:manage` has two owners and one grouping.

Readers need no change — the two fields are additive on the wire. **If you
construct a `PermissionCatalogueEntry`** (a test double, a second implementation
of `PermissionCataloguePort`), add `owners`:

```ts
// before
const row: PermissionCatalogueEntry = { code: 'blog.read', module: 'blog', label: 'View' };
// after
const row: PermissionCatalogueEntry = {
  code: 'blog.read', module: 'blog', label: 'View', owners: ['blog'],
};
```

New export `missingPermissionRequirements(granted, catalogue)`: the codes a role
holding `granted` is advised to add, over the catalogue rows the platform
already merged. It skips a requirement naming a code the given rows do not
offer, and advises a `'*'` role nothing. It exists so that the role editor and
the permission inventory read one function rather than two.

**`@endora-commerce/mod-admin-roles`.** `PermissionCatalogueService` puts
`owners` and `requires` on every row it merges, unions `requires` across every
declarer of a shared code, and gains `listRequirementsByCode()`.

**`@endora-commerce/mod-admin-users`.** The role editor renders the shortfall for
the codes currently ticked, with a one-click add, and shows a row's owner set
wherever it says something the display grouping does not.

**`@endora-commerce/mod-quote-requests`.** Declares `rfqs:handle` with
`requires: ['price_lists:read']` — the RFQ create screen prefills a price from a
`price_lists` route, so a role holding only `rfqs:handle` falls back to manual
entry.

**`@endora-commerce/mod-i18n`.** Six `adminRoles.*` keys for the above, in both
shipped languages.
