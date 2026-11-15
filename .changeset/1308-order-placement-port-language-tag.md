---
'@endora-commerce/contracts': minor
---

**`OrderPlacementPort.placeOrder` takes an optional `languageTag` in its `options`** (issue #1308): the buyer request's scope language, the channel language its `Accept-Language` asks for (`requestScopeLanguage`). The basket's lines are judged for availability, and the order's lines named, at (the order's channel, `languageTag` resolved against that channel's own languages) — the language the same request's `CartWritePort.addItems` judged them in, so a line admitted there is not refused at placement for being off in the channel's default language. The field is additive and sits beside `language`, which stays the language a refusal is worded in: a caller that does not pass it is answered as before (the channel language `language` names, else the channel's default). An implementation of the port outside this repository may ignore the field and keep that behaviour.
