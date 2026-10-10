---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-credit-limits': patch
---

`409 LIMIT_INSUFFICIENT` says the two amounts it is about. The refusal's English message carried
them — "Available credit limit (500.5) is below order total (999.5)." — but the sentence a buyer
actually receives, in English and in Polish, said only that the limit "does not cover this order".

The error now carries `details`: `availableAmount` and `orderTotal` as two-decimal strings
(`"500.50"`, `"999.50"`) and `currency` as the ISO 4217 code, and both sentences name them:
"The available credit limit (500.50 PLN) does not cover this order (999.50 PLN). Reduce the order
or choose a different payment method." Both amounts are the placing organization's own — the
available amount is what `GET /api/v1/me/credit-limit` already answers the same buyer.

The code and the status are unchanged; a client matching on either sees no difference. A client
that compared the message text sees the longer sentence.
