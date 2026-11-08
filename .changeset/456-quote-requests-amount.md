---
'@endora-commerce/mod-quote-requests': minor
---

`quoteRequestReadPort.amountOf(id)` returns the quote's amount by the one rule of issue #456, and the admin quote list's rows carry `amount` and `agreement`.

The admin list now shows that amount (per line, the agreed price or else the asked one) instead of the agreed total when every line was agreed and otherwise the asked total. It is marked:
- "Partially agreed" while some lines are agreed;
- "Not yet agreed" while none is.

A quote without any price shows `—`.

`totalAtAgreedPrice` and `totalAtCustomerPrice` are unchanged.
