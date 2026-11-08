---
'@endora-commerce/mod-quote-requests': minor
---

`quoteRequestReadPort.amountOf(id)` answers the quote's amount by the one rule of issue #456, and the admin quote list's rows carry `amount` and `partiallyAgreed`. The admin list now shows that amount — per line, the agreed price or else the asked one — with a "Partially agreed" marker, instead of the agreed total when every line was agreed and otherwise the asked total. `totalAtAgreedPrice` and `totalAtCustomerPrice` are unchanged.
