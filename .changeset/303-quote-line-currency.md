---
'@endora-commerce/mod-quote-requests': patch
---

Quote request lines carry the currency of the sales channel the request was raised on, instead of always `PLN` (issue #303). The currency is decided once, when the request is created by a customer or by an operator on their behalf (`createOnBehalf`), from the channel's default currency; a draft edit, a seller revision (`modify`) and a resubmission copy the currency the request already has, so one request never mixes currencies. `QuoteRequestLineRecord.lineCurrency` therefore names the channel's currency for anything that exports quote requests. The customer and admin list summaries of a request with no lines use the channel's currency; `PLN` remains only for a legacy request recorded on no channel. Existing rows are not backfilled: see *Quote request lines carry their channel's currency* in the upgrade guide for a query that lists the requests raised on a non-PLN channel.
