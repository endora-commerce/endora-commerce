import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  formEntriesDeleteBodySchema,
  formEntryExportQuerySchema,
  formEntryListQuerySchema,
  formEntryNoteBodySchema,
  formEntryStatusBodySchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { EntryService } from '../services/entry-service.js';

export interface EntryRoutesDeps {
  readonly entryService: EntryService;
  readonly requireAdmin: RequireAdminFactory;
}

/**
 * Under `/forms/entries` (lead decision, 2026-11-02), so the palette action `open-form-entries`
 * (`/forms/entries`, `forms:entries_read`) resolves to its own API in
 * `check:action-route-permissions`. Fastify's router prefers the static `entries` segment to the
 * parametric `/forms/:id`, so neither shadows the other.
 */
const API = '/api/v1/admin/forms/entries';

/**
 * The entries of the admin API (`specs/170-forms-module/` contracts/admin-api.md §2, User Story 4):
 * reads and mark-read on `forms:entries_read`, processing and deletes on `forms:entries_write`, the
 * CSV on `forms:entries_export` — each gate the route's `preHandler`, so a refused caller is
 * answered before the body or the query is looked at. Every read is the tenancy guard's.
 */
export async function registerEntryRoutes(app: FastifyInstance, deps: EntryRoutesDeps): Promise<void> {
  const { entryService, requireAdmin } = deps;

  app.get(API, { preHandler: requireAdmin('forms:entries_read'), schema: { querystring: formEntryListQuerySchema } }, async (request) => ({
    data: await entryService.list(formEntryListQuerySchema.parse(request.query)),
  }));

  // Static before `/:entryId`.
  app.get(
    `${API}/export`,
    {
      preHandler: requireAdmin('forms:entries_export'),
      schema: { querystring: formEntryExportQuerySchema },
      config: { streamingResponse: true },
    },
    async (request, reply) => {
      const exported = await entryService.export(formEntryExportQuerySchema.parse(request.query));
      reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('cache-control', 'private, no-store')
        .header('content-disposition', `attachment; filename="${exported.filename}"`);
      return reply.send(Readable.from(exported.chunks));
    },
  );

  app.post(
    `${API}/delete`,
    { preHandler: requireAdmin('forms:entries_write'), schema: { body: formEntriesDeleteBodySchema } },
    async (request) => ({ data: await entryService.deleteMany(formEntriesDeleteBodySchema.parse(request.body).ids) }),
  );

  app.get<{ Params: { entryId: string } }>(`${API}/:entryId`, { preHandler: requireAdmin('forms:entries_read') }, async (request) => ({
    data: await entryService.detail(request.params.entryId),
  }));

  app.post<{ Params: { entryId: string } }>(
    `${API}/:entryId/mark-read`,
    { preHandler: requireAdmin('forms:entries_read') },
    async (request) => ({ data: await entryService.markRead(request.params.entryId) }),
  );

  app.patch<{ Params: { entryId: string } }>(
    `${API}/:entryId/status`,
    { preHandler: requireAdmin('forms:entries_write'), schema: { body: formEntryStatusBodySchema } },
    async (request) => {
      const body = formEntryStatusBodySchema.parse(request.body);
      return { data: await entryService.changeStatus(request.params.entryId, body.status, body.expectedStatus) };
    },
  );

  app.post<{ Params: { entryId: string } }>(
    `${API}/:entryId/notes`,
    { preHandler: requireAdmin('forms:entries_write'), schema: { body: formEntryNoteBodySchema } },
    async (request, reply) => {
      const note = await entryService.addNote(request.params.entryId, formEntryNoteBodySchema.parse(request.body).body);
      reply.code(201);
      return { data: note };
    },
  );

  app.delete<{ Params: { entryId: string } }>(
    `${API}/:entryId`,
    { preHandler: requireAdmin('forms:entries_write') },
    async (request, reply) => {
      await entryService.delete(request.params.entryId);
      return reply.code(204).send();
    },
  );
}
