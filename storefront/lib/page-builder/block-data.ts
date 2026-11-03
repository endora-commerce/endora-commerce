import {
  collectBlockDataRequests,
  resolveBlockData,
  type BlockData,
  type BlockDataSource,
} from '@endora-commerce/cms-components/utils/block-data';
import { listBlogPosts } from '../api/blog';
import { getCategoryTree, getProductBySlug, listProducts } from '../api/catalog';
import { getPublicForm } from '../api/forms';
import { StorefrontApiError, type RequestContext } from '../api/client';
import type { ModulePresenceSet } from '../api/module-presence';

/**
 * The fetched data of the Page Builder documents one page renders, resolved
 * on the server so the blocks that show it are part of the HTML
 * (Constitution VII).
 *
 * `ProductGrid`, `ProductSlider`, `ProductCard`, `CategoryList`,
 * `CategoryGrid`, `blog.LatestPosts` and `forms.Form` each declare what they need
 * (`@endora-commerce/cms-components/utils/block-data`); this is the
 * storefront's half — where the answers come from, and **as whom**.
 *
 * ## A module that is off is not asked
 *
 * With `modules` — the presence the request already resolved
 * (`getServerContext`) — a request whose owner module is absent is skipped
 * (Principle XVII); its block is filtered from the render anyway. Without it,
 * every owner is taken as present, as an unread presence degrades open, and an
 * absent module's read simply fails and is left out.
 *
 * ## The reads are the storefront's own, with the request's identity
 *
 * Nothing here builds a URL or a header. Every read goes through
 * `lib/api/catalog`, with the `RequestContext` the page resolved, so a block
 * shows exactly what the product listing and the product page show this
 * viewer:
 *
 *  - the sales channel and the language ride on every read;
 *  - the two reads that carry a price — a product and a listing — go through
 *    `apiGetForViewer`. A visitor with no session gets the public answer from
 *    the shared 60 s cache entry; a signed-in buyer's session cookie is
 *    forwarded and the answer is fetched `no-store`, so a figure negotiated for
 *    one organisation is never written where another caller's request reads;
 *  - the category tree carries no price and nothing about the viewer, and
 *    stays anonymous and shared, as it is for the navigation.
 *
 * The answers are embedded in the page, which is safe for the same reason the
 * product listing's are: every storefront route is rendered per request
 * (`export const dynamic = 'force-dynamic'` in the root layout), so there is no
 * stored page for one buyer's prices to be served from to another. **A route
 * that opts into static or revalidated rendering must not call this with a
 * `viewerSession`** — pass `withoutViewer(ctx)` there.
 *
 * ## One pass, bounded, and a failure is one block's
 *
 * All the documents of a page are resolved together: each distinct product
 * once, each listing once, the tree once, in parallel with a fixed bound
 * (`resolveBlockData`). A read that fails is left out — its block
 * renders its empty state — and this function does not reject, so a catalogue
 * outage costs a CMS page its product blocks and not the page.
 */
export async function resolveBlockDataFor(
  documents: readonly unknown[],
  ctx: RequestContext,
  modules?: ModulePresenceSet,
): Promise<BlockData> {
  const requests = collectBlockDataRequests(documents);
  if (requests.length === 0) return {};
  return await resolveBlockData(requests, blockDataSource(ctx, modules));
}

function blockDataSource(ctx: RequestContext, modules: ModulePresenceSet | undefined): BlockDataSource {
  return {
    ...(modules ? { isModulePresent: (moduleId: string) => modules.isPresent(moduleId) } : {}),
    fetchProductBySlug: async (slug) => {
      try {
        return await getProductBySlug(slug, ctx);
      } catch (err) {
        // A product that is gone, or that this viewer may not see, is simply not in the block.
        if (err instanceof StorefrontApiError && err.status === 404) return null;
        throw err;
      }
    },
    fetchProductsList: async (query) => (await listProducts(query, ctx)).data,
    fetchCategoryTree: async () => await getCategoryTree(ctx),
    // Cards carry no price and nothing about the viewer: the channel and language ride on the read.
    fetchBlogPosts: async (query) => await listBlogPosts(query, ctx),
    // Feature 170 — a form's public read is the same for every viewer: anonymous, shared, tagged.
    fetchForm: async (formId) => await getPublicForm(formId, ctx),
  };
}
