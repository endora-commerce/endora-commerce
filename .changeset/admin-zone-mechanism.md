---
'@endora-commerce/contracts': major
'@endora-commerce/admin-kit': minor
---

Admin zones are usable: a props contract at both ends, `match`, and a `./zones` renderer.

**Breaking, `@endora-commerce/contracts`.** `AdminZoneNameSchema` no longer carries
`order.detail.tabs`, `delivery_method.row.actions`, `payment_method.row.actions` or
`product.editor.sidebar.after`. All four were rendered by no host and contributed to by
no module — measured — and the new `check:admin-zones` reports a member nothing renders
as `unrendered-zone` with no ledger to record it in. The three members that replace them
are the three places a host actually mounts:

```diff
-AdminZoneNameSchema.parse('product.editor.sidebar.after')
+AdminZoneNameSchema.parse('product.editor.details.before')
+AdminZoneNameSchema.parse('product.editor.pricing.before')
+AdminZoneNameSchema.parse('product.editor.field.after')
```

**If you named one of the four removed members**, there is no drop-in replacement: a zone
name is a place, and each of the four described a place that either does not exist
(`product.editor.sidebar.after` — the product editor has no right-hand sidebar) or has no
mount yet. The batch that renders your place adds the member with the mount, in one merge
request; that is the rule the removals establish.

New in `@endora-commerce/contracts`:

- `AdminZonePropsMap`, `AdminZoneProps<Z>` and the props interfaces
  `ProductEditorZoneProps` / `ProductEditorFieldZoneProps`. The map is declared as
  `Record<AdminZoneName, object>`, so a zone member without a props type is a compile
  error in the package itself.
- `match` on `AdminZoneContributionSchema` —
  `Record<string, string | readonly string[]>`, optional. The renderer includes a
  contribution when every key agrees with the mount's props, and it decides that
  **before** `React.lazy`, so a contributor that serves two of a zone's mounts is not
  downloaded on the rest.

New in `@endora-commerce/admin-kit`:

- A `./zones` subpath — `AdminContributionsProvider`, `useAdminZone(name, props)`,
  `<AdminZone name props />`, `ZoneErrorBoundary`, and the pure
  `selectZoneContributions` / `matchesZoneProps`. Presence, permission and `match` are
  filtered at enumeration, so an operator's activation flip needs no rebuild; each
  contribution gets its own error boundary and `Suspense`.
- `zoneComponent(zone, load, options?)` and `AdminZoneComponent<Z>` on
  `./contributions` — the contributor's end of the props map, which is what constrains a
  module's default export to the zone it names.

```ts
// host
<AdminZone name="product.editor.field.after"
           props={{ productId, fieldPath: 'name', languageCodes: LOCALES }} />

// contributor, in src/admin/index.ts
zoneComponent('product.editor.field.after', () => import('./FieldProtection.js'), {
  weight: 10,
  requiredPermission: 'catalog:write',
})
```

`./zones` is a separate subpath from `./contributions` on purpose: the second is
data-only and is what a module's declaration file imports, and one subpath would let a
declaration file import a component.
