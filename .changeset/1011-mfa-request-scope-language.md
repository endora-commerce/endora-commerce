---
'@endora-commerce/mod-mfa': patch
---

**A federated customer sign-in returns the browser to the storefront pages in the channel language its whole `Accept-Language` asks for** (issue #1011). When the `next` the storefront sends carries no language prefix, `GET /api/v1/auth/customer/oauth/:provider/start` recorded the header's first tag alone as the starting page's language, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` sent a refused or second-step sign-in back to the English pages and `de-DE, pl;q=0.5` to the default language's. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the sales channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. A language-prefixed `next` still wins, and a request without the header behaves as before.
