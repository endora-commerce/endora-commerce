---
'@endora-commerce/mod-i18n': minor
---

Add `composeErrorTranslationTargets(manifests)`, the error-code routing map a composition root
injects while feature 090's migration is in flight.

`buildErrorTranslationTargets` (shipped in the previous release) answers only from the modules'
own `errorCodes` declarations, which is the end state. Nothing declares a code yet, so injecting
it alone would empty the map and take every operator-visible sentence in both shipped languages
out of reach at once. `composeErrorTranslationTargets` is the transitional shape:

- a code its owner has declared routes to that owner;
- a code nobody has declared yet keeps the answer `ERROR_TRANSLATION_KEYS` gives it;
- a code more than one module declares routes to **neither**, and is absent from the map even
  when the incumbent table has an answer for it — the incumbent is not a tie-break
  (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §3.4).

The collisions come out of the same call, so the report and the routing cannot disagree.

```ts
const { targets, collisions } = composeErrorTranslationTargets(await resolvedManifestEntries());
buildServer({ errorEnvelope: { errorTranslationTargets: targets } });
```

It is deleted together with `ERROR_TRANSLATION_KEYS` when the last module migrates; callers then
pass the same argument to `buildErrorTranslationTargets`. No routing answer changes in this
release — the two are asserted equal over the whole of `ERROR_CODES`.
