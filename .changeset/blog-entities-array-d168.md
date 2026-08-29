---
'@endora-commerce/mod-blog': major
---

**Breaking:** `@endora-commerce/mod-blog/backend` no longer exports any entity class by name.
It exports one `entities` array instead (D-168).

```ts
// before — eleven names, one per class
import { BlogPost, BlogCategory } from '@endora-commerce/mod-blog/backend';

// after — there is no replacement, and that is the point
import { entities } from '@endora-commerce/mod-blog/backend';
// entities: readonly [BlogCategory, BlogCategoryLanguage, BlogCategorySalesChannel,
//   BlogPost, BlogPostCategory, BlogPostLanguage, BlogPostRelatedPost,
//   BlogPostRelatedProduct, BlogPostSalesChannel, BlogPostTag, BlogTag]
```

The array is the value a host's ORM registers, and it is what this package's consumers actually
need: `configured-entities.ts` merges it into the entity set, and nothing else can usefully
name an entity class. If you were importing one as a **type**, you were reaching into another
module's internals — reach for the shape in `@endora-commerce/contracts` instead
(`BlogPostDetail`, `BlogPostSummary`, `BlogCategoryTreeNode`, …), which is the published
contract for every one of these rows. If you were relating to one with a MikroORM decorator,
that was already forbidden (`check:kernel-boundary`, D-32).

**Also fixed, and it was worse:** `@endora-commerce/mod-blog/migrations` now exports a
`migrations` array beside the migration class it already named. It published only
`export * from './20260506T081055_blog_init.js'`, and the platform's package loader refuses a
`./migrations` export that declares no such array — so **an installed copy of this package
stopped the host from booting**, with
`the "./migrations" export of @endora-commerce/mod-blog exports no 'migrations' array`. The
class name is unchanged, so no database sees a migration it has already applied as pending.

Neither defect was reachable from this repository, which is why both shipped: a workspace
member is linked rather than installed, and the host's committed entity registry imported the
eleven classes directly. Packed into a tarball and installed into an instance — the way the
package is actually consumed — the module registered **zero** entities, silently, once the
migrations barrel stopped refusing the package outright.
