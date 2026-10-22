import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { PriceListService } from './services/price-list-service.js';
import { PRICE_LIST_PERMISSIONS } from '../manifest.js';

/**
 * `price_lists`' remaining admin routes outside the price-book API: the
 * display-mode overrides (feature 011 US7), unchanged by feature 160.
 *
 * Feature 160 (FR-037) removed, in the release that adds
 * `/api/v1/admin/price-books/…` (`routes.price-books.ts`): every route under
 * `/api/v1/admin/price-lists-engine/`, the rule-target pickers under
 * `/api/v1/admin/pricing/rule-targets/`, the product's linked-lists panel and
 * `/api/v1/admin/products/:id/resolved-price`. The status-sweep hook moved to
 * `/api/v1/admin/price-books/internal/sweep`.
 */
export interface PricingRoutesDeps {
  priceListService: PriceListService;
  requireAdmin: RequireAdminFactory;
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRoutesDeps,
): Promise<void> {
  const { priceListService, requireAdmin } = deps;
  /**
   * Issue #219 — this module's own gates. Every route below used to name
   * `catalog:write`, which bought the ability to change what customers pay with
   * a permission granted for content work. The split is by what the route does:
   * a listing or a picker is `price_lists:read`, anything that persists is
   * `price_lists:write`.
   *
   * No compatibility shim: `catalog:write` is refused here now, so a role that
   * needs pricing is granted a pricing code deliberately. See the first-
   * deployment checklist item D3.
   */
  const readGate = requireAdmin(PRICE_LIST_PERMISSIONS.READ);
  const writeGate = requireAdmin(PRICE_LIST_PERMISSIONS.WRITE);


  // ---- Display-mode overrides (US7) ----------------------------------

  app.get<{ Querystring: { scope?: 'organization' | 'category' | 'product' } }>(
    '/api/v1/admin/pricing/display-mode-overrides',
    { preHandler: readGate },
    async (request) => {
      const items = await priceListService.listDisplayModeOverrides(request.query.scope);
      return {
        data: {
          items: items.map((o) => ({
            scope: o.scope,
            targetId: o.targetId,
            mode: o.mode,
            updatedAt: o.updatedAt.toISOString(),
          })),
        },
      };
    },
  );

  app.get<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    { preHandler: readGate },
    async (request, reply) => {
      const row = await priceListService.getDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
      );
      if (!row) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Override not found.' } };
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );

  app.put<{
    Params: { scope: 'organization' | 'category' | 'product'; targetId: string };
  }>(
    '/api/v1/admin/pricing/display-mode-overrides/:scope/:targetId',
    {
      preHandler: writeGate,
      schema: {
        body: z.object({
          mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']),
        }),
      },
    },
    async (request, reply) => {
      const body = z
        .object({ mode: z.enum(['gross_only', 'net_only', 'both', 'none', 'inherit']) })
        .parse(request.body);
      const row = await priceListService.upsertDisplayModeOverride(
        request.params.scope,
        request.params.targetId,
        body.mode,
      );
      if (!row) {
        return reply.status(204).send();
      }
      return {
        data: {
          scope: row.scope,
          targetId: row.targetId,
          mode: row.mode,
          updatedAt: row.updatedAt.toISOString(),
        },
      };
    },
  );
}
