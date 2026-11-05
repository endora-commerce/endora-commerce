---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-i18n': patch
---

A personal (B2C) Organization is labelled for what it is rather than by its placeholder tax id (issue #767, owner ruling of 2026-11-05). The admin Organizations list and the Organization detail header show "Personal account" ("Konto osobiste") in place of the tax id. The admin order and quote request screens' *Organization* panel show "Individual customer" ("Klient indywidualny") where the tax-id line was. The three strings are new core keys: `organizations.personalAccount`, `orderDetail.org.individualCustomer` and `rfq.detail.org.individualCustomer`.
