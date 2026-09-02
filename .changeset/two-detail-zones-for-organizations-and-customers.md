---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-sales-channels': minor
---

Two detail-screen zone members, four contributors, and the end of two live component
duplications.

`@endora-commerce/contracts` adds two members to `AdminZoneNameSchema`, each with its entry
in `AdminZonePropsMap`:

| Member | Props | Rendered by |
| --- | --- | --- |
| `organization.detail.after` | `OrganizationDetailZoneProps { organizationId }` | the end of the organization detail screen, **once** |
| `customer.detail.after` | `CustomerDetailZoneProps { customerId }` | the end of the customer detail screen, **once** |

`OrganizationDetailZoneProps` and `CustomerDetailZoneProps` are new exported interfaces. The
second is not an alias of the first: the prop is named for the entity the mount carries, and
the two members are two places.

**One mount per screen is a rule, not a layout choice.** Neither member carries a prop that
could tell two mounts apart, so a second mount of either renders every contribution twice
and nothing in the renderer can distinguish them.

`@endora-commerce/mod-quick-order` gains an `./admin` subpath — its first — with two zone
contributions and `DefaultPreferencesPanel`, which moves into the package. The panel's two
preference calls are rebuilt from the published `apiClient`; `quick-order-client.ts` stays in
the admin application, where the on-behalf-of screen still uses it.

```tsx
// Both contributions declare `orders:write`, which is the code every admin
// route this module owns enforces. There is no `quick_order:*` permission.
zoneComponent('organization.detail.after', () => import('./zones/OrganizationDefaults.js'), {
  weight: 300,
  requiredPermission: 'orders:write',
});
```

`@endora-commerce/mod-carts` gains its first zone contribution and a new route,
`GET /api/v1/admin/organizations/:id/cart-approval-policy`, gated on `customers:manage` and
answering `cartApprovalPolicyResponseSchema` — the same code and the same shape as the
`PATCH` that has been there since feature 027. `CartApprovalService` gains `getPolicyByAdmin`.
The contribution reads its own initial state through that route instead of taking the
`initialRequiresCartApproval` prop the old panel took, because a zone's props cannot carry a
value only one of four contributors wants.

That panel had been imported by nothing, and the copy it rendered was in no bundle under any
spelling — `t('carts.policy.title')` under the `carts` namespace resolves to
`bundle['carts']['carts.policy.title']`, which never existed. Ten `policy.*` keys are added to
this package's own bundle in both shipped languages, and the capability reaches an operator
for the first time.

`@endora-commerce/mod-price-lists` and `@endora-commerce/mod-sales-channels` each gain a
second contribution over a component they already ship, and each loses its duplicate:
`DisplayModeOverrideRow` and `EntityChannelMembership` existed twice in the tree for the
length of the previous release, because the organization detail screen still imported the
`admin/src` copy. Both copies are gone and nothing imports them.

**Operator-visible copy change.** The organization detail's pricing card is now
`price_lists`' own: the screen used to pass `organizations.detail.pricingLabel` and
`organizations.detail.pricingHint` into a control it does not own and wrap it in a card
titled `organizations.detail.pricingCard`. A host cannot hand copy to a contributor it does
not know, so the control renders `priceLists.displayMode.rowLabel` and its own hint, and all
three host keys are removed from the `core` bundle in both languages. Two further `core` keys
go with them — `priceLists.linked.displayModeLabel` and `priceLists.linked.displayModeHint`,
which the previous release left unread.

No contribution declares a `match`, and each says why in its own file: `match` narrows the
mounts of one place, and each of these members has one host and one mount. Every zone test
asserts it absent.
