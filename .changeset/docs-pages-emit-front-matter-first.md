---
'@endora-commerce/cli': minor
---

Generated documentation pages emit their YAML front matter before the do-not-edit banner.

`emitModuleReference` and `emitModuleMap` (`lib/docs-artefacts.js`, and therefore
`renderModuleReferencesFrom`, `renderModuleMapFrom` and `endora generate`'s documentation
artefacts) used to write the `<!-- AUTO-GENERATED … -->` comment first and open the `---` fence
underneath it. Front matter is front matter only at byte 0, so Docusaurus never parsed that
block: `title`, `sidebar_label` and `description` were inert on every generated page, and
because the banner was then also the page's first content node — an HTML comment rather than a
`# ` heading — the `contentTitle` fallback was closed too. Every module reference page and the
module map shipped titled with its own doc id (`catalog | Your Site`) instead of the title it
declared, in the site navigation, the browser tab, the `<title>` element and the social preview.

A front-matter value that YAML would misread is now double-quoted. The reference page's
`description` is the sentence *"Everything the `<id>` module's manifest declares: permissions,
…"*, and `: ` inside a plain scalar is an incomplete mapping pair — so the moment the block above
became parseable, `docusaurus build` failed in `gray-matter` on the first generated page it read.
Quoting is on demand: a value that needs none is still emitted plain, so `title` and
`sidebar_label` are unchanged.

The banner is unchanged and still emitted, one blank line below the closing fence, where it is
still a plain "do not edit" instruction to anyone reading the source and is invisible in the
rendered page. The `header` parameter of both functions keeps its meaning, so a host passing its
own banner string needs no change.

**Regenerate and commit the rewritten pages** — `pnpm --filter backend run composer:generate` in
this repository, `endora generate` in an instance. The bytes of every generated page change, so a
tree that does not regenerate will fail `overlay:check` (or its instance equivalent) on the
drift. If you keep translated copies of these pages, their front matter has to move too, and any
hash you have pinned against the English body changes with it: the body now begins with the
banner.
