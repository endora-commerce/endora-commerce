---
'@endora-commerce/contracts': minor
---

A module can declare the Page Builder blocks it owns.

`BlockDefinitionSchema` / `BlockDefinition` and `BlockCategorySchema` /
`BlockCategory` are new, beside `cmsPageBuilderDescriptorSchema` in `cms.ts`.
`ModuleManifestSchema` gains two optional arrays, `blocks` and `blockCategories`,
beside `permissions`, `actions` and `errorCodes`:

```ts
export const manifest = defineModuleManifest({
  id: 'catalog',
  // …
  blocks: [
    {
      name: 'catalog.ProductGrid',          // persisted — see below
      labelKey: 'blocks.productGrid.label', // module-relative, never 'catalog.blocks.…'
      category: 'catalog',
      contexts: ['cms'],
      fields: { columns: { type: 'number' } },
      defaultProps: { columns: 4 },
      responsiveFields: ['columns'],
      previewIcon: 'LayoutGrid',
      weight: 10,
    },
  ],
  blockCategories: [
    { key: 'catalog', titleKey: 'blocks.category.catalog', contexts: ['cms'], weight: 40 },
  ],
});
```

**`name` is persisted and permanent.** It is written into the `type` position of
a Puck node in a `jsonb` column and is the only link between a stored node and
the module that can render it. `blockNameRe` —
`/^[a-z][a-z0-9_]*\.[A-Z][A-Za-z0-9]*$/` — is exported as the one authored copy
of that grammar, and `blockCategoryKeyRe` as the category key's. **There is no
`ownerModule` field**: the owner is the segment before the `.`, so ownership is
stated once rather than twice.

**`defineModuleManifest` refuses three things**, each naming the module: a `name`
whose owner segment is not the declaring module's own `id`; an empty `contexts`;
and a `category` the same manifest does not declare in `blockCategories` for at
least one of the block's contexts. A malformed name is refused before the owner
comparison, because a name with no separator has no segment to compare. Nothing
about a *second* manifest is decided here — a duplicate name across two modules
is composition's question, as it is for `errorCodes`.

`cmsPageBuilderDescriptorSchema` is extended **additively**: each component entry
may now carry `labelKey`, `descriptionKey`, `category`, `defaultProps`,
`responsiveFields` and `weight`, and the descriptor may carry `categories`. All
of them are optional and `name` deliberately keeps no grammar, so a consumer
reading only the five fields that were there before is unaffected and the
response is unchanged until a module declares a block.

This is vocabulary only. No module declares a block yet, the registry is not
populated from these declarations yet, and no stored content is touched — the
migration that namespaces the 74 names already in the database is a later
change, and until it lands nothing may write a namespaced name into a document.
