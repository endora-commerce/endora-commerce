import type { FastifyInstance } from 'fastify';
import {
  createPriceListAssignmentRequestSchema,
  createPriceListItemRequestSchema,
  upsertCustomerGroupRequestSchema,
  upsertPriceListRequestSchema,
} from '@b2b/contracts';
import type { CustomerGroupService } from './services/customer-group-service.js';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingService } from './services/pricing-service.js';
import type { CustomerGroup } from './entities/customer-group.entity.js';
import type { PriceList } from './entities/price-list.entity.js';
import type { PriceListItem } from './entities/price-list-item.entity.js';
import type { PriceListAssignment } from './entities/price-list-assignment.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../catalog/entities/product.entity.js';
import { Organization } from '../organizations/entities/organization.entity.js';
import { SalesChannel } from '../catalog/entities/sales-channel.entity.js';

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
