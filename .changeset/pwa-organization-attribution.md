---
'@endora-commerce/mod-pwa': minor
---

`pwa` gains `organization_id` on `push_subscriptions`, stamps it on every owned
write, clears it with the account, and refuses a row that names a customer
account without one.

`PushSubscription` gains an `organizationId` property and the
`push_subscriptions` table gains a nullable `organization_id` column, a partial
index on it, and
`check ("customer_account_id" is null or "organization_id" is not null)`. The
migration first derives the missing organisation from the account that owns each
subscription, then refuses — with the count and up to twenty ids, deleting
nothing — anything it could not derive. Unlike `comparisons`, this table carries
**no foreign key** on `customer_account_id`, so that refusal is a branch a real
database can reach.

**What changes for a reader.** `PushSubscription` is `@CustomerScoped`, and the
tenant filter's `allowed-set` arm consults the ORM's metadata for this column per
query: an administrator whose authority is a set of organisations saw **no**
subscribed device at all while the column was absent, and now sees the devices of
the organisations they are assigned to. `GET /api/v1/admin/pwa/subscriptions`
counts accordingly. The `meta.scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING'`
disclosure that explained that emptiness is no longer emitted for this table — it
was keyed on the column's absence and retires with it. An **anonymous** device
carries no organisation and is therefore outside every scoped administrator's
reach; who such a device belongs to is an open product question and is not
answered here.

**What changes for a writer.** `PushSubscriptionService`'s constructor takes a
`CustomerAccountReadPort` as its second argument — required, not optional — and
`register` resolves the owning account's organisation before it touches the row.

```diff
-new PushSubscriptionService(emFactory)
+new PushSubscriptionService(emFactory, customerAccounts)
```

`register` is an upsert on `endpoint`, and the account and the organisation now
move **together in both directions**: signing in on a subscribed device stamps
both, and re-subscribing that same device with no session clears both. That
second direction is not held by the constraint — an implication says nothing
about a row with no account — so it is held by the service writing both columns
from one resolved owner value, and by a test. `revoke`, `prune` and
`statsForChannel` are unchanged.

**What can break.** An insert or update that sets `customer_account_id` without
setting `organization_id` now fails with a check violation. A fixture or an
external writer that builds a subscription by hand is the case to look at.

The constraint is an **implication**, not an equivalence: an anonymous device is
a representable state (FR-023) and carries no organisation. No foreign key is
added.
