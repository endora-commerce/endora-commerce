---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-price-lists': patch
---

A product's gross price uses that product's own VAT rate for the buyer, not a flat 23 % (issue #852).

- `@endora-commerce/contracts`: `productSummarySchema` (and so `productDetailSchema`) gains the optional `vatRate` — the buyer's VAT rate for the product as a fraction, `null` where it could not be resolved. Additive: a reply without it parses as before. New `createProductTaxRateResolver` / `ProductTaxRateResolver`: the rate rule the cart applied since issue #436 — the product's tax class against the Organization's VAT status and registered country through `OrganizationTaxProfilePort` and `TaxServicePort`, `0` for a VAT-exempt or reverse-charge Organization, a buyer with no Organization a VAT payer in PL — moved here so the cart and the catalogue resolve one rule.
- `@endora-commerce/mod-catalog`: `GET /api/v1/catalog/products` and `GET /api/v1/catalog/products/:idOrSlug` answer `vatRate` on every product. It depends only on the viewer's Organization, so it follows the price's cache rule: a reply for a caller naming an Organization is `private, no-store`, and the shareable anonymous reply carries the guest's rate. A failed resolution answers `vatRate: null` rather than refusing the listing. The module now declares `taxes` as a dependency (it resolves `taxService`) and acknowledges `organizations`' `organizationTaxProfilePort`.
- `@endora-commerce/mod-carts`: the cart's rates come from the contracts' `createProductTaxRateResolver`; the module's own `cart-tax-rates.ts` is gone. No change to what the cart answers.
- `@endora-commerce/mod-price-lists`: the display-mode documentation says how a gross price is derived.
