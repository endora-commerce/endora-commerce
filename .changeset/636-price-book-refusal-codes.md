---
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/contracts': patch
---

Two `price_lists` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #636, part of #86). **A caller that matches on
`VALIDATION_FAILED` for either of them now sees the specific code.** The HTTP status is unchanged.
Both were refused by the book's stored state, not by the request, and until now the reader got the
English literal, because the error envelope never replaces the message of `VALIDATION_FAILED`.

| Where | Was | Is | `details` |
| --- | --- | --- | --- |
| `priceBookWritePort.replaceProductBaseTiers` (`PriceBookService.setBasePrices` keeping the variants' rows) | `400 VALIDATION_FAILED`, "The base prices were refused. A variant's percentage or amount adjustment needs the product's own base price in this currency.", `details` the `[{ path, issue }]` array | `400 PRICE_BOOK_BASE_PRICE_REQUIRED` | `productId`, `currency`, and the same array as `issues` |
| `PriceBookService.replaceChannels` on a base book | `400 VALIDATION_FAILED`, "The channel set was refused. A base book is channel-independent and has no channel set." | `400 PRICE_BOOK_BASE_HAS_NO_CHANNELS` | `priceBookId`, `currency` |

`details` of `PRICE_BOOK_BASE_PRICE_REQUIRED` is now an object: a caller that read the issue array
directly finds it under `details.issues`.

`buyerLinePricePort.resolveForBuyer` with a `null` channel on an installation with no
system-default sales channel threw `400 VALIDATION_FAILED` "No default sales channel."; it now throws
the platform's `NoSystemDefaultChannel` (`500 INTERNAL`). No request causes that state and no buyer
can fix it: the boot reconciler guarantees a default channel, so a booted deployment never reaches
it.

The other refusals of the price-book service (a missing version, an empty channel set, an unknown
channel, `endsAt` not after `startsAt`, a malformed row plan) stay `VALIDATION_FAILED`. The two codes
are members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `price_lists`
manifest, and the module's developer guide lists them. No setting, permission or migration changes.
