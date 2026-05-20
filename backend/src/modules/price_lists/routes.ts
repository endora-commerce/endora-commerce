import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  createPriceListEngineRequestSchema,
  patchPriceListEngineRequestSchema,
  replaceBracketsRequestSchema,
  replaceProductsRequestSchema,
  upsertCustomerGroupRequestSchema,
} from '@b2b/contracts';
import { z } from 'zod';
import type { CustomerGroupService } from './services/customer-group-service.js';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingService } from './services/pricing-service.js';
import { CustomerGroup } from './entities/customer-group.entity.js';
import type { PriceList } from './entities/price-list.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { SalesChannel } from '../sales_channels/entities/sales-channel.entity.js';
import { Category } from '../catalog/entities/category.entity.js';
import { Organization } from '../organizations/entities/organization.entity.js';
import { Product } from '../catalog/entities/product.entity.js';

export interface PricingRoutesDeps {
  customerGroupService: CustomerGroupService;
  priceListService: PriceListService;
  pricingService: PricingService;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  /** Feature 024 — resolves admin actor identity for audit entries. */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
}

function buildAuditCtx(
  request: FastifyRequest,
  resolver:
    | ((req: FastifyRequest) => { actorAdminUserId: string; impersonatedCustomerAccountId?: string | null })
    | undefined,
) {
  const base = resolver?.(request);
  if (!base) return undefined;
  return {
    actorAdminUserId: base.actorAdminUserId,
    impersonatedCustomerAccountId: base.impersonatedCustomerAccountId ?? null,
    ipAddress: request.ip ?? null,
    userAgent:
      typeof request.headers['user-agent'] === 'string'
        ? request.headers['user-agent']
        : null,
    requestId: request.id,
  };
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRoutesDeps,
): Promise<void> {
  const {
    customerGroupService,
    priceListService,
    emFactory,
    requireAdmin,
  } = deps;
  // pricingService is still part of PricingRoutesDeps for symmetry — the
  // resolver routes are mounted by routes.storefront.ts; the admin
  // routes here read through PriceListService.

  // ---- Customer groups ------------------------------------------------
  app.get(
    '/api/v1/admin/customer-groups',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await customerGroupService.list();
      return { data: rows.map(serializeCustomerGroup) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/customer-groups/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertCustomerGroupRequestSchema },
    },
    async (request) => {
      const body = upsertCustomerGroupRequestSchema.parse(request.body);
      const row = await customerGroupService.upsertByCode({
        code: request.params.code,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
      });
      return { data: serializeCustomerGroup(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/customer-groups/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await customerGroupService.remove(request.params.id);
      reply.status(204).send();
    },
  );

  // ---- Engine routes (feature 011) -----------------------------------

  app.get<{
    Querystring: {
      status?: string | string[];
      type?: string | string[];
      search?: string;
    };
  }>(
    '/api/v1/admin/price-lists-engine',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const status = toArray(request.query.status).filter((s): s is 'draft' | 'active' | 'scheduled' | 'expired' =>
        s === 'draft' || s === 'active' || s === 'scheduled' || s === 'expired',
      );
      const type = toArray(request.query.type).filter((t): t is 'base' | 'sale' => t === 'base' || t === 'sale');
      const filter: Parameters<PriceListService['listEngine']>[0] = {};
      if (status.length > 0) filter.status = status;
      if (type.length > 0) filter.type = type;
      if (typeof request.query.search === 'string' && request.query.search.trim().length > 0) {
        filter.search = request.query.search.trim();
      }
      const rows = await priceListService.listEngine(filter);
      return { data: { items: rows.map(serializePriceListEngine) } };
    },
  );

  app.post(
    '/api/v1/admin/price-lists-engine',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createPriceListEngineRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListEngineRequestSchema.parse(request.body);
      const row = await priceListService.create(
        {
          name: body.name,
          type: body.type,
          startsAt: body.startsAt ? new Date(body.startsAt) : null,
          endsAt: body.endsAt ? new Date(body.endsAt) : null,
          ...(body.applicationRule !== undefined ? { applicationRule: body.applicationRule } : {}),
        },
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: patchPriceListEngineRequestSchema },
    },
    async (request) => {
      const body = patchPriceListEngineRequestSchema.parse(request.body);
      const patch: Parameters<PriceListService['patch']>[1] = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.type !== undefined) patch.type = body.type;
      if (body.startsAt !== undefined) patch.startsAt = body.startsAt ? new Date(body.startsAt) : null;
      if (body.endsAt !== undefined) patch.endsAt = body.endsAt ? new Date(body.endsAt) : null;
      if (body.applicationRule !== undefined) patch.applicationRule = body.applicationRule;
      const row = await priceListService.patch(
        request.params.id,
        patch,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await priceListService.getById(request.params.id);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/activate',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await priceListService.activate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/draftify',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await priceListService.draftify(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/duplicate',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const dup = await priceListService.duplicate(
        request.params.id,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      reply.status(201);
      return { data: serializePriceListEngine(dup) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await priceListService.remove(request.params.id);
      reply.status(204).send();
    },
  );

  // ---- Engine: product roster + bracket pricing (US3) ----------------

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const items = await priceListService.listProducts(request.params.id);
      return { data: { items } };
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: replaceProductsRequestSchema },
    },
    async (request) => {
      const body = replaceProductsRequestSchema.parse(request.body);
      const result = await priceListService.replaceProducts(
        request.params.id,
        body.productIds,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: z.object({ productId: z.string().uuid() }) },
    },
    async (request, reply) => {
      const body = z.object({ productId: z.string().uuid() }).parse(request.body);
      await priceListService.addProduct(request.params.id, body.productId);
      reply.status(201);
      return { data: { priceListId: request.params.id, productId: body.productId } };
    },
  );

  app.delete<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await priceListService.removeProduct(request.params.id, request.params.productId);
      reply.status(204).send();
    },
  );

  app.get<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const list = await priceListService.listProducts(request.params.id);
      const entry = list.find((e) => e.productId === request.params.productId);
      if (!entry) {
        return { data: { bracketsByCurrency: {} } };
      }
      return { data: { bracketsByCurrency: entry.bracketsByCurrency } };
    },
  );

  app.put<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: replaceBracketsRequestSchema },
    },
    async (request) => {
      const body = replaceBracketsRequestSchema.parse(request.body);
      const out = await priceListService.replaceBrackets(
        request.params.id,
        request.params.productId,
        body.bracketsByCurrency,
        buildAuditCtx(request, deps.resolveAdminAuditContext),
      );
      return { data: { bracketsByCurrency: out } };
    },
  );

  app.post<{ Params: { id: string; productId: string } }>(
    '/api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: {
        body: z.object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        }),
      },
    },
    async (request) => {
      const body = z
        .object({
          fromCurrency: z.string().regex(/^[A-Z]{3}$/),
          toCurrencies: z.array(z.string().regex(/^[A-Z]{3}$/)).min(1),
        })
        .parse(request.body);
      const result = await priceListService.copyCurrencyBrackets(
        request.params.id,
        request.params.productId,
        body.fromCurrency,
        body.toCurrencies,
      );
      return { data: result };
    },
  );

  // ---- Rule-builder pickers (US4) -----------------------------------

  app.get(
    '/api/v1/admin/pricing/rule-targets/sales-channels',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const em = emFactory();
      const rows = await em.find(SalesChannel, {}, { orderBy: { code: 'asc' } });
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
          })),
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/customer-groups',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const em = emFactory();
      const rows = await em.find(CustomerGroup, {}, { orderBy: { code: 'asc' } });
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, code: r.code, name: r.name })),
        },
      };
    },
  );

  app.get<{ Querystring: { search?: string; limit?: string } }>(
    '/api/v1/admin/pricing/rule-targets/organizations',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const em = emFactory();
      const limit = Math.min(200, Math.max(1, Number(request.query.limit ?? '50')));
      const search = (request.query.search ?? '').trim();
      const where: Record<string, unknown> = {};
      if (search) where['name'] = { $ilike: `%${search}%` };
      const rows = await em.find(Organization, where, {
        orderBy: { name: 'asc' },
        limit,
      });
      return {
        data: {
          items: rows.map((r) => ({ id: r.id, name: r.name, taxId: r.taxId })),
          nextCursor: null,
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/categories',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const em = emFactory();
      const rows = await em.find(Category, {}, { orderBy: { sortOrder: 'asc', slug: 'asc' } });
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            parentCategoryId: r.parentCategoryId ?? null,
            sortOrder: r.sortOrder,
          })),
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/pricing/rule-targets/currencies',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const em = emFactory();
      const channels = await em.find(SalesChannel, {});
      const exposed = new Map<string, string[]>();
      for (const ch of channels) {
        for (const cur of ch.currencies ?? []) {
          if (typeof cur !== 'string' || cur.length !== 3) continue;
          const key = cur.toUpperCase();
          const list = exposed.get(key) ?? [];
          list.push(ch.code);
          exposed.set(key, list);
        }
      }
      const items = [...exposed.entries()]
        .map(([code, exposedByChannels]) => ({ code, exposedByChannels }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return { data: { items } };
    },
  );

  // ---- Linked price-lists panel for the product editor (US8) -------

  app.get<{ Params: { productId: string } }>(
    '/api/v1/admin/products/:productId/price-lists',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const em = emFactory();
      const product = await em.findOne(Product, { id: request.params.productId });
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      const items = await priceListService.summarizeBracketsForProduct(
        request.params.productId,
      );
      return {
        data: {
          items: items.map((it) => ({
            list: {
              id: it.list.id,
              name: it.list.name,
              type: it.list.type,
              status: it.list.status,
              modifiedAt: it.list.modifiedAt.toISOString(),
            },
            summary: it.summary,
            deepLinkPath: it.deepLinkPath,
          })),
        },
      };
    },
  );

  // ---- Display-mode overrides (US7) ----------------------------------

  app.get<{ Querystring: { scope?: 'organization' | 'category' | 'product' } }>(
    '/api/v1/admin/pricing/display-mode-overrides',
    { preHandler: requireAdmin('catalog:write') },
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
    { preHandler: requireAdmin('catalog:write') },
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
      preHandler: requireAdmin('catalog:write'),
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
        reply.status(204).send();
        return;
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

  // Storefront-public routes live in `routes.storefront.ts` and are mounted
  // separately from `plugin.ts` so the admin and storefront surfaces stay
  // independently auditable. See T025/T026.

  // Test-only sweeper hook — the production code path runs the worker on the
  // BullMQ queue every 5 min. This endpoint lets integration tests advance
  // the state machine without waiting for the queue tick.
  app.post(
    '/api/v1/admin/price-lists-engine/internal/sweep',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      // The worker reads/writes through the same EM as the rest of the
      // module; constructed here so the route doesn't pin the worker to
      // the module-level construction.
      const { PriceListStatusWorker } = await import('./services/price-list-status-worker.js');
      const worker = new PriceListStatusWorker(emFactory);
      const result = await worker.sweep();
      return { data: result };
    },
  );

}

function serializeCustomerGroup(row: CustomerGroup): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toArray(v: string | string[] | undefined): string[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function serializePriceListEngine(row: PriceList): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    startsAt: row.startsAt ? row.startsAt.toISOString() : null,
    endsAt: row.endsAt ? row.endsAt.toISOString() : null,
    applicationRule: row.applicationRule,
    isSystem: row.isSystem,
    modifiedAt: row.modifiedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

