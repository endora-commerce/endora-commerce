---
'@endora-commerce/contracts': minor
---

`vatByRate`'s per-line `gross` is the line's own rounding, `round(net × (1 + rate))`, instead of the line's allocated share of its rate's VAT (owner ruling of 2026-10-24, issue #417): 29.50 at 23 % shows 36.29 even beside another 23 % line. The rows' VAT and the totals are unchanged, so a document's line grosses may add up to a cent more or less than its total. `allocateHalfUp` stays for exact shares of a refund.
