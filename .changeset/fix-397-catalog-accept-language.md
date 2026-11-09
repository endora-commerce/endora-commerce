---
'@endora-commerce/contracts': minor
'@endora-commerce/platform': patch
'@endora-commerce/mod-catalog': patch
---

**Behaviour change for API clients: the catalogue now reads `Accept-Language` as a q-weighted list matched against the sales channel's languages** (issue #397). The public catalogue (`/api/v1/catalog/*`) and the external catalogue (`/api/v1/external/catalog/*`) used to take the header's first entry verbatim, `;q=` parameter included. They now take the tags in descending `q`, match each against the channel's languages (exactly, then by base language, so `pl` reaches a `pl-PL` channel language), use the first tag the channel serves, and fall back to the channel's default language when it serves none. So `Accept-Language: en;q=0.1, pl-PL;q=0.9` is answered in Polish (it was English), `pl` on a `pl-PL` channel hits the `pl-PL` values and overrides directly, and a language the channel does not offer (one that is still stored on a category name, an attribute label or an asset alt text, for example) is no longer served: the response uses the channel default. A client that wants a language must ask for one the channel offers. A request with no `Accept-Language` header behaves as before.

New in `@endora-commerce/contracts`: `parseAcceptLanguage(header)`, which returns the header's tags heaviest `q` first, bounded to 512 characters and 10 tags. It moved here from the platform's internal `kernel/i18n/request-language.ts`, which now imports it. Also new: `requestScopeLanguage(channel, header)`, the header form of `scopeLanguageOf`. Prefer it to `scopeLanguageOf(channel, firstLanguageTag(header))`.
