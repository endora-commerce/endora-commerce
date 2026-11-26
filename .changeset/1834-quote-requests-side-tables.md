---
'@endora-commerce/mod-quote-requests': patch
---

The module's manifest declares its two negotiation-policy side tables, `quote_request_org_policies` on `organizations.Organization` and `quote_request_account_policies` on `customer_accounts.CustomerAccount` (issue #1834, `specs/187-side-table-extensions/`), so the platform verifies their keys, cascades and tenancy at `migrate` and at boot. No schema or behaviour change.
