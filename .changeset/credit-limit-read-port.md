---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-credit-limits': minor
---

Publish `CreditLimitReadPort` — the membership read on `credit_limits`' surface,
on the `creditLimitReadPort` container.

`organizationsWithLimit(organizationIds: readonly string[]): Promise<string[]>`
answers which of the given organisations hold a credit-limit row, in no
particular order. The caller supplies an ancestor chain and decides which hit is
nearest.

New surface only — nothing is removed and no existing call changes. Consumers on
an older version keep compiling; a consumer that wants the port resolves it with
`lazyPort<CreditLimitReadPort>(ctx, 'creditLimitReadPort')` and declares the edge
in its manifest.

Two properties of the implementation are contract rather than detail, and both
are stated on the interface. The read crosses organisation scope deliberately —
the holder is by definition an ancestor outside the caller's tenant filter, so a
provider that let `@OrgScoped` narrow it would answer the empty set for every
descendant. And the answer is plain ids: a `CreditLimit` handed across this seam
would be a managed entity the consumer could mutate and flush outside the
transaction that loaded it.

It replaces a raw `select "organization_id" from "credit_limits" where
"organization_id" in (…)` that `organizations` ran against this module's table
(feature 077, D-87). That statement named no import specifier, so the boundary it
crossed compiled and returned rows whatever state this module was in; the port is
gated, so an absent owner now refuses instead of reporting an empty chain, which
downstream reads as "no limit applies".
