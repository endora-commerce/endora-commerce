import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError, markPersonalisedPricing } from '@endora-commerce/platform/http';
import type { UrlKeyResolutionService } from './services/url-key-resolution.service.js';
import type { CatalogQueryContext } from './services/catalog-query.service.js';

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md`
 * §4) — `GET /api/v1/catalog/products/resolve/:key`: which product a storefront
 * key names at the request's (channel, language), or where it redirects.
 *
 * The channel is the one the canonical middleware resolved (Constitution XII) and
 * the audience comes from the session (`productAudienceOf`), never from the
 * client; both reach this route through the catalogue's own request context
 * reader. The answer depends on the audience — an unavailable product is not
 * found, for a redirect too — so a signed-in caller's answer is stamped
 * `private, no-store`.
 *
 * A redirect is answered as `200` with `kind: 'redirect'` rather than a `301`: the
 * storefront's server fetch would follow a `301` silently and render the target
 * under the old URL (research R12).
 */
export interface CatalogUrlKeyPublicDeps {
  resolutionService: UrlKeyResolutionService;
  /** `routes.public.ts`'s reader — the one place a catalogue request's channel, language and audience are read. */
  readContext: (request: FastifyRequest) => CatalogQueryContext | Promise<CatalogQueryContext>;
}

/** A key longer than the column holds names no product (the `products.slug` width). */
const KEY_MAX_LENGTH = 160;

export async function registerCatalogUrlKeyPublicRoutes(
  app: FastifyInstance,
  deps: CatalogUrlKeyPublicDeps,
): Promise<void> {
  const { resolutionService, readContext } = deps;

  app.get<{ Params: { key: string } }>('/api/v1/catalog/products/resolve/:key', async (request, reply) => {
    const ctx = await readContext(request);
    markPersonalisedPricing(reply, ctx.audience);
    const key = request.params.key;
    if (key.length === 0 || key.length > KEY_MAX_LENGTH) {
      throw new HttpError(404, ERROR_CODES.PRODUCT_NOT_FOUND, 'Product not found.');
    }
    return { data: await resolutionService.resolve(key, ctx) };
  });
}
