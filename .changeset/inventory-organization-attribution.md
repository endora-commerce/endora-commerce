---
'@endora-commerce/mod-inventory': minor
---

`inventory` gains `organization_id` on `availability_notifications`, stamps it on
the one write that owns a row, and refuses a row that names a customer account
without one.

`AvailabilityNotification` gains an `organizationId` property and the
`availability_notifications` table gains a nullable `organization_id` column, an
index on it, and
`check ("customer_account_id" is null or "organization_id" is not null)`. The
migration first derives the missing organisation from the account that owns each
subscription, then refuses — with the count and up to twenty ids, deleting
nothing — anything it could not derive. Like `push_subscriptions` and unlike
`comparisons`, this table carries **no foreign key** on `customer_account_id`, so
that refusal is a branch a real database can reach.

**What changes for a reader.** `AvailabilityNotification` is `@CustomerScoped`,
and the tenant filter's `allowed-set` arm consults the ORM's metadata for this
column per query: an administrator whose authority is a set of organisations saw
**no** back-in-stock subscription at all while the column was absent, and now
sees the subscriptions of the organisations they are assigned to.
`GET /api/v1/admin/inventory/availability-notifications` lists accordingly. The
`meta.scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING'` disclosure that explained
that emptiness is no longer emitted for this table — it was keyed on the column's
absence and retires with it. An **anonymous** subscription carries no
organisation and is therefore outside every scoped administrator's reach; who
such a row belongs to is an open product question and is not answered here.

**What changes for a writer.** `AvailabilityNotificationService`'s constructor is
unchanged — it already took a `CustomerAccountReadPort` as its third argument,
required — and `subscribe` now resolves the owning account's organisation through
it before it creates the row. A caller naming an account that does not resolve is
refused there, where the message can name the account, rather than at the
constraint. `cancel`, `listForAdmin` and `processRestockedFanOut` are unchanged,
and so is `AvailabilityWorker`: its restock fan-out reads under
`withSystemScope`, a deliberate cross-tenant grant, and still reaches every
organisation.

**What can break.** An insert or update that sets `customer_account_id` without
setting `organization_id` now fails with a check violation. A fixture or an
external writer that builds a subscription by hand is the case to look at.

The constraint is an **implication**, not an equivalence: an anonymous
subscription is a representable state (FR-011) — `an_recipient_check` exists to
admit a row whose only recipient is an e-mail address — and it carries no
organisation. No foreign key is added.
