---
"@endora-commerce/mod-invoices": minor
"@endora-commerce/mod-i18n": patch
---

An invoice for an order paid by a related payer is recorded under the payer: the invoice ledger, the admin invoice list's reach and its new *Billed organization* filter all use `payerOrganizationId ?? organizationId`. The admin invoice list gains that Organization filter (`filter[organizationId]=`) for every invoice.
