# Contract: the `organizationPermissions` manifest field

**Normative for**: every module that gates a buyer action (WP-01 adds the field; WP-04–WP-07 and
P3 declare codes). Decisions: research R-1, R-2, R-17, R-31.

## 1. Schema — `packages/contracts/src/modules.ts`

Added to `ModuleManifestSchema` beside `permissions` (the operator field, which is untouched):

```ts
export const ORGANIZATION_PERMISSION_CODE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export const moduleOrganizationPermissionDeclarationSchema = z
  .object({
    code: z.string().regex(ORGANIZATION_PERMISSION_CODE),
    label: z.string().min(1).max(160),       // English fallback
    description: z.string().min(1).max(500), // English fallback, one sentence
    memberDefault: z.boolean(),
  })
  .strict();

// in ModuleManifestSchema:
organizationPermissions: z.array(moduleOrganizationPermissionDeclarationSchema).optional(),
```

`defineModuleManifest` refuses, at definition time, a declaration whose `code` does not start with
`<manifest.id>.`, and a duplicate `code` inside one manifest.

## 2. Translations

In the declaring module's own `i18n/en.json` and `i18n/pl.json` (flat maps, package root):

```json
"organizationPermissions.carts.create.label": "Create and edit carts",
"organizationPermissions.carts.create.description": "Add products to a cart, change quantities, apply coupons and build carts from quotes, lists and quick order."
```

Both languages, both keys, for every declared code. `check:bundle-pairing` already refuses a
module shipping one bundle file without the other; the key-level check is §4.

## 3. Declarations this feature adds

| Module | `manifest.ts` | Codes |
| --- | --- | --- |
| `carts` | `packages/modules/carts/src/manifest.ts` | `carts.create` (default), `carts.approve`, `carts.order_without_approval` (default) |
| `quote_requests` | `packages/modules/quote_requests/src/manifest.ts` | `quote_requests.create` (default); P3: `quote_requests.approve`, `quote_requests.send_without_approval` (default) |
| `shopping_lists` | `packages/modules/shopping_lists/src/manifest.ts` | `shopping_lists.create` (default), `shopping_lists.convert` (default) |
| `quick_order` | `packages/modules/quick_order/src/manifest.ts` | `quick_order.one_click` (default) |
| `orders` | `packages/modules/orders/src/manifest.ts` | `orders.view_organization` |
| `addresses` | `packages/modules/addresses/src/manifest.ts` | `addresses.manage` (default) |
| `returns` | `packages/modules/returns/src/manifest.ts` | `returns.create` (default), `returns.view_organization` (OR-11, WP-14; the manifest also adds `organizations` to `dependencies`, R-41) |

Labels (EN) are FR-022's table; the PL labels are written by the declaring work package and
reviewed by the product owner.

## 4. The inventory — `backend/test/contract/admin_users/permission-inventory.test.ts`

A new `describe` block (`[organization-permissions] read: files=… sites=… sources=manifest-index:…`,
the estate's disclosure grammar), with the generated manifest index as the independent author, red
on each of:

| Finding | Meaning |
| --- | --- |
| `cross-vocabulary` | a string declared both as an operator code and as an organization code (FR-020) |
| `foreign-declarer` | an organization code whose prefix is not its declaring module (R-2) |
| `undeclared-check` | a literal passed to `organizationPermissionPreHandler`, `can`, `assert` or `rolesHolding` that no manifest declares |
| `unchecked-declaration` | a declared code no route guard or service call names (grantable ⇒ enforced) |
| `missing-label` / `split-label` | a code without its `label` / `description` key in `en`, or in one shipped language and not the other |

The scanner reads the code argument as a literal or a resolvable constant and **fails** on one it
cannot resolve, as the operator half does (`specs/conventions/module-admin-surfaces.md` item 3). It
extends this file rather than adding a `check-*` script, on item 6's reasoning: it is already the
instrument that answers "is this code declared, enforced and labelled", for the other vocabulary.

## 5. Not here

- No operator `permissions` entry is added for organization codes — the two vocabularies never
  meet (FR-020).
- No palette action: organization permissions have no admin surface of their own.
