---
'@endora-commerce/mod-newsletter': minor
---

`newsletter` gains `organization_id` on `newsletter_subscribers`, stamps it on
both writes that own a row, and refuses a row that names a customer account
without one.

`NewsletterSubscriber` gains an `organizationId` property and the
`newsletter_subscribers` table gains a nullable `organization_id` column, an
index (`newsletter_subscribers_organization_idx`, following this table's own
`newsletter_subscribers_channel_idx` spelling) and
`check ("customer_account_id" is null or "organization_id" is not null)`. The
migration first derives the missing organisation from the account that owns each
subscriber, then refuses — with the count and up to twenty ids, deleting nothing
— anything it could not derive. Like `push_subscriptions` and
`availability_notifications`, and unlike `comparisons`, this table carries **no
foreign key** on `customer_account_id`, so that refusal is a branch a real
database can reach.

**The e-mail address is not a derivation, and that is a decision rather than an
omission.** `newsletter_subscribers.email` is globally unique and
`customer_accounts` has an `email` too, so the backfill could have matched them
and attributed far more rows. Matching would claim rows the schema does not
link, silently and irreversibly, for whoever signed up with the address their
employer later registered. The only derivation is `customer_account_id`.

**What changes for a reader.** `NewsletterSubscriber` is `@CustomerScoped`, and
the tenant filter's `allowed-set` arm consults the ORM's metadata for this
property per query. Before this release the arm found none and refused the whole
table, so an administrator whose authority is a set of organisations — a sales
representative — was shown no subscribers at all and told so, through the
`ORGANIZATION_ATTRIBUTION_PENDING` notice on the response envelope. It now grants
on the column, so that administrator sees the subscribers of the organisations
they are assigned to, and the notice stops being emitted for this table.

**And that reaches the CSV export, which is the surface with no envelope.**
`GET /api/v1/admin/newsletter/subscribers/export` answers with a `text/csv`
body, so the notice could never be attached to it: a scoped administrator's
download was a header row and nothing else, with nothing anywhere saying why. It
now carries their organisations' owned subscribers. It carries **no ownerless
subscriber** — every storefront sign-up, which on this table is the ordinary row
rather than the edge — because such a row has no organisation and the constraint
is an implication rather than an equivalence. Who an ownerless subscriber belongs
to is an open product question this release does not answer; it lands the column
that makes any answer expressible.

**What changes for a caller.** `SubscriberServiceDeps` gains a **required**
`customerAccounts: CustomerAccountReadPort`, and `NewsletterModuleOptions` gains
the same field, threaded from the container's `customerAccountReadPort`. A
composition that cannot answer "which organisation owns this account" can no
longer construct `NewsletterSubscriberService` — that is the point, since the
constraint refuses the row it would write. Both write sites take the two columns
from one resolved-owner value, so the customer branch has no shape in which the
organisation could be omitted and the anonymous branch has none to carry.
