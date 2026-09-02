---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-sales-channels': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-catalog': patch
---

Four zone members for the category editor, the product editor and the sales-channel editor.

`@endora-commerce/contracts` adds four members to `AdminZoneNameSchema`, each with its
entry in `AdminZonePropsMap`:

| Member | Props | Rendered by |
| --- | --- | --- |
| `category.editor.after` | `CategoryEditorZoneProps { categoryId }` | the category editor's form, after its save/cancel row |
| `product.editor.pricing.after` | `ProductEditorZoneProps` (reused) | the end of the product editor's Pricing tab |
| `product.editor.channels` | `ProductEditorZoneProps` (reused) | the body of the product editor's Channels tab |
| `sales_channel.editor.after` | `SalesChannelEditorZoneProps { channelId }` | below the sales-channel editor's identity form |

`CategoryEditorZoneProps` and `SalesChannelEditorZoneProps` are new exported interfaces.
`ProductEditorZoneProps` is reused for the two product members rather than aliased: a props
type is the shape the mount carries, and two places in one editor that both carry a product
id carry the same shape.

```tsx
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';

// A tab whose body is a zone shows its button by counting the zone, never by
// naming the module that fills it.
const contributions = useAdminZone('product.editor.channels', { productId });
// …
<AdminZone name="product.editor.channels" props={{ productId }} />;
```

`@endora-commerce/mod-price-lists` gains an `./admin` subpath declaring two zone
contributions — `category.editor.after` and `product.editor.pricing.after`, both at
`price_lists:read` — and takes `DisplayModeOverrideRow` and `LinkedPriceListsPanel` with it.

**`DisplayModeOverrideRow` loses its `label` and `inheritHint` props**, and that is a copy
change an operator will see. A host cannot hand its own wording to a contributor it does not
know, so the control renders `priceLists.displayMode.rowLabel` in every place it appears.
Two screens read different words than before: the category editor, which passed `catalog`'s
`categories.priceDisplayMode.label` / `.help` (both keys are removed from `catalog`'s
bundle — hence its `patch`), and the product editor's Pricing tab, which passed this
module's own `priceLists.linked.displayModeLabel` / `.displayModeHint`. Those two `core`
keys are now read by nothing; they are left in place because the same props are still passed
by `organizations`' detail screen, whose conversion is a separate merge request.

`@endora-commerce/mod-sales-channels` gains an `./admin` subpath declaring one contribution,
`product.editor.channels` at `sales_channels:read`, and takes `EntityChannelMembership` with
it. Its four calls are rebuilt from the published `apiClient` rather than moving
`sales-channels-client`, so the package reaches nothing in the admin application.

`@endora-commerce/mod-inventory` gains an `./admin` subpath declaring one contribution,
`sales_channel.editor.after` at `inventory:read`, and takes the panel formerly at
`admin/src/modules/warehouses/ChannelMembershipPanel.tsx`. Its own
`isVisible({ module: 'inventory', requiredPermission: 'inventory:read' })` gate is gone —
the zone renderer applies presence and that code before the chunk is fetched — while the
`inventory:write` half stays, because a contribution declares one code and the panel offers
a read view and write actions behind two.

No contribution declares a `match`: each names a member exactly one host mounts, and `match`
narrows the mounts of one place.
