---
'@endora-commerce/cli': minor
---

**Breaking for scripts that call `endora new module`.** A title-case `--name` is now refused
before any file is written, and the command exits non-zero. The name becomes the module's
manifest `name` and its English `module.name`, and both are held to sentence case: capitalise
the first word only. Change the `--name` in your script; nothing else changes.

Refused:

```bash
endora new module demo_widgets --name "Demo Widgets" --description "Widgets for the demo."
# --name "Demo Widgets" is not sentence case (Widgets). Write "Demo widgets": …
```

Accepted:

```bash
endora new module demo_widgets --name "Demo widgets" --description "Widgets for the demo."
```

Acronyms such as `ERP` and the allowlisted product names (for example `Google Analytics`) are
accepted as typed. A product name that must keep its capitals belongs in the allowlist.

The rule and its allowlist are exported as `@endora-commerce/cli/lib/sentence-case.js`
(`judgeSentenceCase`, `toSentenceCase`, `SENTENCE_CASE_PROPER_NOUNS`).
