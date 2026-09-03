---
'@endora-commerce/cms-components': major
---

`defaultPageBuilderConfig`'s hidden drawer is keyed `internal`, not `_internal`.

```ts
// before
defaultPageBuilderConfig.categories._internal   // { title: 'Internal', visible: false, … }
// after
defaultPageBuilderConfig.categories.internal
```

Same word, same title, same `visible: false`, same two components (`Column` and
`Slide`) — only the key moves. A declared palette section's key is
`^[a-z][a-z0-9_]*$` (`blockCategoryKeyRe` in `@endora-commerce/contracts`), which
forbids a leading underscore, and this section becomes `mod-cms`' `internal`
declaration.

It is a major because the key is part of an exported object: anything indexing
`categories._internal`, or deriving a translation key from it, has to move in the
same release. In this repository that is one i18n key,
`pageBuilder.categories._internal` in `@endora-commerce/mod-cms`' bundles, which
moves with it.
