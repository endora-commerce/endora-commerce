---
'@endora-commerce/mod-orders': major
---

`POST /api/v1/orders/:id/cancel` refuses with `ORDER_NOT_CANCELLABLE`, and the
refusal is translated.

`CustomerOrderCancellationService.cancelByCustomer` answered
`409 VALIDATION_FAILED` when the buyer may not cancel the order. It now answers
`409 ORDER_NOT_CANCELLABLE`, which is what
`specs/001-b2b-platform-foundation/contracts/orders.contract.md` has specified
for this route all along.

**If you branch on the code**, this is the change to make:

```diff
 const res = await cancelOrder(orderId);
 if (res.status === 409) {
-  if (res.body.error.code === 'VALIDATION_FAILED') showCannotCancel();
+  if (res.body.error.code === 'ORDER_NOT_CANCELLABLE') showCannotCancel();
 }
```

The status is unchanged, so a client that reads only the status needs nothing.
The other 409 this route can answer is unchanged too: `INVALID_TRANSITION`,
raised when the buyer *may* cancel and the configured status graph refuses the
move anyway, is a different condition and keeps its own code.

**The reason this is worth a release note rather than a tidy-up.**
`VALIDATION_FAILED` is the one code `localizeErrorEnvelope` returns *before*
translating — deliberately, because the code is overloaded and several services
carry machine-readable tokens in its message. So the refusal was served as the
raise site's hard-coded English to every buyer, in every language, while
`errors.ORDER_NOT_CANCELLABLE` sat written and translated in this package's own
`i18n/en.json` and `i18n/pl.json`, unreachable. A buyer asking for Polish now
gets *"Tego zamówienia nie można już anulować."*; the English sentence is the
bundle's, not the service's, and the message written at the raise site is only
the fallback the envelope substitutes when no bundle answers.

The module's `errorCodes` declaration is not in this change and is not needed
by it: feature 090's `orders` migration declares both codes this package owns,
and `ORDER_NOT_CANCELLABLE` routes here through `@endora-commerce/mod-i18n`
either way — by the declaration once it is composed, and by the `ORDER_*` prefix
chain before that. The sentence was reachable all along; nothing raised the code
that reaches it.
