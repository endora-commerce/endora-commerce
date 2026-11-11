---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/demo-composition': patch
---

Readers of an organization's tax ID handle a personal organization, which has no tax ID since this release (`taxId: null`). An order placed by a personal organization carries no `billingAddress.taxId`, a quote document prints no tax ID for its buyer, and the push-audience organization picker shows no hint for it — each as before, now by data rather than by recognising the old placeholder. The demo composition finds the demo organisation by its tax ID with the tree's root first, as `organizationDetailsPort.findByTaxId` does, so a branch sharing that tax ID is never taken for it.
