---
'@endora-commerce/mod-organizations': patch
---

**The verification link a business registration e-mails follows the channel language `Accept-Language` asks for, read as a q-weighted list** (issue #1011). `POST /api/v1/organizations/register` put the link under the language prefix of the header's first tag alone, so `Accept-Language: en;q=0.2, pl-PL;q=0.9` linked to the English page and `de-DE, pl;q=0.5` to the channel default. The language is now resolved through `requestScopeLanguage` from `@endora-commerce/contracts`, as the catalogue does since #397: the tags in descending `q`, each matched against the channel's languages (exactly, then by base language), the first one the channel offers winning, else the channel's default. A request without the header, or outside a sales channel, behaves as before.
