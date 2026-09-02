---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-i18n': minor
---

`catalog` and `orders` ship their admin screens, and one icon name joins the allowlist.

**`@endora-commerce/mod-catalog` gains an `./admin` subpath and `@endora-commerce/mod-orders`
gains routes and nav on the one it had.** `catalog`'s new entry point exports `contributions`
with eight `routes` and six `nav` declarations — the product roster and editor, the category
tree, the attribute and attribute-set registries, the attachment types and the two
bulk-operation screens. `orders`' entry point exported `contributions` with a `zones` array and
nothing else since P4d; it now declares four routes and three nav entries beside it. A consumer
that composes either package's `./admin` gets those screens without editing an application file.

**`@endora-commerce/mod-catalog` declares three new manifest actions**: `open-products`,
`open-categories` and `open-attributes`, each with the destination, permission code and keywords
the admin's hand-written palette row carried, and with the labels and descriptions those rows
rendered. `@endora-commerce/mod-orders`' manifest is unchanged — its palette row duplicated the
`open-orders` action it had declared all along.

**`@endora-commerce/contracts` adds `'ClipboardCheck'` to `KnownIconNameSchema`** and
`@endora-commerce/admin-kit` adds the matching entry to `resolveIcon`'s map. A module
declaration names its icon rather than importing it, and `orders`' three sidebar rows render
that glyph.

**Breaking for a consumer that imports these two modules' screens from the admin application.**
Twenty-seven files moved out of `admin/src/modules/{catalog,orders}/` and four re-export shims
were deleted with them:

- `admin/src/modules/catalog/components/ProductPicker` — import `ProductPicker` from
  `@endora-commerce/admin-kit/components`.
- `admin/src/modules/orders/Section` — import `Section` from `@endora-commerce/admin-kit/ui`.
- `admin/src/modules/orders/StatusTransitionGraph` — import `StatusTransitionGraph` from
  `@endora-commerce/admin-kit/components`.
- `admin/src/modules/orders/orderStatusColor` — `ORDER_STATUS_COLOR_PRESETS` and
  `ORDER_STATUS_DEFAULT_COLOR` are `@endora-commerce/contracts`'; `readableTextColor` and
  `statusBadgeStyle` (which that file also re-exported as `orderStatusBadgeStyle`) are
  `@endora-commerce/admin-kit/lib`'s.

**`@endora-commerce/mod-i18n` drops fifteen keys** — nine `appShell.nav.*`, four
`appShell.palette.sub.*`, `appShell.nav.quickOrder` and `appShell.crumb.detail` — from the
shared bundle in both shipped languages, nothing rendering them any more. Their replacements are
module-relative keys in `@endora-commerce/mod-catalog`'s and `@endora-commerce/mod-orders`' own
bundles.

**One route tightens.** `/orders/new` was declared by the admin application and therefore
ungated, while the sidebar row that advertised it carried `orders:write`; the route is
`@endora-commerce/mod-orders`' own now and takes that code. A read-only operator who could
previously open an order-entry form whose save would refuse now meets the admin's not-found
treatment instead.
