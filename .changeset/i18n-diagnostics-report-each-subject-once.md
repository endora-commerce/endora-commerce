---
'@endora-commerce/admin-kit': patch
---

`TranslationProvider`'s development diagnostics report each distinct subject once

`useTranslation`'s and `TranslationProvider`'s two `import.meta.env.DEV` warnings — `[i18n] bundle
fetch failed` and `[i18n] missing <language>: <scope>.<key>` — now print the first occurrence of
each distinct subject in full, stack included, and drop exact repeats for the life of the module
registry (one page load in a browser, one test file under vitest). No exported symbol, signature or
production code path changes, and nothing is silenced: every distinct fact still reaches the console
in its complete form.

It is a `patch` rather than an empty changeset because the question
`specs/conventions/release-intent.md` asks is *"does this commit change what a published package
emits?"* — and this one does. `packages/admin-kit/tsconfig.build.json` compiles `src`, so
`src/i18n/TranslationProvider.tsx` is code the package ships, not a comment or a test. A consumer of
this package sees a different development console after upgrading, which is a consumer-visible
change even though it is not a behavioural one.

Why it was worth shipping: the repetition destroyed the artefact it was printed into. One green
`pnpm --filter '!backend' run test` measured **5 509 606 bytes**, 1.31x GitLab's 4 194 304-byte log
ceiling, of which 64.2% was 38 201 missing-key lines carrying 920 distinct keys and a further 25.5%
was 673 copies of one fetch failure with a ten-frame stack apiece. Master pipeline 14265's
`test:frontend` was red and the reason was unobtainable, because vitest prints its failure summary
last and the summary was past the cut.
