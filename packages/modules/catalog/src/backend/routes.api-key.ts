import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createProductRequestSchema } from '@endora-commerce/contracts';
import type { CatalogQueryService } from './services/catalog-query.service.js';
import type { CatalogAdminService } from './services/catalog-admin.service.js';
import type { AttributeSetService } from './services/attribute-set.service.js';
import { Product } from './entities/product.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * API-key catalog routes (T071) — external integrations (PIM sync, ERP).
 *
 * - PUT /catalog/products/by-sku/:sku — upsert by SKU. Convenience for PIM
 *   integrations that don't track our internal UUIDs.
 * - GET /catalog/products?changedSince=… is already handled by the public
 *   listProducts surface (it accepts the changedSince query param). API-key
 *   auth gates that surface in production via the api_keys module (US7).
 *
 * Today the gate is a no-op preHandler because the api_keys module ships in
 * US7. The route is wired now so PIM integrations can hit it once the gate
 * tightens.
 */

export interface CatalogApiKeyDeps {
  queryService: CatalogQueryService;
  adminService: CatalogAdminService;
  /**
   * Feature 002 — read-only AttributeSet surface for api-key clients
   * (PIM / ERP integrations sync per-product attribute schemas). Optional
   * so dev/test composition roots can wire it progressively.
   */
  attributeSetService?: AttributeSetService;
  emFactory: () => EntityManager;
  /** Pre-handler that asserts api-key + scope; defaults to allow-all. */
  requireApiKey?: (
    scope: string,
  ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

const PASS_THROUGH = (): ((req: FastifyRequest, reply: FastifyReply) => Promise<void>) =>
  async () => {
    // no-op gate — replaced by the api_keys module in US7
  };

export async function registerCatalogApiKeyRoutes(
  app: FastifyInstance,
  deps: CatalogApiKeyDeps,
): Promise<void> {
  const requireApiKey = deps.requireApiKey ?? (() => PASS_THROUGH());

  app.put<{ Params: { sku: string } }>(
    '/api/v1/catalog/products/by-sku/:sku',
    {
      preHandler: requireApiKey('catalog:write'),
      schema: { body: createProductRequestSchema },
    },
    async (request, reply) => {
      const sku = request.params.sku;
      const body = createProductRequestSchema.parse(request.body);
      // The path SKU wins over body SKU (path is the resource identifier).
      const payload = { ...body, sku };

      const em = deps.emFactory();
      const existing = await em.findOne(Product, { sku });
      if (existing) {
        // Feature 163 (S-W3, Constitution XIII) — the audited Command, naming the key
        // in its entry. No completeness mode is passed: an integration is never gated (A-6).
        const updated = await deps.adminService.updateProductAudited(existing.id, payload, {
          apiKeyId: apiKeyIdOf(request),
        });
        reply.status(200);
        return { data: updated };
      }
      const created = await deps.adminService.createProduct(payload);
      reply.status(201);
      return { data: created };
    },
  );

  // ===== Feature 002 — Attribute Sets read surface ===========================
  // contracts/catalog-002.contract.md: integrations may need to know which
  // attributes apply to which Sets when syncing PIM data. Read-only, scoped
  // to `catalog:read`.
  if (deps.attributeSetService) {
    const attrSetService = deps.attributeSetService;

    app.get(
      '/api/v1/catalog/attribute-sets',
      { preHandler: requireApiKey('catalog:read') },
      async () => {
        const sets = await attrSetService.listSets();
        return { data: sets };
      },
    );

    app.get<{ Params: { id: string } }>(
      '/api/v1/catalog/attribute-sets/:id',
      { preHandler: requireApiKey('catalog:read') },
      async (request) => {
        // Feature 172 (FR-042) — content attributes are not offered for mapping.
        const detail = await attrSetService.getSetDetail(request.params.id, { includeContent: false });
        return { data: detail };
      },
    );
  }
}

/**
 * The API key the request authenticated with, or `null`. `request.actor` is a
 * `declare module 'fastify'` augmentation owned by `auth` / `api_keys`; it is
 * narrowed locally for the same reason `routes.external.ts` does.
 */
function apiKeyIdOf(request: FastifyRequest): string | null {
  const actor = (request as FastifyRequest & { actor?: unknown }).actor as
    | { kind: string; apiKeyId?: string | null }
    | undefined;
  return actor?.kind === 'api_key' ? (actor.apiKeyId ?? null) : null;
}
