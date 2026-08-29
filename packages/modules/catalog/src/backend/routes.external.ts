import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  catalogBulkPriceRequestSchema,
  ERROR_CODES,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { productAudienceOf } from '@endora-commerce/platform/http';
import type { CatalogQueryService } from './services/catalog-query.service.js';
import type { CatalogOrgPriceDecorator } from './services/catalog-org-price-decorator.js';

/**
 * Feature 062 — external catalog namespace (`/api/v1/external/catalog/*`),
 * per contracts/catalog-api-key-reads.md and research §R7.
 *
 * Thin wrappers ONLY: query logic lives in `CatalogQueryService`, pricing in
 * `PricingService` via `CatalogOrgPriceDecorator` — this file is mounting +
 * decoration. The public (`routes.public.ts`) and PIM (`routes.api-key.ts`)
 * surfaces are untouched.
 *
 * Namespace invariants (§0):
 *  - every endpoint requires an API key (`requireApiKey('catalog:read')`;
 *    bulk pricing additionally requires a bound key);
 *  - every response carries `Cache-Control: private, no-store` (scoped hook);
 *  - reads use the Postgres path unconditionally (deterministic sync; the
 *    only path supporting `changedSince`) — `x-search-backend: postgres`;
 *  - channel: bound keys are pinned by the frozen resolver step 0; unbound
 *    keys keep header/host/default resolution. Handlers only READ the
 *    resolved channel + actor — all auth/tenancy/channel derivation already
 *    happened in earlier hooks.
 */

export type ExternalGateFactory = (
  scope: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CatalogExternalDeps {
  queryService: CatalogQueryService;
  decorator: CatalogOrgPriceDecorator;
  requireApiKey: ExternalGateFactory;
  requireBoundApiKey: ExternalGateFactory;
}

const externalListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
  changedSince: z.string().datetime({ offset: true }).optional(),
  categorySlug: z.string().optional(),
  q: z.string().optional(),
});

export async function registerCatalogExternalRoutes(
  app: FastifyInstance,
  deps: CatalogExternalDeps,
): Promise<void> {
  const { queryService, decorator, requireApiKey, requireBoundApiKey } = deps;

  // Encapsulated scope so the no-store rule applies to exactly this
  // namespace's responses (success and error alike) and nothing else.
  await app.register(async (external) => {
    external.addHook('onSend', async (_request, reply, payload) => {
      reply.header('cache-control', 'private, no-store');
      return payload;
    });

    // GET /api/v1/external/catalog/products
    external.get(
      '/api/v1/external/catalog/products',
      { preHandler: requireApiKey('catalog:read') },
      async (request, reply) => {
        const query = externalListQuerySchema.parse(request.query ?? {});
        const ctx = readContext(request);
        const result = await queryService.listProducts(
          {
            q: query.q,
            limit: query.limit,
            cursor: query.cursor,
            categorySlug: query.categorySlug,
            changedSince: query.changedSince,
          },
          ctx,
        );
        reply.header('x-search-backend', 'postgres');
        const data = await decorator.decorateSummaries(result.data, {
          organizationId: boundOrganizationId(request),
          salesChannel: ctx.resolvedChannel,
        });
        return { ...result, data };
      },
    );

    // GET /api/v1/external/catalog/products/:idOrSlug
    external.get<{ Params: { idOrSlug: string } }>(
      '/api/v1/external/catalog/products/:idOrSlug',
      { preHandler: requireApiKey('catalog:read') },
      async (request, reply) => {
        const ctx = readContext(request);
        const product = await queryService.getProductByIdOrSlug(request.params.idOrSlug, ctx);
        reply.header('x-search-backend', 'postgres');
        const data = await decorator.decorateDetail(product, {
          organizationId: boundOrganizationId(request),
          salesChannel: ctx.resolvedChannel,
        });
        return { data };
      },
    );

    // GET /api/v1/external/catalog/categories
    external.get(
      '/api/v1/external/catalog/categories',
      { preHandler: requireApiKey('catalog:read') },
      async (request) => {
        const ctx = readContext(request);
        const tree = await queryService.getCategoryTree(ctx);
        return { data: tree };
      },
    );

    // POST /api/v1/external/catalog/prices — bound keys only (org pricing).
    external.post(
      '/api/v1/external/catalog/prices',
      { preHandler: requireBoundApiKey('catalog:read') },
      async (request) => {
        // Parsed in-handler (not via the route schema) because the contract
        // pins whole-request shape errors — including >200 lines — to 422.
        const parsed = catalogBulkPriceRequestSchema.safeParse(request.body);
        if (!parsed.success) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            'Request failed validation.',
            parsed.error.issues.map((issue) => ({
              path: issue.path.map(String).join('.'),
              issue: issue.message,
            })),
          );
        }
        const binding = (
          request as FastifyRequest & { apiKeyBinding?: { organizationId: string } }
        ).apiKeyBinding;
        if (!binding) {
          // Defensive — requireBoundApiKey always stashes the binding.
          throw new HttpError(
            403,
            ERROR_CODES.API_KEY_NOT_BOUND,
            'This endpoint requires a distributor-bound API key.',
          );
        }
        const channel = getResolvedChannel(request);
        const data = await decorator.resolveBulkPrices(parsed.data.lines, {
          organizationId: binding.organizationId,
          salesChannel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
        });
        return { data };
      },
    );
  });
}

/**
 * Bound org from the resolved api-key actor; null for unbound keys.
 *
 * `request.actor` and `request.apiKeyBinding` are `declare module 'fastify'`
 * augmentations owned by `auth` and `api_keys`. Inside `backend/src` they were
 * ambient — one program, so every module saw them without asking. A package is
 * its own program and sees only what it imports, and importing either owner's
 * `plugin.ts` for a type would be a cross-module reach for an interface neither
 * publishes. So the two reads narrow locally, which is the shape
 * `admin_notifications` and `carts` already use for the same augmentation.
 */
function boundOrganizationId(request: FastifyRequest): string | null {
  const actor = (request as FastifyRequest & { actor?: unknown }).actor as
    | { kind: string; organizationId?: string | null }
    | undefined;
  if (!actor || actor.kind !== 'api_key') return null;
  return actor.organizationId ?? null;
}

function readContext(request: FastifyRequest): {
  resolvedChannel: {
    id: string;
    code: string;
    isPublic: boolean;
    defaultCurrency: string;
    defaultLanguage: string;
  };
  audience: ProductAudience;
  preferredLanguage?: string | undefined;
} {
  const channel = getResolvedChannel(request);
  const acceptLanguage = request.headers['accept-language'];
  const preferredLanguage =
    typeof acceptLanguage === 'string' ? acceptLanguage.split(',')[0]?.trim() : undefined;
  return {
    resolvedChannel: {
      id: channel.id,
      code: channel.code,
      isPublic: channel.isPublic,
      defaultCurrency: channel.defaultCurrency,
      defaultLanguage: channel.defaultLanguage,
    },
    audience: productAudienceOf(request),
    preferredLanguage,
  };
}
