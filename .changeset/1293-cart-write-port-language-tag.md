---
'@endora-commerce/contracts': minor
---

**`CartWritePort.addItems` takes an optional `languageTag` in its `options`** (issue #1293): the buyer request's scope language, the channel language its `Accept-Language` asks for (`requestScopeLanguage`). The batch's lines are judged for availability, and a below-minimum line is named, at the basket's (channel, `languageTag` resolved against the channel's own languages), exactly as `POST /api/v1/cart/items` judges a line of the same request. The field is additive: a caller that does not pass it is answered in the channel's default language, as before, which remains the answer for a caller with no storefront request. An implementation of the port outside this repository may ignore the field and keep today's behaviour, or honour it by judging the lines in that language.
