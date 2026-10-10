---
'@endora-commerce/demo-composition': minor
'@endora-commerce/platform': minor
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/cli': patch
---

`demo reset` withdraws a demo that has been used, in one transaction, and refuses to delete
financial records unless it is told to.

**What was wrong.** `demo reset` exited 1 as soon as the demo buyer had placed one order on credit
(`credit_limit_reservations_credit_limit_fk`) or saved one address (`addresses_organization_fk`).
The refusal came after the demo payment methods, the delivery methods and the buyer were already
gone, so checkout was left broken. A reset that did go through left the demo organisation's
orders, carts and quote requests naming an organisation that no longer existed.

**A reset is now one transaction** (`@endora-commerce/platform`). The dispatcher opens it, builds
the composition over it and hands it to every module's demo body as that body's own
`EntityManager`. A refusal anywhere in the run — the composition's withdrawal, a module's, a
foreign key from a table of your own — changes nothing. `demo seed` is unchanged.

- **Breaking for a module's `demo.reset` body and for a composition's `withdraw`**: write through
  the `EntityManager` you are handed (`em.nativeDelete`, `em.execute`), not through
  `em.getConnection().execute(…)`. The bare connection carries no transaction: the statement runs
  on a second connection, cannot see what the reset has already deleted, and waits on rows the
  reset has locked. `@endora-commerce/mod-catalog`'s reset and every statement of
  `@endora-commerce/demo-composition` were moved accordingly.
- **Breaking for a demo composition**: declare `withdrawsInsideTransaction: true` on the object
  `createDemoComposition` returns. A reset over a composition that does not is refused before it
  starts — which is what happens to `@endora-commerce/demo-composition` 0.104 under this platform;
  the two are released in lockstep and the composition's peer range is the exact platform version.
- The transaction is `REPEATABLE READ`, so what the reset counts and what it deletes are one
  snapshot; `lock_timeout` (60 s) and `idle_in_transaction_session_timeout` (120 s) are set on it;
  and while it runs, anything in its async context that asks the pool for a second connection is
  refused immediately with "a reset body wrote outside the reset transaction". A body that brings a
  database client of its own is ended by the idle bound instead of hanging.
- Every refusal — the composition's, a module's, the database's (an integrity constraint, a
  snapshot conflict, a lock wait) — is printed as a message saying what refused and that nothing
  has been changed, without a stack. An unanticipated failure keeps its stack and says the same.
- `DemoRunFailedError` says "nothing was changed" for such a run instead of telling the operator
  to clear half-written rows away.

**What using the demo left behind is withdrawn first** (`@endora-commerce/demo-composition`):
orders with their shipments, stock allocations (the stock they held is released) and credit
reservations, return cases, carts, quote requests, shopping lists, comparisons, addresses, API
keys, webhooks, sessions, two-factor enrolments, newsletter and push subscriptions, analytics
events, price-list assignments, promotion uses (the usage counters they spent are given back),
promotions restricted to that organisation, Sales Opportunities opened for it, and the accounts
that joined it. **These rows are deleted, not re-pointed.** Only rows of the demo organisation
are matched — it is found by the tax id the demo gives it — so another organisation on the same
instance loses nothing, and neither does a row with no organisation, such as a guest's cart. The
audit trail, the e-mail delivery log and administrators' notification history are kept.

A module that is **switched off** does not exempt its rows: they are withdrawn when the module's
tables exist, whether or not it is active. A reset with CRM off used to stop at `organizations`;
it now completes, and leaves only CRM's three demo tags, which a reset with CRM on removes.

**Breaking: the reset refuses when the demo organisation holds financial records** — invoices
(pro formas and corrections included), accounting-system records (`invoice_ledger_*`), payments,
refunds, and refunds settled against the credit limit. It exits 1 before deleting anything and
prints how many of each it found. Placing one order is enough: it opens a payment and, with
invoicing on, a pro-forma invoice. To delete them with the rest:

```
pnpm run cli demo reset --force-delete-financial-records
```

The flag is read from that command line only — no environment variable, no setting — and forces
nothing else: the production guard and every foreign key apply as before. An automated job that
resets a used demo needs the flag on its command line.

The reset also stops before touching anything when another organisation has been filed under the
demo one — detach or delete the sub-organisation and run it again.

New exports of `@endora-commerce/platform/demo`: `DemoResetRefusedError` (thrown by a composition
to decline a reset; printed as its message, without a stack) and
`DEMO_FORCE_DELETE_FINANCIAL_RECORDS_FLAG`. `DemoCompositionInput` gains the optional
`deleteFinancialRecords`.

`organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
and the sales representatives assigned to it before removing the organisation, and reports both
counts beside `Organization`.

Promotion counters: a redemption made before its promotion had a global limit bumped no counter,
and nothing records that, so it is subtracted like the others; a real promotion's counter can end
up lower than the real uses made since, never below zero.

`@endora-commerce/cli`: the install and `new instance` closing messages mention the refusal and
the flag beside `demo reset`.

The getting-started, upgrade and CRM documentation pages say what the reset now does.
