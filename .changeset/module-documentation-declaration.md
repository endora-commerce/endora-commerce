---
'@endora-commerce/contracts': minor
'@endora-commerce/cli': minor
---

A module can declare where its documentation lives, and the tooling can find it.

`@endora-commerce/contracts` gains `ModuleDocsManifestSchema`,
`ModuleDocsDeclarationSchema` and an optional `docs` field on `ModuleManifestSchema`.
Its shape is `i18n`'s and it is located the same way — a directory at the **package
root**, in the package's `files` list, with **no `exports` subpath**, found by joining
`docs.dir` to `dirname(manifestPath)`. The anchor is the platform's, so nothing in a
module names a package, a repository root or a build directory in order to find its own
pages.

```ts
export const manifest = defineModuleManifest({
  id: 'inpost',
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },   // ships pages
  // docs: false,          // ships none, deliberately
});
```

**`false` and absent are not the same state**, and consumers must not collapse them:
absent is a module nobody has decided about, `false` is a decision. A universal
obligation over a population where some members legitimately owe nothing is repaired by
empty files whose only effect is to make a check pass, which is why the decision has a
spelling of its own.

`@endora-commerce/cli` gains `lib/module-docs.js`: `resolveDocsLayout` (the Docusaurus
site, from the workspace member declaring a configuration), `collectDocPages`,
`parseFrontMatter`, `attributeDocs` and `moduleOfSlug`. It is the one derivation behind
both the generated documentation navigation and the check that refuses its population
defects — a second derivation of one population is two answers waiting to disagree, which
is the state it replaces: three hand-maintained lists described the modules this platform
composes and all three disagreed with it and with each other.

No existing symbol changed, and a manifest that declares no `docs` is unaffected.
