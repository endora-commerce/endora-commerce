---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-cms': patch
---

Issue #992: a CMS hook (`GET /api/v1/cms/hooks/by-code`) and a block fetched by its code (`GET /api/v1/cms/blocks/by-code`) now answer `assets`, the details of the library assets their trees embed, as a page (`/cms/pages/by-slug`) always has. Without it the storefront rendered every library image of a hook or a standalone block — the header and footer hooks of the root layout, a footer logo — at a bare `/assets/file/<id>`, which is `public, no-cache` and so revalidated on every visit, where the same image in a page's content is served `immutable` at its `?v=` URL.

The map is resolved the way a page's is since #685: one batched read for every block of the hook, never a read per block or per image, and only when the answer is not already cached. `@endora-commerce/contracts` adds `assets` to `cmsResolvedHookSchema` and a new `cmsResolvedBlockByCodeSchema` (`CmsResolvedBlockByCode`), `cmsResolvedBlockSchema` extended with it; both are optional, so an answer cached before this release still parses and reads as no assets. `cmsResolvedBlockSchema` itself, which a page's `embeds.blocks` also uses, is unchanged.
