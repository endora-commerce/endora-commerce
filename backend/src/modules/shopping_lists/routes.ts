import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addShoppingListItemRequestSchema,
  convertShoppingListRequestSchema,
  createShoppingListRequestSchema,
  renameShoppingListRequestSchema,
  updateShoppingListItemRequestSchema,
} from '@b2b/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShoppingListService } from './services/shopping-list-service.js';
import type { ShoppingList } from './entities/shopping-list.entity.js';
import { ShoppingListItem } from './entities/shopping-list-item.entity.js';

/**
 * Shopping list routes (T204). All endpoints require an authenticated
 * customer session; ownership is enforced by the service via
 * (organization_id, customer_account_id).
 */

export interface ShoppingListsRoutesDeps {
  service: ShoppingListService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export async function registerShoppingListRoutes(
  app: FastifyInstance,
  deps: ShoppingListsRoutesDeps,
): Promise<void> {
  const { service, emFactory, requireCustomer, resolveCustomerContext } = deps;

  app.get('/api/v1/shopping-lists', { preHandler: requireCustomer }, async (request) => {
    const ctx = resolveCustomerContext(request);
    const lists = await service.list(ctx);
    const em = emFactory();
    const data = await Promise.all(
      lists.map(async (l) => {
        const items = await em.find(ShoppingListItem, { shoppingListId: l.id });
        return serializeWithItems(l, items);
      }),
    );
    return { data };
  });

  app.post(
    '/api/v1/shopping-lists',
    { preHandler: requireCustomer, schema: { body: createShoppingListRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = createShoppingListRequestSchema.parse(request.body);
      const list = await service.create(ctx, body);
      reply.status(201);
      return { data: serializeWithItems(list, []) };
    },
  );

  // Default-list endpoints. Fastify's radix router prioritises the static
  // `default` segment over the parametric `:id`, so ordering vs `/:id` is
  // irrelevant.
  app.get('/api/v1/shopping-lists/default', { preHandler: requireCustomer }, async (request) => {
    const ctx = resolveCustomerContext(request);
    const list = await service.ensureDefault(ctx);
    const em = emFactory();
    const itemCount = await em.count(ShoppingListItem, { shoppingListId: list.id });
    return { data: { id: list.id, name: list.name, itemCount } };
  });

  app.post(
    '/api/v1/shopping-lists/default/items',
    { preHandler: requireCustomer, schema: { body: addShoppingListItemRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = addShoppingListItemRequestSchema.parse(request.body);
      const { list, itemCount } = await service.addItemToDefault(ctx, {
        productId: body.productId,
        ...(body.variantId ? { variantId: body.variantId } : {}),
        quantity: body.quantity,
        ...(body.note ? { note: body.note } : {}),
      });
      reply.status(201);
      return { data: { id: list.id, name: list.name, itemCount } };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const { list, items } = await service.getByIdWithItems(ctx, request.params.id);
      return { data: serializeWithItems(list, items) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/set-default',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const list = await service.setDefault(ctx, request.params.id);
      const em = emFactory();
      const items = await em.find(ShoppingListItem, { shoppingListId: list.id });
      return { data: serializeWithItems(list, items) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id',
    { preHandler: requireCustomer, schema: { body: renameShoppingListRequestSchema } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = renameShoppingListRequestSchema.parse(request.body);
      const list = await service.rename(ctx, request.params.id, body.name);
      const em = emFactory();
      const items = await em.find(ShoppingListItem, { shoppingListId: list.id });
      return { data: serializeWithItems(list, items) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await service.remove(ctx, request.params.id);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/items',
    { preHandler: requireCustomer, schema: { body: addShoppingListItemRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = addShoppingListItemRequestSchema.parse(request.body);
      await service.addItem(ctx, request.params.id, {
        productId: body.productId,
        ...(body.variantId ? { variantId: body.variantId } : {}),
        quantity: body.quantity,
        ...(body.note ? { note: body.note } : {}),
      });
      const { list, items } = await service.getByIdWithItems(ctx, request.params.id);
      reply.status(201);
      return { data: serializeWithItems(list, items) };
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/v1/shopping-lists/:id/items/:itemId',
    { preHandler: requireCustomer, schema: { body: updateShoppingListItemRequestSchema } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = updateShoppingListItemRequestSchema.parse(request.body);
      await service.updateItem(ctx, request.params.id, request.params.itemId, {
        ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
      const { list, items } = await service.getByIdWithItems(ctx, request.params.id);
      return { data: serializeWithItems(list, items) };
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/v1/shopping-lists/:id/items/:itemId',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await service.removeItem(ctx, request.params.id, request.params.itemId);
      reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/convert-to-cart',
    { preHandler: requireCustomer, schema: { body: convertShoppingListRequestSchema.optional() } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = convertShoppingListRequestSchema.parse(request.body ?? {});
      const result = await service.convertToCart(ctx, request.params.id, body.itemIds);
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/convert-to-rfq',
    { preHandler: requireCustomer, schema: { body: convertShoppingListRequestSchema.optional() } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = convertShoppingListRequestSchema.parse(request.body ?? {});
      const result = await service.convertToRfq(ctx, request.params.id, body.itemIds);
      return { data: result };
    },
  );
}

function serializeWithItems(list: ShoppingList, items: ShoppingListItem[]): Record<string, unknown> {
  return {
    id: list.id,
    organizationId: list.organizationId,
    customerAccountId: list.customerAccountId,
    name: list.name,
    isDefault: list.isDefault,
    items: items.map((it) => ({
      id: it.id,
      shoppingListId: it.shoppingListId,
      productId: it.productId,
      variantId: it.variantId ?? null,
      quantity: it.quantity,
      note: it.note ?? null,
      createdAt: it.createdAt.toISOString(),
      updatedAt: it.updatedAt.toISOString(),
    })),
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
  };
}
