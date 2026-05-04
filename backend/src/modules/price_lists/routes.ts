import type { FastifyInstance } from 'fastify';
import {
  createPriceListAssignmentRequestSchema,
  createPriceListEngineRequestSchema,
  createPriceListItemRequestSchema,
  patchPriceListEngineRequestSchema,
  replaceBracketsRequestSchema,
  replaceProductsRequestSchema,
  upsertCustomerGroupRequestSchema,
  upsertPriceListRequestSchema,
} from '@b2b/contracts';
import { z } from 'zod';
import type { CustomerGroupService } from './services/customer-group-service.js';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingService } from './services/pricing-service.js';
import { CustomerGroup } from './entities/customer-group.entity.js';
import type { PriceList } from './entities/price-list.entity.js';
import type { PriceListItem } from './entities/price-list-item.entity.js';
import type { PriceListAssignment } from './entities/price-list-assignment.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../catalog/entities/product.entity.js';
import { Organization } from '../organizations/entities/organization.entity.js';
import { SalesChannel } from '../sales_channels/entities/sales-channel.entity.js';
import { Category } from '../catalog/entities/category.entity.js';

export interface PricingRoutesDeps {
  customerGroupService: CustomerGroupService;
  priceListService: PriceListService;
  pricingService: PricingService;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export async function registerPricingRoutes(
  app: FastifyInstance,
  deps: PricingRoutesDeps,
): Promise<void> {
  const {
    customerGroupService,
    priceListService,
    pricingService,
    emFactory,
    requireAdmin,
  } = deps;

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

  // ---- Price lists ----------------------------------------------------
  app.get(
    '/api/v1/admin/price-lists',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await priceListService.list();
      return { data: rows.map(serializePriceList) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/price-lists/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertPriceListRequestSchema },
    },
    async (request) => {
      const body = upsertPriceListRequestSchema.parse(request.body);
      const row = await priceListService.upsertByCode({
        code: request.params.code,
        name: body.name,
        currency: body.currency,
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      });
      return { data: serializePriceList(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await priceListService.remove(request.params.id);
      reply.status(204).send();
    },
  );

  // ---- Items ----------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists/:id/items',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const rows = await priceListService.listItems(request.params.id);
      return { data: rows.map(serializeItem) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists/:id/items',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createPriceListItemRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListItemRequestSchema.parse(request.body);
      const row = await priceListService.createItem(request.params.id, {
        mode: body.mode,
        ...(body.productId !== undefined ? { productId: body.productId } : {}),
        ...(body.variantId !== undefined ? { variantId: body.variantId } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.minQuantity !== undefined ? { minQuantity: body.minQuantity } : {}),
        ...(body.unitPrice !== undefined ? { unitPrice: body.unitPrice } : {}),
        ...(body.adjustmentValue !== undefined ? { adjustmentValue: body.adjustmentValue } : {}),
      });
      reply.status(201);
      return { data: serializeItem(row) };
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/v1/admin/price-lists/:id/items/:itemId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await priceListService.removeItem(request.params.itemId);
      reply.status(204).send();
    },
  );

  // ---- Assignments ----------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists/:id/assignments',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const rows = await priceListService.listAssignments(request.params.id);
      return { data: rows.map(serializeAssignment) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists/:id/assignments',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createPriceListAssignmentRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListAssignmentRequestSchema.parse(request.body);
      const row = await priceListService.createAssignment(request.params.id, {
        ...(body.organizationId !== undefined ? { organizationId: body.organizationId } : {}),
        ...(body.customerGroupId !== undefined ? { customerGroupId: body.customerGroupId } : {}),
        ...(body.salesChannelId !== undefined ? { salesChannelId: body.salesChannelId } : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      });
      reply.status(201);
      return { data: serializeAssignment(row) };
    },
  );

  app.delete<{ Params: { id: string; assignmentId: string } }>(
    '/api/v1/admin/price-lists/:id/assignments/:assignmentId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await priceListService.removeAssignment(request.params.assignmentId);
      reply.status(204).send();
    },
  );

  // ---- Engine routes (feature 011) -----------------------------------

