import type { FastifyInstance } from 'fastify';
import {
  formCreateBodySchema,
  formDeleteQuerySchema,
  formDuplicateBodySchema,
  formListQuerySchema,
  formNotificationsBodySchema,
  formPreviewQuerySchema,
  formRetentionBodySchema,
  formRetentionImpactQuerySchema,
  formRevisionBodySchema,
  formUpdateBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { FormService } from '../services/form-service.js';
import { formNotFound } from '../services/forms-errors.js';

export interface FormRoutesDeps {
  readonly formService: FormService;
  readonly requireAdmin: RequireAdminFactory;
}

const API = '/api/v1/admin/forms';

/** A version number in the path; anything else names no version (404, as a missing one). */
function versionNumber(raw: string): number {
  const number = /^[1-9][0-9]{0,8}$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isNaN(number)) throw formNotFound();
  return number;
}

/**
 * The forms of the admin API (`specs/170-forms-module/` contracts/admin-api.md §1, User Story 1):
 * reads on `forms:read`, writes on `forms:write`, each gate the route's `preHandler` so a refused
 * caller is answered before the body is looked at. Bodies and queries are the contracts' schemas.
 */
export async function registerFormRoutes(app: FastifyInstance, deps: FormRoutesDeps): Promise<void> {
  const { formService, requireAdmin } = deps;

  app.get(API, { preHandler: requireAdmin('forms:read'), schema: { querystring: formListQuerySchema } }, async (request) => ({
    data: await formService.list(formListQuerySchema.parse(request.query)),
  }));

  // Static before `/:id`: the storefront languages a form may be written in.
  app.get(`${API}/languages`, { preHandler: requireAdmin('forms:read') }, async () => ({
    data: await formService.languages(),
  }));

  app.post(API, { preHandler: requireAdmin('forms:write'), schema: { body: formCreateBodySchema } }, async (request, reply) => {
    const detail = await formService.create(formCreateBodySchema.parse(request.body));
    reply.code(201);
    return { data: detail };
  });

  app.get<{ Params: { id: string } }>(`${API}/:id`, { preHandler: requireAdmin('forms:read') }, async (request) => ({
    data: await formService.get(request.params.id),
  }));

  app.put<{ Params: { id: string } }>(
    `${API}/:id`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formUpdateBodySchema } },
    async (request) => ({ data: await formService.update(request.params.id, formUpdateBodySchema.parse(request.body)) }),
  );

  // The shop notification's recipients (User Story 5): live, never part of a version (FR-056).
  app.put<{ Params: { id: string } }>(
    `${API}/:id/notifications`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formNotificationsBodySchema } },
    async (request) => ({
      data: await formService.updateNotifications(request.params.id, formNotificationsBodySchema.parse(request.body)),
    }),
  );

  // Retention (User Story 9): live, and a deletion across every organisation — so processing
  // entries too, and an unrestricted administrator's only (the Command's 403 FORM_SCOPE_REQUIRED).
  app.put<{ Params: { id: string } }>(
    `${API}/:id/retention`,
    {
      preHandler: [requireAdmin('forms:write'), requireAdmin('forms:entries_write')],
      schema: { body: formRetentionBodySchema },
    },
    async (request) => {
      const body = formRetentionBodySchema.parse(request.body);
      return { data: await formService.updateRetention(request.params.id, body.expectedRevision, body.retentionDays) };
    },
  );

  // What a period would delete, before it is saved (the edge case's warning), in the caller's scope.
  app.get<{ Params: { id: string } }>(
    `${API}/:id/retention-impact`,
    { preHandler: requireAdmin('forms:write'), schema: { querystring: formRetentionImpactQuerySchema } },
    async (request) => ({
      data: await formService.retentionImpact(request.params.id, formRetentionImpactQuerySchema.parse(request.query).days),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/publish`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formRevisionBodySchema } },
    async (request) => ({
      data: await formService.publish(request.params.id, formRevisionBodySchema.parse(request.body).expectedRevision),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/close`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formRevisionBodySchema } },
    async (request) => ({
      data: await formService.move(request.params.id, formRevisionBodySchema.parse(request.body).expectedRevision, 'closed'),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/reopen`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formRevisionBodySchema } },
    async (request) => ({
      data: await formService.move(request.params.id, formRevisionBodySchema.parse(request.body).expectedRevision, 'published'),
    }),
  );

  app.post<{ Params: { id: string } }>(
    `${API}/:id/duplicate`,
    { preHandler: requireAdmin('forms:write'), schema: { body: formDuplicateBodySchema } },
    async (request, reply) => {
      const copy = await formService.duplicate(request.params.id, formDuplicateBodySchema.parse(request.body ?? {}).name);
      reply.code(201);
      return { data: copy };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${API}/:id`,
    { preHandler: requireAdmin('forms:write'), schema: { querystring: formDeleteQuerySchema } },
    async (request, reply) => {
      const query = formDeleteQuerySchema.parse(request.query);
      const confirmed = query.confirmEntriesDeletion === 'true';
      // Deleting the entries with the form is processing entries too (contracts/admin-api.md §1).
      if (confirmed) await requireAdmin('forms:entries_write')(request, reply);
      await formService.delete(request.params.id, query.expectedRevision, confirmed);
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>(`${API}/:id/versions`, { preHandler: requireAdmin('forms:read') }, async (request) => ({
    data: await formService.versions(request.params.id),
  }));

  app.get<{ Params: { id: string; number: string } }>(
    `${API}/:id/versions/:number`,
    { preHandler: requireAdmin('forms:read') },
    async (request) => ({
      data: await formService.version(request.params.id, versionNumber(request.params.number)),
    }),
  );

  app.get<{ Params: { id: string } }>(
    `${API}/:id/preview`,
    { preHandler: requireAdmin('forms:read'), schema: { querystring: formPreviewQuerySchema } },
    async (request) => ({
      data: await formService.preview(request.params.id, formPreviewQuerySchema.parse(request.query)),
    }),
  );
}
