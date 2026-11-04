import { notFound, permanentRedirect, redirect } from 'next/navigation';
import type { ProductDetail, ProductPagePaths } from '@endora-commerce/contracts';
import { getProductBySlug, resolveProductKey } from '../../../../lib/api/catalog';
import { StorefrontApiError, type RequestContext } from '../../../../lib/api/client';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md`
 * §4, §6) — the product page's key handling, apart from the page so it can be
 * tested without rendering it.
 *
 * A URL key is valid only in its own language (K1), so the page first asks the
 * backend which product the key names at this request's channel and language, and
 * then reads that product **by id**. Every product URL this answers with — the
 * redirect target, the canonical, the alternates — was built by the backend with
 * `productPath()`, under the language's path prefix (feature 167): the storefront
 * composes none of its own.
 */

/**
 * The id of the product `key` names here. A redirect answers the backend's path:
 * permanently (308) for a former key, temporarily (307) for a current key of the
 * product in another channel language (feature 167, FR-024 — the mapping depends on
 * key data that can change hands); a key of no product, or of a product this
 * request may not see, answers the page's not-found. So does an archived
 * product's `410 PRODUCT_ARCHIVED` (T155 finding B4): rethrown, it rendered the
 * error page as an HTTP 500; the shopper is shown the ordinary not-found page,
 * with a 404 status — the App Router page has no way to answer 410 itself.
 * Anything else (a backend failure) is the error page.
 *
 * `permanentRedirect` and `notFound` throw: neither may be called inside a
 * `try` that would catch it. The 308 is not shared-cacheable: the page reads the
 * request's cookies (`getServerContext`), so Next renders it dynamically and sends
 * `Cache-Control: private, no-cache, no-store`.
 */
export async function productIdForKey(key: string, ctx: RequestContext): Promise<string> {
  let resolution;
  try {
    resolution = await resolveProductKey(key, ctx);
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 410)) notFound();
    throw err;
  }
  if (resolution.kind === 'redirect') {
    // Checkpoint E security review (I3) — a redirect never leaves the product pages:
    // a path the backend did not build as `/p/<key>` (protocol-relative, absolute,
    // backslash or another route) is answered as a key of no product.
    if (!isProductPagePath(resolution.path)) notFound();
    if (resolution.permanent) permanentRedirect(resolution.path);
    // The backend built this path for this request's language; it already carries
    // the prefix, so it is not localized again.
    redirect(resolution.path);
  }
  return resolution.productId;
}

/**
 * The product `productIdForKey` named, read by id. A product that became unavailable
 * or was archived between the two reads (`404` / `410`) answers the page's not-found,
 * as the resolve does (T155 finding B4); anything else is the error page.
 */
export async function productById(productId: string, ctx: RequestContext): Promise<ProductDetail> {
  try {
    // Feature 172 — the page's own read is the one that draws content attributes.
    return await getProductBySlug(productId, ctx, { include: ['content'] });
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 410)) notFound();
    throw err;
  }
}

/**
 * `/p/<one segment>` under an optional lower-case language prefix (feature 167),
 * optionally with a query — never `//…`, a scheme or a backslash.
 */
function isProductPagePath(path: string): boolean {
  return /^(\/[a-z]{2,3}(-[a-z0-9]{1,8})*)?\/p\/[^/\\?#]+(\?[^\\#]*)?$/.test(path);
}

/**
 * The page's `hreflang` links: one per language the product is available in to
 * anonymous visitors, each the path the backend built (FR-074), plus `x-default` —
 * the unprefixed URL (feature 167, url-shape §8) — or `undefined` when there is none. The canonical is `paths.canonical`, written into the metadata
 * literal by the page itself so the indexability check can read it.
 */
export function alternateLanguages(paths: ProductPagePaths): Record<string, string> | undefined {
  if (paths.alternates.length === 0) return undefined;
  return {
    ...Object.fromEntries(paths.alternates.map((alternate) => [alternate.languageCode, alternate.path])),
    'x-default': paths.xDefault,
  };
}
