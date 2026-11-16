---
'@endora-commerce/contracts': patch
---

`Accept-Language` tags with `q=0` are no longer chosen (issue #1315). RFC 9110 says `q=0` means "not acceptable".

Behaviour change: `parseAcceptLanguage` and `weightedAcceptLanguage` now drop any tag with `q` of `0` or less, and the dropped tags do not count towards the ten-tag limit. This includes a refused `*`. Every `q` returned by `weightedAcceptLanguage` is now above `0`.

`requestScopeLanguage` uses the same parse, so a refused language is never picked as the content language. `pl;q=0, en;q=0.5` on a `pl-PL` / `en-US` channel now gives `en-US`. `pl;q=0` alone gives the channel's default.

To migrate: if your code filtered out `q <= 0` entries from `weightedAcceptLanguage` itself, you can remove that filter. It does nothing now.
