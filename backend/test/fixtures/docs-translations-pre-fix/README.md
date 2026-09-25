# `docs-translations-pre-fix` — the tree that carried the defect

Captured on 2026-09-23 from branch `docs/133-docs-site-publication` at `36c4f560a`, **before** any
task of `specs/133-docs-site-publication/` edited a translation file, the Docusaurus configuration or
the documentation-page generator (feature 133, T001; FR-043, SC-018).

These four files are the input `check:docs-translations` was green against while the entire Polish
chrome rendered in English. They exist so the corrected check can be shown failing on the shipped
artefact rather than on a synthetic one.

| File | Copied verbatim from | What it carries |
| --- | --- | --- |
| `code.json` | `docs/i18n/pl/code.json` | 196 ids: 3 `theme.*`, 77 `sidebar.main.category.*`, 116 `sidebar.main.doc.*` — every one of them in a file Docusaurus never reads them from |
| `module-reference-catalog.md` | `docs/docs/module-reference/catalog.md` | a generated page whose `<!-- AUTO-GENERATED` banner occupies lines 1–4, so its `---` front matter opens on line 5 and `title`, `sidebar_label` and `description` are inert |
| `intro.pl.md` | `docs/i18n/pl/docusaurus-plugin-content-docs/current/intro.md` | the Polish home page: front matter at byte 0 with no `title`, and a translation-policy admonition as its first content node, so no `contentTitle` is reachable either |
| `config-key-set.json` | `docs/docusaurus.config.js`'s `themeConfig` and `docs/sidebars.js`, both `require`d and serialised | the two inputs the chrome id set is derived from, resolved — so `sidebars.main` carries the 69 categories `sidebars.modules.generated.js` contributes as well as the 8 written by hand: 77 categories in all, 5 of them with a `generated-index` link, plus 7 translatable doc items and 103 bare ones |

**Do not refresh these from the working tree.** Their sha256 values are pinned in
`backend/test/unit/scripts/check-docs-translations.test.ts` (T002), and that pin is a provenance
assertion: after the chrome seam lands, the artefacts above no longer exist in this shape, so a
fixture regenerated from the fixed tree fails its own hash assertion by design. Recovering them
from history (`git show <pre-fix-sha>:docs/i18n/pl/code.json`) is possible and is not what the pin
refuses — it refuses the accident of a builder regenerating a fixture from the tree in front of it.
