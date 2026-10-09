---
'@endora-commerce/demo-composition': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-crm': patch
---

`demo reset` withdraws a demo that has been used. It exited 1 as soon as the demo buyer had
placed one order on credit (`credit_limit_reservations_credit_limit_fk`) or saved one address
(`addresses_organization_fk`), and the second refusal came after the demo payment methods, the
delivery methods and the credit limit were already gone, so checkout was left broken. A reset
that did go through left the demo organisation's orders, carts and quote requests naming an
organisation that no longer existed.

The composition's withdrawal now starts by removing what using the demo created under the demo
organisation and its customer accounts: orders with their payments, shipments, invoices, stock
allocations (the stock they held is released) and credit reservations, return cases, carts, quote
requests, shopping lists, comparisons, addresses, API keys, webhooks, sessions, two-factor
enrolments, newsletter and push subscriptions, analytics events, price-list assignments,
promotions restricted to that organisation, Sales Opportunities opened for it, and every customer
account that belongs to it. **These rows are deleted, not re-pointed.** Only rows of the demo
organisation are matched — it is found by the tax id the demo gives it — so another organisation
on the same instance loses nothing. The audit trail, the e-mail delivery log and administrators'
notification history are kept.

That part runs first and in one transaction: if a foreign key refuses it, the reset exits non-zero
with nothing withdrawn and the shop still working. It also stops before touching anything, with
an error saying so, when another organisation has been filed under the demo one — detach or delete
the sub-organisation and run the reset again.

`organizations`' own demo withdrawal now removes the invitations sent from the demo organisation
and the sales representatives assigned to it before removing the organisation, and reports both
counts beside `Organization`.

The CRM documentation page says what the reset now removes. No API, setting or permission changes.