  app.post(
    '/api/v1/admin/price-lists-engine',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createPriceListEngineRequestSchema },
    },
    async (request, reply) => {
      const body = createPriceListEngineRequestSchema.parse(request.body);
      const row = await priceListService.create({
        name: body.name,
        type: body.type,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        ...(body.applicationRule !== undefined ? { applicationRule: body.applicationRule } : {}),
      });
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
      const row = await priceListService.patch(request.params.id, patch);
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
      const row = await priceListService.activate(request.params.id);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/draftify',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await priceListService.draftify(request.params.id);
      return { data: serializePriceListEngine(row) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/price-lists-engine/:id/duplicate',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const dup = await priceListService.duplicate(request.params.id);
      reply.status(201);
      return { data: serializePriceListEngine(dup) };
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
      const result = await priceListService.replaceProducts(request.params.id, body.productIds);
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

  // ---- Storefront resolver (US5) -------------------------------------

  app.get<{
    Params: { id: string };
    Querystring: { quantity?: string; currency?: string; variantId?: string };
  }>(
    '/api/v1/storefront/products/:id/resolved-price',
    async (request, reply) => {
      const em = emFactory();
      const product = await em.findOne(Product, { id: request.params.id });
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }

      const channelHeader = request.headers['x-sales-channel-id'];
      const channelId =
        typeof channelHeader === 'string'
          ? channelHeader
          : Array.isArray(channelHeader)
            ? channelHeader[0]
            : undefined;

      const channel = channelId
        ? await em.findOne(SalesChannel, { id: channelId })
        : await em.findOne(SalesChannel, { systemDefault: true });
      if (!channel) {
        reply.status(400);
        return { error: { code: 'VALIDATION_FAILED', message: 'Invalid sales channel.' } };
      }

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase();
      const variantId = request.query.variantId ?? null;

      // Customer organization is derived from the request session when wired —
      // for now keep this anonymous to ship the route; quote-request and cart
      // paths inject the organization explicitly via the service layer.
      const out = await pricingService.resolveEngine({
        product,
        variantId,
        context: {
          quantity,
          organization: null,
          salesChannel: channel,
          ...(currency ? { currencyCode: currency } : {}),
        },
      });

      return {
        data: {
          resolvedPrice: {
            baseListId: out.base.listId,
            basePrice: out.base.bracket
              ? { amount: out.base.bracket.amount, currency: out.currencyCode }
              : null,
            saleListId: out.sale?.listId ?? null,
            salePrice: out.sale
              ? { amount: out.sale.bracket.amount, currency: out.currencyCode }
              : null,
            displayMode: out.displayMode,
            currencyCode: out.currencyCode,
            quantityBracket: out.base.bracket
              ? {
                  minQuantity: out.base.bracket.minQuantity,
                  maxQuantity: out.base.bracket.maxQuantity ?? null,
                }
              : null,
          },
        },
      };
    },
  );

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

  // ---- Pricing preview ------------------------------------------------
  app.get<{
    Querystring: {
      productSku: string;
      quantity?: string;
      organizationId?: string;
      salesChannelCode?: string;
    };
  }>(
    '/api/v1/admin/price-lists/preview',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const em = emFactory();
      const product = await em.findOneOrFail(Product, { sku: request.query.productSku });
      const organization = request.query.organizationId
        ? await em.findOne(Organization, { id: request.query.organizationId })
        : null;
      const salesChannel = request.query.salesChannelCode
        ? await em.findOne(SalesChannel, { code: request.query.salesChannelCode })
        : null;
      const quantity = Math.max(1, Number(request.query.quantity ?? '1'));

      const resolved = await pricingService.resolvePrice({
        product,
        context: {
          quantity,
          organization,
          salesChannel,
        },
      });
      return { data: resolved };
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

function serializePriceList(row: PriceList): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    currency: row.currency,
    isDefault: row.isDefault,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
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

function serializeItem(row: PriceListItem): Record<string, unknown> {
  return {
    id: row.id,
    priceListId: row.priceListId,
    mode: row.mode,
    productId: row.productId ?? null,
    variantId: row.variantId ?? null,
    categoryId: row.categoryId ?? null,
    minQuantity: row.minQuantity,
    unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
    adjustmentValue: row.adjustmentValue != null ? Number(row.adjustmentValue) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeAssignment(row: PriceListAssignment): Record<string, unknown> {
  return {
    id: row.id,
    priceListId: row.priceListId,
    organizationId: row.organizationId ?? null,
    customerGroupId: row.customerGroupId ?? null,
    salesChannelId: row.salesChannelId ?? null,
    isDefault: row.isDefault,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
