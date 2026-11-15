---
'@endora-commerce/contracts': patch
---

`weightedAcceptLanguage(header)` is the shared `Accept-Language` parse with its weights kept (issue #1011). It returns `{ tag, q }` entries in the order and under the bounds `parseAcceptLanguage` uses (512 characters, ten tags after weighting, a malformed `q` drops its tag), and `parseAcceptLanguage` is now defined on top of it. It is for a reader that has to tell a tag at `q=0`, which RFC 9110 calls "not acceptable", from an ordinary one. The storefront's unprefixed-URL redirect (feature 167) is that reader: it now uses this parse instead of its own, so it picks up those bounds and reads `q` case-insensitively. It still never redirects to a `q=0` tag or to `*`. The module has no imports, so the edge middleware can import it as `@endora-commerce/contracts/accept-language` without pulling in the schemas.
