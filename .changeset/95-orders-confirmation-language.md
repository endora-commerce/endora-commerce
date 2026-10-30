---
'@endora-commerce/mod-orders': patch
---

The in-code order-confirmation e-mail (sent when no `order_confirmation` template applies)
takes its sentences from the module's bundle in the sales channel's language instead of a
Polish-or-English choice made line by line in code. The Polish and the English e-mail are
unchanged; a language no bundle ships for is written in English, as before.
`buildOrderConfirmationEmail` takes an optional third argument, the sentences to write
(`resolveOrderConfirmationProse(translate, language)`), and writes English without it.
New bundle keys: `email.orderConfirmation.*`.
