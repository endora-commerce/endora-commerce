---
'@endora-commerce/mod-transactional-emails': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/mod-shopping-lists': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: the rest of Tier A is declared by the modules that own its nouns.

`manifest.errorCodes` gains six codes on `@endora-commerce/mod-prompt-actions`
(`ASSISTANT_*`, `PROMPT_*`), five on `@endora-commerce/mod-custom-fields` (`CUSTOM_FIELD_*`),
two on `@endora-commerce/mod-customers` (`CUSTOMER_ADDRESS_NOT_FOUND`,
`REGISTRATION_REQUIRES_ORGANIZATION`), two on `@endora-commerce/mod-shopping-lists`
(`SHOPPING_LIST_*`), one on `@endora-commerce/mod-price-lists` (`PRICE_LIST_NOT_FOUND`) and one
on `@endora-commerce/mod-transactional-emails` (`TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE`);
`@endora-commerce/mod-i18n` drops the same seventeen from its own declaration, which is what
decides where the error envelope looks for a sentence (D-129's remaining sweep, MR 3 of eight;
D-121 tiers T1 and T2; `specs/090-module-owned-error-codes/d129-sweep.md`).

For a consumer this changes which bundle answers for those codes. No wire shape moves —
`error.code` is unchanged — and no sentence is relocated: none of the seventeen had a
translation in `en` or `pl` in any bundle. Writing one of those sentences is now a change to the
owning module's own `i18n/{en,pl}.json` rather than to the platform's.

`@endora-commerce/mod-shopping-lists` gains an `i18n` bundle it never had, declared as
`i18n: { bundlesDir: 'i18n' }` and shipped in `files`. It holds the two `SHOPPING_LIST_*`
sentences in both languages, which is an operator- and buyer-visible improvement: a Polish
reader refused a delete of the default or the last shopping list now reads Polish prose instead
of the English the raise site carries.
