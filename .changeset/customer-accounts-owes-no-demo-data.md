---
'@endora-commerce/mod-customer-accounts': patch
---

The module declares `demo: false` — a decision recorded rather than a field filled in.

The demo shop does have a buyer and it is not this module's demo data:
`customer_accounts.organization_id` is `NOT NULL` (Principle XI), so there is no account to
create before an `organizations` row exists to hold it and "create the account, then join it"
cannot be written at all. The account and its organisation are created in one statement, which
makes them two modules' rows and the instance composition's.

Absent and `false` are different states, so this changes no behaviour: it says the module owes
nothing rather than leaving it undecided.
