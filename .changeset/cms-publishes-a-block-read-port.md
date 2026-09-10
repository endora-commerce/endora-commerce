---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-megamenu': major
---

`cms` publishes `CmsBlockReadPort`, and `megamenu` resolves its own cross-module targets.

**New on `@endora-commerce/contracts`:** `CmsBlockReadPort`, `CmsBlockRecord` and
`CmsLocalizedBlockRecord`. Two methods, which is the whole of the demand.
`findById(id)` answers *does this block exist* and carries `active` on the record
rather than filtering on it, because the two callers disagree about a deactivated
block on purpose. `findLocalizedById(id, language)` answers *what does it render as
here* and is the reason the port exists: the per-language envelope —
`content.languages[<code>]`, a legacy `schema_version` riding along, an absent key
meaning "nothing authored" — is `cms`' storage layout, and a consumer that had to
know it would be reading the column with extra steps. `null` covers all three
absences, because a caller inlining a block has the same thing to do in each.

**New on `@endora-commerce/mod-cms`:** the port is registered as `cmsBlockReadPort`
with `ctx.di.providePort`, so it fails closed with 503 `MODULE_DISABLED` when an
operator switches the CMS off. Nothing else changed in this package.

**Removed from `@endora-commerce/mod-megamenu/backend`: `TargetValidatorDeps` and
`StorefrontDeps`.** Both existed so a composition root could write eight closures
against them — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
the storefront URL shapes — and this module's own barrel argued they had to stay in
a root until one of the three owners grew an existence-check port. All three have:
`catalogCategoryReadPort`, `cmsPageReadPort` and `assetReadPort` came out of feature
075, and `cmsBlockReadPort` above is the one that was still missing. The module now
resolves those four plus `assetsLibraryPort` with `lazyPort` and declares the edges
in its manifest, where `catalog` joins `cms`, `assets_library`, `languages`,
`sales_channels`, `auth` and `dictionaries`.

**If you contributed `megamenuValidatorDeps` or `megamenuStorefrontDeps`**, delete
both contributions: the container names are read by nobody and registering them now
does nothing. There is no replacement to write, and the interfaces are deleted
rather than relocated — what replaces them is module-private and holds no closure.
Make sure the composition registers the five ports, which it does by composing
`catalog`, `cms` and `assets_library`.

Two behaviours were divergent between the reference deployment and the test harness
and are now single-valued, both settling on the deployment's answer: a category
target resolves to `/c/<slug>` (the harness built `/catalog/<slug>`, which the
reference storefront serves from nowhere), and a deactivated or soft-deleted
category drops its menu item and its children (the harness narrowed on neither).
A CMS page target is deliberately *not* narrowed on status or `active`, which is
what both roots did.
