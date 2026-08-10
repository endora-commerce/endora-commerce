import type { FastifyInstance } from 'fastify';
import {
  activateBindingRequestSchema,
  addBindingRequestSchema,
  createMegamenuRequestSchema,
  patchMegamenuRequestSchema,
  putItemsRequestSchema,
} from '@b2b/contracts';
import type { MegamenuService } from './services/megamenu-service.js';
import type { MegamenuItemService } from './services/megamenu-item-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

export async function registerMegamenuAdminRoutes(
  app: FastifyInstance,
  deps: {
    menuService: MegamenuService;
    itemService: MegamenuItemService;
    requireAdmin?: RequireAdminFactory;
  },
): Promise<void> {
  const requireRead = deps.requireAdmin?.('megamenu.read') ?? (async () => {});
  const requireWrite = deps.requireAdmin?.('megamenu.write') ?? (async () => {});

  app.get('/api/v1/admin/megamenu/menus', { preHandler: requireRead }, async () =>
    deps.menuService.list(),
  );

  app.post(
    '/api/v1/admin/megamenu/menus',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = createMegamenuRequestSchema.parse(request.body);
      const created = await deps.menuService.create(body);
      return reply.code(201).send({ data: created });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.menuService.get(request.params.id) }),
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id',
    { preHandler: requireWrite },
    async (request) => {
      const body = patchMegamenuRequestSchema.parse(request.body);
      return { data: await deps.menuService.patch(request.params.id, body) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.menuService.delete(request.params.id);
      return reply.code(204).send();
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id/items',
    { preHandler: requireWrite },
    async (request) => {
      const body = putItemsRequestSchema.parse(request.body);
      const result = await deps.itemService.setTree(request.params.id, body);
      return {
        data: result.detail,
        ...(result.warnings.length > 0 ? { meta: { warnings: result.warnings } } : {}),
      };
    },
  );

  // ── Bindings ──────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id/bindings',
    { preHandler: requireRead },
    async (request) => ({ data: await deps.menuService.listBindings(request.params.id) }),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id/bindings',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = addBindingRequestSchema.parse(request.body);
      const created = await deps.menuService.addBinding(
        request.params.id,
        body.salesChannelId,
        body.language,
      );
      return reply.code(201).send({ data: created });
    },
  );

  app.delete<{ Params: { id: string; salesChannelId: string; language: string } }>(
    '/api/v1/admin/megamenu/menus/:id/bindings/:salesChannelId/:language',
    { preHandler: requireWrite },
    async (request, reply) => {
      await deps.menuService.removeBinding(
        request.params.id,
        request.params.salesChannelId,
        request.params.language,
      );
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id/activate',
    { preHandler: requireWrite },
    async (request) => {
      const body = activateBindingRequestSchema.parse(request.body);
      const result = await deps.menuService.activate(
        request.params.id,
        body.salesChannelId,
        body.language,
      );
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/megamenu/menus/:id/deactivate',
    { preHandler: requireWrite },
    async (request, reply) => {
      const body = activateBindingRequestSchema.parse(request.body);
      await deps.menuService.deactivate(
        request.params.id,
        body.salesChannelId,
        body.language,
      );
      return reply.code(200).send({ data: { deactivated: body } });
    },
  );
}
