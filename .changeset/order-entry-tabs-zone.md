---
'@endora-commerce/contracts': minor
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quick-order': minor
---

Added the `order.entry.tabs` admin zone, and `<RouteTabsZone>` — the renderer that makes a
zone a tab strip.

`@endora-commerce/contracts` gains the enum member `'order.entry.tabs'` and the props type
`OrderEntryTabsZoneProps`, which is empty: the contributions *are* the tabs, so the mount has
no identifier to pass. `AdminZonePropsMap` gains the matching entry, so a host writing
`<RouteTabsZone name="order.entry.tabs" props={{}} />` is type-checked against it exactly as
an `<AdminZone>` mount is.

`@endora-commerce/admin-kit` gains two exports:

- `RouteTabsZone` on `./zones` — `{ name, props, className? }`. It renders the strip chrome
  and delegates the contributions to `<AdminZone>`, so the lazy-component cache, the
  per-contributor error boundary and the `weight` ordering are unchanged. **It renders
  nothing at all when fewer than two contributions survive presence and permission**: one tab
  is not a choice. The floor is a constant rather than a prop, deliberately — two is a
  property of tab strips, and a `minimum` prop would let a caller ask for the thing the rule
  refuses.
- `RouteTabLink` on `./ui` — `{ to, label }`, the tab a contribution renders. It decides its
  own selected state, because in a contributed strip no component sees the whole set. That
  costs `RouteTabs`' *longest-wins* tie-break: two contributed tabs whose paths are prefixes
  of one another would both read as selected. `RouteTabs` itself is unchanged and is still
  the primitive to use whenever one component knows every tab.

`@endora-commerce/mod-orders` gains an `./admin` subpath — its first — contributing the
*Standard order* tab at weight 100. `@endora-commerce/mod-quick-order` gains the *Quick
order* tab at weight 200. Both are gated on `orders:write`, which is the code their routes
enforce. Each label now ships in its own module's bundle
(`orderEntry.tab.standard`, `orderEntry.tab.quick`) instead of the shared `core` one.

**If you were rendering `OrderEntryTabs` from the admin application**, it is gone. It knew
both module ids and both routes and belonged to neither module; mount the zone instead:

```diff
-import { OrderEntryTabs } from '@/components/OrderEntryTabs';
-<OrderEntryTabs />
+import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
+<RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />
```
