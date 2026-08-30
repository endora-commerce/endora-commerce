---
'@endora-commerce/mod-comparisons': minor
---

`comparisons` gains `organization_id`, stamps it on every owned write, and
refuses a row that names a customer account without one.

`Comparison` gains an `organizationId` property and the `comparisons` table
gains a nullable `organization_id` column, a partial index on it, and
`check ("customer_account_id" is null or "organization_id" is not null)`. The
migration first derives the missing organisation from the account that owns each
comparison, then refuses — with the count and up to twenty ids, deleting nothing
— anything it could not derive.

**What changes for a reader.** `Comparison` is `@CustomerScoped`, and the tenant
filter's `allowed-set` arm consults the ORM's metadata for this column per
query: an administrator whose authority is a set of organisations saw **no**
comparison at all while the column was absent, and now sees the comparisons of
the organisations they are assigned to. The
`meta.scopeNotice: 'ORGANIZATION_ATTRIBUTION_PENDING'` disclosure that explained
that emptiness is no longer emitted for this table — it was keyed on the
column's absence and retires with it.

**What changes for a writer.** `ComparisonService` takes a
`CustomerAccountReadPort` as its last constructor argument and resolves the
owning account's organisation on both paths that can produce an owned row: the
authenticated create in `addProduct`, and `adoptAnonymousComparison`, where a
comparison that was legitimately ownerless while anonymous becomes owned. A
composition that does not supply the port gets a refusal at those two writes
rather than a row the constraint rejects. Every other method is unchanged, and
the `withSystemScope` share-token lookup is untouched — a share link is still a
cross-customer grant.

**What can break.** An insert or update that sets `customer_account_id` without
setting `organization_id` now fails with a check violation. A fixture or an
external writer that builds a comparison by hand is the case to look at.

The constraint is an **implication**, not an equivalence: an anonymous
comparison is a representable state and carries no organisation. No foreign key
is added.
