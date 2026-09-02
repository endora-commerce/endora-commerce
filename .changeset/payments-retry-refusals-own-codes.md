---
'@endora-commerce/mod-payments': major
---

`POST /api/v1/orders/:orderId/payments/retry` refuses with three codes of this
module's own, and all three refusals are translated.

`PaymentRetryService.retryForCustomer` answered `409 VALIDATION_FAILED` for
every one of its three refusals. It now answers one of three codes this package
declares and translates:

| Condition | Code |
| --- | --- |
| The money is not the buyer's to pay — paid, drawn against a credit limit, or refunded | `PAYMENT_NOT_DUE` |
| The order's lifecycle status is terminal, so somebody cancelled it | `PAYMENT_ORDER_CLOSED` |
| The method the order was placed with has no adapter registered any more | `PAYMENT_ADAPTER_UNAVAILABLE` |

**If you branch on the code**, this is the change to make:

```diff
 const res = await retryPayment(orderId);
 if (res.status === 409) {
-  showCannotPay(res.body.error.message);
+  switch (res.body.error.code) {
+    case 'PAYMENT_NOT_DUE': showNothingToPay(); break;
+    case 'PAYMENT_ORDER_CLOSED': offerToReorder(); break;
+    case 'PAYMENT_ADAPTER_UNAVAILABLE': offerToContactTheShop(); break;
+  }
 }
```

The status is unchanged, so a client that reads only the status needs nothing.
Three codes rather than one because the buyer's next move differs in each: with
`PAYMENT_NOT_DUE` there is nothing to do, with `PAYMENT_ORDER_CLOSED` the goods
need a new order, and with `PAYMENT_ADAPTER_UNAVAILABLE` the order is still open
and still owed — what is broken is the shop's configuration.

The package also exports `paymentsErrorCodes`, the branded declaration those
three come from (`defineModuleErrorCodes`). Name a code through it rather than
as a string literal and a typo is a compile error.

**The reason this is worth a release note rather than a tidy-up.**
`VALIDATION_FAILED` is the one code `localizeErrorEnvelope` returns *before*
translating — deliberately, because the code is overloaded and several services
carry machine-readable tokens in its message. So each refusal was served as the
raise site's hard-coded English to every buyer, in every language. Measured with
the correct English sentence at each raise site, both bundles installed and only
the locale under test: a buyer sending `Accept-Language: pl` still received
`This order is not awaiting payment.` A Polish buyer now reads *"To zamówienie
nie oczekuje na płatność."*, *"To zamówienie zostało zamknięte i nie można go
już opłacić."* and *"Metoda płatności wybrana przy składaniu tego zamówienia nie
jest już dostępna."*

This package shipped no `i18n` bundle at all before this change — it has no
admin screen of its own — so `i18n/en.json`, `i18n/pl.json` and the manifest's
`i18n` declaration arrive with the codes.
