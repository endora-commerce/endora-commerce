---
'@endora-commerce/mod-languages': patch
'@endora-commerce/contracts': patch
---

**`Accept-Language` has one parser** (issue #1011). `LocaleService.resolveRequestLocale` in `languages` is removed. It had no caller and carried a private copy of the header parser, so the module documentation (English and Polish) no longer describes it. A request's content language is resolved against its sales channel by `requestScopeLanguage` from `@endora-commerce/contracts`, and its message language by `request.responseLanguage()`. In `@endora-commerce/contracts`, the doc comment on `CreateForCustomerOptions.languageTag` now says what the quote-request customer routes pass, which is the channel language from `requestScopeLanguage`, no longer the first tag. In the storefront, the outage notice and the web-app manifest read the header through `parseAcceptLanguage` instead of a private parser: the same q-ordering, the 512-character and ten-tag bounds, and a tag with a malformed `q` (`pl;q=`) dropped instead of read as `q=1`.
