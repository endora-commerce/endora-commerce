---
'@endora-commerce/contracts': minor
---

Exact decimal money arithmetic for every amount computed from a price (issue #417).

- **New module `money-decimal`** (re-exported from the package root), the sibling of `price-book-decimal`: every value is read as the decimal it is written as (`decimalText`), carried as an integer with a scale, and rounded **half-up** (half away from zero for a negative amount) only where asked.
  - `roundHalfUp(value, places = 2)` — `roundAmountHalfUp` at any number of places (4 for a unit price).
  - `decimalSum(...values)`, `decimalDifference(a, b)`, `decimalProduct(a, b)` — exact and unrounded; `compareDecimals(a, b)` for signed decimals of any scale.
  - `moneySum(values, places = 2)`, `moneyDifference(a, b, places = 2)` — rounded once, at the end.
  - `lineAmountHalfUp(unitPrice, quantity)`, `percentOfHalfUp(amount, percent)`, `quotientHalfUp(dividend, divisor, places = 2)`, and `wholeMultiples(amount, step)` — how many whole steps fit in an amount (`Math.floor(0.3 / 0.1)` is 2).
  - `taxAmountHalfUp(net, rate, unit)`, `taxAmountExact(net, rate, unit)`, `grossFromNetHalfUp(net, rate, unit)` (a negative net allowed) and `netFromGrossHalfUp(gross, rate, unit)` — `unit` is `'fraction'` (`0.23`) or `'percent'` (`23`) and is required.
- Replaces `Number#toFixed(2)` and `Math.round(x * 100) / 100` on doubles, which round the binary value: 29.50 × 1.23 is the double 36.28499…, so the binary rounding gave 36.28 where half-up gives 36.29.
