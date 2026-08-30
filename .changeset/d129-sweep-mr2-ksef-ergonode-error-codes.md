---
'@endora-commerce/mod-pim-ergonode': patch
'@endora-commerce/mod-ksef': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: the `KSEF_*` and `PIM_ERGONODE_*` families are declared by the modules
that own their nouns.

`manifest.errorCodes` on `@endora-commerce/mod-ksef` gains its seven codes and on
`@endora-commerce/mod-pim-ergonode` its thirteen; `@endora-commerce/mod-i18n` drops the same
twenty from its own declaration, which is what decides where the error envelope looks for a
sentence (D-129's remaining sweep, MR 2 of eight; D-121 tier T1;
`specs/090-module-owned-error-codes/d129-sweep.md`).

For a consumer this changes which bundle answers for those codes and nothing else. No wire
shape moves — `error.code` is unchanged — and no sentence moves either: none of the twenty has
a translation in `en` or `pl` today, in any bundle, so a Polish reader sees exactly what they
saw before. What a downstream author gains is that writing one of those sentences is now a
change to the module's own `i18n/{en,pl}.json` rather than to the platform's.
