---
'@endora-commerce/mod-quote-requests': patch
---

Quote amounts are computed in exact decimal arithmetic (issue #417). The rules are unchanged.

- **The quote document** (PDF lines and summary): a line's net, VAT and gross, the unit gross, the list value, the discounts and their percentage, and the summary's net, VAT (on the net total, at the quote's one rate) and gross are computed on decimals and rounded half-up once — 29.50 at 23 % printed a unit gross of 36.28, now 36.29.
- **Typed unit prices** — an operator's `agreedUnitPrice` and a buyer's `desiredUnitPrice` — are stored half-up on their decimal digits (new `unitPriceText`); `toFixed(2)` stored 1.005 as 1.00.
- **The admin screens**: the quote's net, VAT and gross (new `quoteTotals`, `quoteNet` in `admin/quote-totals.ts`), the section summaries and the reference difference are exact; 0.70 at 5 % showed a VAT of 0.03, now 0.04.
