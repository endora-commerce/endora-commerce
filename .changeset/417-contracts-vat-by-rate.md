---
'@endora-commerce/contracts': minor
---

One VAT method, shared by every document an order produces (issue #417, owner ruling of 2026-10-24; art. 106e ust. 1 pkt 13–14 of the Polish VAT Act).

- **`vatByRate(lines, unit)`** — per rate, the VAT on the sum of the nets at that rate, rounded half-up once; gross = net + VAT; totals are the sums of the rows. It also answers each line's informational share of its rate's VAT, so line grosses add up to the total.
- **`allocateHalfUp(total, parts, places = 2)`** — a total shared over parts, each rounded half-up and the difference handed back cent by cent.
- **`netForGrossAtRate(gross, rate, unit)`** — the net a gross came from under that rule (what a correction credits net), with `exact: false` and the VAT as the remainder for a gross the rule cannot produce.
