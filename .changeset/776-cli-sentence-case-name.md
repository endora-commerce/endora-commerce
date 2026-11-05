---
'@endora-commerce/cli': patch
---

`endora new module` now refuses a `--name` that is not in sentence case, before it writes any
file. The error names the words at fault and the form to use instead: `--name "Demo Widgets"`
is refused with `Write "Demo widgets"`. Acronyms such as `ERP` and the allowlisted product names
(for example `Google Analytics`) are accepted as typed.

The rule and its allowlist are exported as `@endora-commerce/cli/lib/sentence-case.js`
(`judgeSentenceCase`, `toSentenceCase`, `SENTENCE_CASE_PROPER_NOUNS`).
