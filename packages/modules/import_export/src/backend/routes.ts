import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  createImportProfileRequestSchema,
  importChannelTargetListResponseSchema,
  importProfileListQuerySchema,
  productsImportQuerySchema,
  updateImportProfileRequestSchema,
  uuidSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { ImportExportService } from './services/import-export-service.js';
import type { ImportProfileService } from './services/import-profile.service.js';
import type { RequireAdminAnyFactory, RequireAdminFactory } from '@endora-commerce/platform/kernel';

export interface ImportExportRoutesDeps {
  service: ImportExportService;
  profiles: ImportProfileService;
  requireAdmin: RequireAdminFactory;
  requireAdminAny: RequireAdminAnyFactory;
}

const FILENAME_RE = /^[a-z][a-z0-9_]*$/;
const profileParams = z.object({ id: uuidSchema });
/** The largest CSV an import accepts (`import-profiles-and-csv.md` §2: 10 MiB). */
const IMPORT_BODY_LIMIT = 10 * 1024 * 1024;
/** A profile body: at most 100 entries x 16 targets of short strings fit well under this. */
const PROFILE_BODY_LIMIT = 256 * 1024;

type EntityRequest = FastifyRequest<{ Params: { entity: string } }>;

export async function registerImportExportRoutes(
  app: FastifyInstance,
  deps: ImportExportRoutesDeps,
): Promise<void> {
  const { service, profiles, requireAdmin, requireAdminAny } = deps;

  /**
   * Holding one of the codes an entity of the centre is gated by — the owning
   * modules' own read and write codes for the same rows — is what it takes to
   * reach the centre at all. Which entities a caller may then use is decided
   * per entity, by the code that adapter declares.
   *
   * Written as literals rather than derived from the adapters so the permission
   * inventory reads them; `routes.test.ts` holds this list equal to the union
   * of the adapters' codes.
   */
  const anyImportExportCode = requireAdminAny([
    'catalog:read',
    'catalog:write',
    'customers:read',
    'inventory:read',
    'inventory:write',
    'orders:read',
  ]);

  /**
   * Whether the caller holds `code`, answered by the very guard the export and
   * import routes are gated with — so the list a caller is offered and the
   * routes they may call cannot disagree. Only the guard's "missing
   * permission" refusal means no; anything else (no session, an account with
   * no role, a permission store that is off) propagates as the routes would
   * answer it.
   */
  const holds = async (request: FastifyRequest, reply: FastifyReply, code: string) => {
    try {
      await requireAdmin(code)(request, reply);
      return true;
    } catch (err) {
      if (err instanceof HttpError && err.statusCode === 403 && err.code === ERROR_CODES.FORBIDDEN) {
        return false;
      }
      throw err;
    }
  };

  /**
   * The per-entity gate, installed after {@link anyImportExportCode} on the
   * export and import routes. Both run as the route's `preHandler` chain, which
   * the platform moves ahead of validation, so the caller's authority is
   * decided before anything about the request is answered. An entity this
   * deployment does not offer has no code of its own: the any-of gate before it
   * has already settled that the caller may use the centre, and the handler
   * answers the 400 or 404 it always has.
   */
  const entityGate =
    (permissionFor: (entity: string) => string | undefined, entity?: string) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const permission = permissionFor(entity ?? (request as EntityRequest).params.entity);
      if (permission !== undefined) await requireAdmin(permission)(request, reply);
    };

  /**
   * The entities this deployment can offer, D-74.
   *
   * The admin renders from this instead of the literal five-slug array it used
   * to carry, so switching `orders` off removes the Orders export from the
   * screen rather than leaving a button that 404s. `SUPPORTED_EXPORT_ENTITIES`
   * and `SUPPORTED_IMPORT_ENTITIES` were the static half of this answer and had
   * no reader at all; they are gone rather than left as a second source of
   * truth beside this one.
   */
  app.get(
    '/api/v1/admin/import-export/entities',
    { preHandler: anyImportExportCode },
    async (request, reply) => ({
      data: { entities: await service.listEntities((code) => holds(request, reply, code)) },
    }),
  );

  app.get<{ Params: { entity: string } }>(
    '/api/v1/admin/export/:entity.csv',
    {
      preHandler: [
        anyImportExportCode,
        entityGate((entity) => service.exportPermissionFor(entity)),
      ],
      config: { streamingResponse: true },
    },
    async (request, reply) => {
      const { entity } = request.params;
      if (!FILENAME_RE.test(entity)) {
        reply.status(400);
        return { error: { code: 'VALIDATION_FAILED', message: 'invalid entity slug' } };
      }
      const body = await service.exportToCsv(entity);
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${entity}-${new Date().toISOString().slice(0, 10)}.csv"`,
        );
      return body;
    },
  );

  const importCsv = async (entity: string, request: FastifyRequest, reply: FastifyReply) => {
    if (!FILENAME_RE.test(entity)) {
      reply.status(400);
      return { error: { code: 'VALIDATION_FAILED', message: 'invalid entity slug' } };
    }
    const body =
      typeof request.body === 'string'
        ? request.body
        : (request.body as unknown as Buffer | undefined)?.toString('utf8') ?? '';
    // Feature 172 (FR-048) — `profileId` / `dryRun` for products; other entities take none.
    const query =
      entity === 'products'
        ? productsImportQuerySchema.parse(request.query ?? {})
        : ({} as { profileId?: string; dryRun?: 'true' | 'false' });
    const report = await service.importFromCsv(entity, body, {
      profileId: query.profileId,
      dryRun: query.dryRun === 'true',
      loadProfile: (id) => profiles.snapshot(id),
    });
    return { data: report };
  };

  // Receive the raw CSV body — operators can `curl --data-binary @file.csv`
  // and the admin SPA can read the file as text and POST it directly.
  //
  // Feature 172 — the products file's cap is explicit, 10 MiB
  // (`import-profiles-and-csv.md` §2), with rows, columns and cell lengths bounded by the
  // products adapter. It is that route's alone: a static route, which Fastify prefers to the
  // parametric one, so every other entity keeps the server's default limit (C2/C3 code review).
  app.post<{ Body: string }>(
    '/api/v1/admin/import/products',
    {
      preHandler: [anyImportExportCode, entityGate((entity) => service.importPermissionFor(entity), 'products')],
      bodyLimit: IMPORT_BODY_LIMIT,
    },
    async (request, reply) => importCsv('products', request, reply),
  );

  app.post<{ Params: { entity: string }; Body: string }>(
    '/api/v1/admin/import/:entity',
    {
      preHandler: [
        anyImportExportCode,
        entityGate((entity) => service.importPermissionFor(entity)),
      ],
    },
    async (request, reply) => importCsv(request.params.entity, request, reply),
  );

  /**
   * Feature 172 (`contracts/import-profiles-and-csv.md` §1; FR-048) — import profiles. Every
   * route, reads included, is `catalog:write`: a profile decides where an import writes, so it is
   * part of the write (no new permission code). The any-of gate first, like every route of the
   * centre, then the literal code so the permission inventory reads it.
   */
  const profilesBase = '/api/v1/admin/import-export/profiles';

  /**
   * Owner decision 2026-11-03 — the targets the profile editor offers, served here so that the
   * code that lets an operator edit a profile is also enough to pick its targets (no
   * `sales_channels:read`). Id, code and languages only; the delivery-methods precedent
   * (`GET /api/v1/admin/delivery-methods/sales-channels`).
   */
  app.get('/api/v1/admin/import-export/channel-targets', { preHandler: [anyImportExportCode, requireAdmin('catalog:write')] }, async () => {
    const data = await profiles.listChannelTargets();
    return importChannelTargetListResponseSchema.parse({ data });
  });

  app.get(profilesBase, { preHandler: [anyImportExportCode, requireAdmin('catalog:write')] }, async (request) => {
    const query = importProfileListQuerySchema.parse(request.query ?? {});
    return { data: await profiles.list(query) };
  });

  app.get(`${profilesBase}/:id`, { preHandler: [anyImportExportCode, requireAdmin('catalog:write')] }, async (request) => {
    const { id } = profileParams.parse(request.params);
    return { data: await profiles.get(id) };
  });

  app.post(profilesBase, { preHandler: [anyImportExportCode, requireAdmin('catalog:write')], bodyLimit: PROFILE_BODY_LIMIT }, async (request, reply) => {
    const body = createImportProfileRequestSchema.parse(request.body ?? {});
    const data = await profiles.create(body);
    reply.status(201);
    return { data };
  });

  app.patch(`${profilesBase}/:id`, { preHandler: [anyImportExportCode, requireAdmin('catalog:write')], bodyLimit: PROFILE_BODY_LIMIT }, async (request) => {
    const { id } = profileParams.parse(request.params);
    const body = updateImportProfileRequestSchema.parse(request.body ?? {});
    return { data: await profiles.update(id, body) };
  });

  app.delete(`${profilesBase}/:id`, { preHandler: [anyImportExportCode, requireAdmin('catalog:write')] }, async (request, reply) => {
    const { id } = profileParams.parse(request.params);
    await profiles.delete(id);
    reply.status(204);
    return null;
  });
}
