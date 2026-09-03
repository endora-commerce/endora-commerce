---
'@endora-commerce/contracts': minor
---

`defineModuleManifest` refuses two more block declarations.

**Rule 2 is now per context.** A block's `category` must be declared by the same
manifest for **every** one of the block's `contexts`, not for at least one of
them:

```ts
// Accepted before this release, refused now:
blocks: [{ name: 'catalog.ProductGrid', category: 'catalog', contexts: ['cms', 'email'], … }],
blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms'] }],
//                                                            ^ 'email' is missing

// The fix is one word, because one entry may list every context it serves:
blockCategories: [{ key: 'catalog', titleKey: '…', contexts: ['cms', 'email'] }],
```

Under the old reading that manifest was legal and `catalog.ProductGrid` was
uninsertable in the e-mail palette with **no error anywhere** — the section it
names does not exist there, and a palette renders no section for a category
nothing declares. The message names the first context that is missing.

**Rule 4 is new**: no two of one manifest's `blockCategories` entries may cover
the same `(key, context)` pair. A section is one record — `titleKey`, `weight`
and `visible` resolve together, never field by field — so a manifest that states
one twice has stated a presentation for nobody to reconcile. Two entries under
one key are still legal when their `contexts` are disjoint, which is how one
module declares `layout` in the CMS palette and `layout` in the e-mail one.

Note that a duplicate `(key, context)` across **two** modules is the opposite: it
is normal, expected and merges. `contracts/block-definition.md` §1.1 of
`specs/096-page-builder-block-ownership/` is normative for that merge, and the
doc blocks on `assertBlockRules` and `BlockCategorySchema` cite it rather than
restating it.

The bump is a minor rather than a major because the surface it tightens —
`blocks` and `blockCategories` on `ModuleManifestSchema` — was added in the
immediately preceding minor and has no consumer outside this repository yet. If
you are reading this having already shipped a manifest that declares blocks,
treat it as breaking and check your `contexts` lists.
