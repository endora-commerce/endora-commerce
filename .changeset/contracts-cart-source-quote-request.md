---
'@endora-commerce/contracts': minor
---

A basket can say which accepted quote request it was seeded from.

- `CartRecord.sourceQuoteRequestId: string | null` — new and **required**. **Breaking for
  anything that builds a `CartRecord` or implements `CartReadPort` / `CartWritePort` itself**
  (a test double, an alternative cart): add the field, `null` when the basket came from no
  quote request. Consumers that only read a `CartRecord` are unaffected.
- `CartWritePort.replaceItemsForCustomer(ctx, lines, options?)` — a third, optional argument,
  `CartSeedOptions { sourceQuoteRequestId?: string | null }`. Existing two-argument calls
  compile and behave as before, with one thing to know: the mark is **replaced on every call**,
  so a seed that passes no option clears what an earlier one set.

The value is a claim, not a fact: `carts` records what its caller said, and `orders` re-reads
the quote request through `QuoteRequestReadPort` before an order may carry it.
