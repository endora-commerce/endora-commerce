---
'@endora-commerce/mod-cms': patch
---

Documentation: "Extending the Page Builder" now describes how a module contributes a block
today — by declaring `blocks` and `blockCategories` in its own module manifest, with a
`<module id>.<Name>` block name — instead of calling `PageBuilderRegistry.register` from
`composition.ts`, which no longer exists. It states the two rules `defineModuleManifest`
enforces, that a duplicate name throws `DuplicateBlockNameError` rather than overwriting, that
`contexts` is required, and that a module published outside this repository cannot add a
renderer to `@endora-commerce/cms-components` without changing that package.
