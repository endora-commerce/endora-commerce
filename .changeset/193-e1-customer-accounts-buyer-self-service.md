---
'@endora-commerce/mod-customer-accounts': minor
'@endora-commerce/mod-customers': patch
---

The storefront's own registrations are buyer self-service (`specs/193-admin-form-extensions/` D-300.10 as amended by D-300.31).

- `customerAccountCommandPort.createStandalone(input, { buyerSelfService: true })` puts the flag on `customer_account.register_standalone`. Its child `organization.personal.provision` inherits it, so a deployment's tightened field rule does not refuse the visitor. Without the option a `system` caller is bound. `customers`' storefront registration passes it.
- The federated sign-in's account and personal organisation are one Command, `customer_account.register_social`. Before, it was a hand-audited transaction. It records the same entry under the same action, declares `buyerSelfService`, and runs the provisioning as its child on its one transaction.
- The manifest lists both actions in `buyerSelfServiceActions`.
