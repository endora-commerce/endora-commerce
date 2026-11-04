import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  addShoppingListItemRequestSchema,
  convertShoppingListRequestSchema,
  createShoppingListRequestSchema,
  renameShoppingListRequestSchema,
  updateShoppingListItemRequestSchema,
  firstLanguageTag,
  organizationPermissionPreHandler,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import type { ShoppingListService } from './services/shopping-list-service.js';
import type { ShoppingList } from './entities/shopping-list.entity.js';
import { ShoppingListItem } from './entities/shopping-list-item.entity.js';

/**
 * Shopping list routes (T204). All endpoints require an authenticated
 * customer session; ownership is enforced by the service via
 * (organization_id, customer_account_id).
 *
 * **By organization permission (`specs/170-organization-roles/`, FR-047,
 * FR-048; `contracts/storefront-api.md` §5).** Every write — a list, its lines,
 * the default — needs `shopping_lists.create`; converting needs
 * `shopping_lists.convert` and then the target's create permission, as two
 * guards in that order, so the refusal names the first one missing. Reads stay
 * open, the lazily provisioned default list included: it is the platform's
 * anchor, not the member's write. Each guard follows `requireCustomer`, so a
 * refused member is answered before the body or the list is looked at.
 */

export interface ShoppingListsRoutesDeps {
  service: ShoppingListService;
  emFactory: () => EntityManager;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** `organizations`' port, resolved per request (`module-composition.md` item 4a). */
  organizationPermissions: () => OrganizationPermissionPort;
}

export async function registerShoppingListRoutes(
  app: FastifyInstance,
  deps: ShoppingListsRoutesDeps,
): Promise<void> {
  const { service, emFactory, requireCustomer, resolveCustomerContext, organizationPermissions } = deps;
  // Shared guard lists: the platform's `onRoute` hook moves them to
  // `preValidation` by assigning new arrays, never by mutating these.
  const canEdit = [requireCustomer, organizationPermissionPreHandler(organizationPermissions, 'shopping_lists.create')];
  const canConvertToCart = [
    requireCustomer,
    organizationPermissionPreHandler(organizationPermissions, 'shopping_lists.convert'),
    organizationPermissionPreHandler(organizationPermissions, 'carts.create'),
  ];
  const canConvertToQuoteRequest = [
    requireCustomer,
    organizationPermissionPreHandler(organizationPermissions, 'shopping_lists.convert'),
    organizationPermissionPreHandler(organizationPermissions, 'quote_requests.create'),
  ];

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
    { preHandler: canEdit, schema: { body: createShoppingListRequestSchema } },
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
    { preHandler: canEdit, schema: { body: addShoppingListItemRequestSchema } },
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
    { preHandler: canEdit },
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
    { preHandler: canEdit, schema: { body: renameShoppingListRequestSchema } },
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
    { preHandler: canEdit },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await service.remove(ctx, request.params.id);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/items',
    { preHandler: canEdit, schema: { body: addShoppingListItemRequestSchema } },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      const body = addShoppingListItemRequestSchema.parse(request.body);
      await service.addItem(ctx, request.params.id, {
        productId: body.productId,
        ...(body.variantId ? { variantId: body.variantId } : {}),
        quantity: body.quantity,
        ...(body.note ? { note: body.note } : {}),
        ...languageTagOf(request),
      });
      const { list, items } = await service.getByIdWithItems(ctx, request.params.id);
      reply.status(201);
      return { data: serializeWithItems(list, items) };
    },
  );

  app.patch<{ Params: { id: string; itemId: string } }>(
    '/api/v1/shopping-lists/:id/items/:itemId',
    { preHandler: canEdit, schema: { body: updateShoppingListItemRequestSchema } },
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

  app.delete<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/items',
    { preHandler: canEdit },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await service.clearItems(ctx, request.params.id);
      return reply.status(204).send();
    },
  );

  app.delete<{ Params: { id: string; itemId: string } }>(
    '/api/v1/shopping-lists/:id/items/:itemId',
    { preHandler: canEdit },
    async (request, reply) => {
      const ctx = resolveCustomerContext(request);
      await service.removeItem(ctx, request.params.id, request.params.itemId);
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/convert-to-cart',
    { preHandler: canConvertToCart, schema: { body: convertShoppingListRequestSchema.optional() } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = convertShoppingListRequestSchema.parse(request.body ?? {});
      // Into the basket of the storefront the buyer is on (`specs/154-sales-channel-access/`).
      const result = await service.convertToCart(
        ctx,
        request.params.id,
        body.itemIds,
        getResolvedChannel(request).id,
      );
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/shopping-lists/:id/convert-to-rfq',
    { preHandler: canConvertToQuoteRequest, schema: { body: convertShoppingListRequestSchema.optional() } },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const body = convertShoppingListRequestSchema.parse(request.body ?? {});
      // Feature 163 — the lines are judged at the request's channel and scope language.
      const result = await service.convertToRfq(ctx, request.params.id, body.itemIds, {
        language: await request.responseLanguage(),
        ...languageTagOf(request),
        salesChannelId: getResolvedChannel(request).id,
      });
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

/** Feature 163 — the request's first `Accept-Language` tag, as `{ languageTag }` when present. */
function languageTagOf(request: FastifyRequest): { languageTag?: string } {
  const tag = firstLanguageTag(request.headers['accept-language']);
  return tag ? { languageTag: tag } : {};
}
