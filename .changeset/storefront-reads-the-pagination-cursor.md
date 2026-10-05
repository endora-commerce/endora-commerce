---
'@endora-commerce/cli': patch
---

The storefront this package scaffolds read the product list's pagination from a field the API does
not send. The published shape is `{ cursor, hasMore, limit }`; the storefront declared and read
`nextCursor`, which was therefore always `undefined`. Three things followed, and the third can
take a shop offline:

- `/catalog`, `/search` and `/c/<slug>` never offered a next page, so a shop with more products
  than one page showed only the first.
- `/sitemap.xml` asked for the first page of products over and over until it had 5000 URLs, and
  listed those products many times each and none of the others.
- **An unpatched storefront can stop answering every request when `/sitemap.xml` is requested.**
  When the first page of products comes back empty while reporting more — which the API does
  answer, when the first rows it pages over belong to another sales channel — the sitemap's loop
  had no exit and, served from the data cache, never yielded: one core at 100 % and no response
  to anything until the process is restarted. Any crawler can trigger it.

A storefront created by `endora new` at this version or later carries the fix. **A storefront
created earlier keeps its source through `endora upgrade`, which moves packages only, so it has
to be patched by hand.** Five files; if yours has not been customised the edits are exactly:

1. `lib/api/catalog.ts` — add `Pagination` to the `import type { … } from
   '@endora-commerce/contracts'` list, and in `ListProductsResponse` replace the hand-written
   `pagination: { limit: number; nextCursor: string | null; hasMore: boolean; }` with
   `pagination: Pagination;`.
2. `app/(catalog)/catalog/page.tsx` and `app/(catalog)/c/[slug]/page.tsx` — one line each:
   `nextCursor={products.pagination.nextCursor}` becomes
   `nextCursor={products.pagination.cursor}`. `components/Pagination.tsx` does not change.
3. `app/page.tsx` — in the `listProducts(...).catch(...)` fallback, `nextCursor: null` becomes
   `cursor: null`.
4. `app/sitemap.ts` — replace the whole `productUrls` function with:

   ```ts
   async function productUrls(ctx: Ctx): Promise<string[]> {
     const urls = new Set<string>();
     try {
       const asked = new Set<string>();
       let cursor: string | undefined;
       for (let pages = 0; pages < 100 && urls.size < PRODUCT_URL_LIMIT; pages += 1) {
         const page = await listProducts({ limit: 100, ...(cursor ? { cursor } : {}) }, ctx);
         for (const product of page.data) urls.add(absoluteUrl(`/p/${product.slug}`));
         const next = page.pagination.cursor;
         if (!page.pagination.hasMore || !next || asked.has(next)) break;
         asked.add(next);
         cursor = next;
       }
     } catch {
       // Short rather than a 500: the pages already walked are real URLs.
     }
     return [...urls].slice(0, PRODUCT_URL_LIMIT);
   }
   ```

   The loop is now bounded whatever the API answers: at most 100 requests, never the same cursor
   twice, and each product listed once.

Then run `pnpm run typecheck` — after step 1 it reports any other place that still reads
`nextCursor` — and rebuild and redeploy the storefront. If you cannot patch at once, restarting
the storefront clears a hang, and it will recur on the next request for `/sitemap.xml` that meets
an empty first page.
