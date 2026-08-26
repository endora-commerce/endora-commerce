---
'@endora-commerce/contracts': major
---

`CustomerAccountRecord.organizationId` is `string` — never `null` (D-178).

`customer_accounts.organization_id` is `NOT NULL` in the database, an individual
customer is backed by a single-member personal Organization, and there is no
"no-organization" scoping path. Every branch a consumer wrote for the absent case
is dead:

```diff
-const org = account.organizationId === null ? null : await orgs.findById(account.organizationId);
+const org = await orgs.findById(account.organizationId);
```

Take care with the *other* `organizationId: string | null` fields — a cart's, a
`ProductAudience`'s — which stay nullable and mean "an anonymous visitor with no
account". Only the account's own tenant became total.

Two port changes travel with it.

`CustomerAccountLifecycleWritePort.setOrganization` no longer accepts `null`, and
`detachToPersonalOrganization` is the operation the `null` used to express:

```diff
-await accounts.setOrganization(customerAccountId, null, { actorAdminUserId });
+const personal = await personalOrganizations.provisionPersonalOrganization(customerAccountId);
+await accounts.detachToPersonalOrganization(customerAccountId, personal.id, { actorAdminUserId });
```

It records the same audit verb (`customer_account.organization_unassigned`) and
runs the same authority and org-administrator-depletion guards; what changes is
that the customer ends up in their own tenant rather than in none.

`PersonalOrganizationPort` gains `provisionPersonalOrganization(customerAccountId)`
— the account's **own** personal Organization, whatever it currently belongs to,
provisioned if it has never existed, and no membership written. It is not
`ensureForCustomerAccount`, which answers with the account's *current*
Organization when it has one and would hand a company member their company back.
