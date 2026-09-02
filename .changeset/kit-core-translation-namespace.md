---
'@endora-commerce/admin-kit': minor
---

`CategoryTreePicker` now resolves its strings in the `core` namespace instead of `catalog`
(feature 091, ruling R-1: a translation namespace is module knowledge and the kit holds none).
It is the last of the three components the ruling names; `AssetPicker` and `AssetUploader`
moved in the preceding release.

**What a consumer has to do: nothing, if it renders inside the platform's own
`TranslationProvider`.** All seven keys moved with the component and kept their spelling —
`categoryTreePicker.loading`, `.filter.placeholder`, `.aria.treeLabel`, `.empty.noCategories`,
`.empty.noMatches`, `.expand`, `.collapse` — so only the namespace changed, and no rendered text
changes.

**What a consumer that supplies its own bundle has to do:** move those seven keys from the
`catalog` scope of the bundle into `core`. A key left behind does not fail to compile and does
not 404 — it renders `core.categoryTreePicker.loading` into the screen as a label.
