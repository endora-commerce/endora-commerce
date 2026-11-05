---
'@endora-commerce/mod-orders': patch
---

An order placed by a personal (B2C) Organization is billed to the person (issue #759). Its billing snapshot no longer falls back to the Organization's tax id, which for a personal Organization is an internal placeholder, nor to the Organization's name as the company name: without company data typed at checkout, `billingAddress.companyName` and `billingAddress.taxId` are absent, so the invoice, its PDF, the order confirmation e-mail and the admin order screen print no company and no tax-id line. Company data the buyer types is kept as before, and a company Organization still defaults to its legal (or display) name and tax id. Orders placed before this change keep the snapshot they were placed with.
