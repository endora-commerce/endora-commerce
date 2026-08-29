---
'@endora-commerce/mod-i18n': minor
---

Fourteen `rfq.detail.*` keys in `en` and `pl` for the quote-request validity deadline the
operator now sets from the request's own detail screen.

`rfq.detail.validity.*` covers the deadline field, its five help sentences (the preview of the
date a save would write, the three "what leaving this blank keeps" answers, and the refusal for
a value the contract would reject) and the two remedies a lapsed request offers depending on
whether it can still be modified. `rfq.detail.badge.validityEnded` and
`rfq.detail.meta.validityEnded` are the third sentence about a field that previously had two:
a deadline already behind us used to render through `rfq.detail.meta.expires`, which reads as a
promise still standing.

No key is renamed or removed; a consumer on the previous bundle resolves everything it did
before.
