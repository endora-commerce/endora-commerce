import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChannelMemberEntityTypeSchema,
  ERROR_CODES,
  SalesChannelCreateBodySchema,
  SalesChannelUpdateBodySchema,
  type ChannelMemberEntityType,
} from '@b2b/contracts';
import { z } from 'zod';
import { HttpError } from '../../http/error-envelope.js';
import type {
  AdminAuditContext,
  SalesChannelsService,
} from './services/sales-channels.service.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import type { SalesChannel } from '../../kernel/sales-channels/sales-channel.entity.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin HTTP surface — feature 005 / US2 (T034).
 *
 * Mounts under `/api/v1/admin/sales-channels/*`:
 *   - GET    /                   — list (sales_channels:read)
 *   - GET    /:code              — detail (sales_channels:read)
 *   - POST   /                   — create (sales_channels:write)
 *   - PATCH  /:code              — update (sales_channels:write); optimistic-
 *                                  concurrency via the body's `expectedVersion`
 *                                  field (matches feature 003/004 pattern; the
 *                                  `If-Match` header in the contract markdown
 *                                  is sugar that drops here later).
 *   - POST   /:code/deactivate   — deactivate (sales_channels:write)
 *   - POST   /:code/activate     — activate (sales_channels:write)
 *   - DELETE /:code              — hard delete (sales_channels:write); accepts
 *                                  `?fallbackToDefault=true` to rebind orphan
 *                                  members in the same transaction.
 *
 * Permission codes are placeholders that match the existing settings /
 * admin-roles vocabulary; the constitution authority gate (Principle II)
 * is upheld by the `requireAdmin(<permission>)` factory injected by the
 * composition root.
 */

const SC_READ = 'sales_channels:read';
const SC_WRITE = 'sales_channels:write';

const ListQuerySchema = z.object({
  page: z.coerce.number().int().nonnegative().optional(),
  pageSize: z.coerce.number().int().positive().max(200).optional(),
  activeOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
});

const DeleteQuerySchema = z.object({
  fallbackToDefault: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
});

/**
 * The PATCH body's optimistic-concurrency token rides alongside the
 * partial identity fields. We pull out `expectedVersion` and parse the
 * rest with the contract's update schema so the cross-field
 * `defaultLanguage ∈ languages` rule still applies (the contract's
 * superRefine cannot be `extended()`).
 */
const ExpectedVersionShape = z.object({
  expectedVersion: z.number().int().positive(),
});

export interface SalesChannelsAdminDeps {
  salesChannelsService: SalesChannelsService;
  membershipService: SalesChannelMembershipService;
  requireAdmin: RequireAdminFactory;
  resolveAdminAuditContext?: (req: FastifyRequest) => AdminAuditContext;
}

export async function registerSalesChannelsAdminRoutes(
  app: FastifyInstance,
  deps: SalesChannelsAdminDeps,
): Promise<void> {
  const {
    salesChannelsService,
    membershipService,
    requireAdmin,
    resolveAdminAuditContext,
  } = deps;

  const auditContext = (request: FastifyRequest): AdminAuditContext => {
    const ctx = resolveAdminAuditContext?.(request) ?? { actorAdminUserId: null };
    const rid = request.headers['x-request-id'];
    return {
      ...ctx,
      requestId: typeof rid === 'string' ? rid : null,
    };
  };

  function setEtag(reply: FastifyReply, channel: SalesChannel): void {
    reply.header('etag', `W/"${channel.id}:${channel.version}"`);
  }

  function serializeSummary(c: SalesChannel): Record<string, unknown> {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      active: c.active,
      systemDefault: c.systemDefault,
      defaultLanguage: c.defaultLanguage,
      defaultCurrency: c.defaultCurrency,
      themeCode: c.themeCode ?? null,
      logoAssetId: c.logoAssetId ?? null,
      version: c.version,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    };
  }

  function serializeDetail(c: SalesChannel): Record<string, unknown> {
    return {
      ...serializeSummary(c),
      languages: c.languages,
      currencies: c.currencies,
      // logoUrl resolved through the assets module is left null here for
      // the initial v1; T038's admin client just reads logoAssetId and
      // resolves the URL via the existing assets endpoint. A follow-up
      // can fold the resolution server-side if storefront use grows.
      logoUrl: null,
    };
  }

  // -- List -----------------------------------------------------------------

  app.get(
    '/api/v1/admin/sales-channels',
    { preHandler: requireAdmin(SC_READ) },
    async (request) => {
      const q = ListQuerySchema.parse(request.query ?? {});
      const result = await salesChannelsService.list({
        ...(q.page !== undefined ? { page: q.page } : {}),
        ...(q.pageSize !== undefined ? { pageSize: q.pageSize } : {}),
        ...(q.activeOnly !== undefined ? { activeOnly: q.activeOnly } : {}),
      });
      return {
        items: result.items.map(serializeSummary),
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      };
    },
  );

  // -- Detail ---------------------------------------------------------------

  app.get<{ Params: { code: string } }>(
    '/api/v1/admin/sales-channels/:code',
    { preHandler: requireAdmin(SC_READ) },
    async (request, reply) => {
      const channel = await salesChannelsService.getByCode(request.params.code);
      if (channel === null) {
        throw new HttpError(
          404,
          ERROR_CODES.NOT_FOUND,
          `Sales channel "${request.params.code}" was not found.`,
        );
      }
      setEtag(reply, channel);
      return serializeDetail(channel);
    },
  );

  // -- Create ---------------------------------------------------------------

  app.post(
    '/api/v1/admin/sales-channels',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const body = SalesChannelCreateBodySchema.parse(request.body);
      const channel = await salesChannelsService.create(body, auditContext(request));
      reply.code(201);
      setEtag(reply, channel);
      return serializeDetail(channel);
    },
  );

  // -- Update ---------------------------------------------------------------

  app.patch<{ Params: { code: string } }>(
    '/api/v1/admin/sales-channels/:code',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const raw = (request.body ?? {}) as Record<string, unknown>;
      const { expectedVersion } = ExpectedVersionShape.parse({
        expectedVersion: raw['expectedVersion'],
      });
      const { expectedVersion: _ignored, ...rest } = raw;
      const body = SalesChannelUpdateBodySchema.parse(rest);
      const channel = await salesChannelsService.update(
        request.params.code,
        body,
        expectedVersion,
        auditContext(request),
      );
      setEtag(reply, channel);
      return serializeDetail(channel);
    },
  );

  // -- Lifecycle ------------------------------------------------------------

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/sales-channels/:code/deactivate',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const channel = await salesChannelsService.deactivate(
        request.params.code,
        auditContext(request),
      );
      setEtag(reply, channel);
      return serializeDetail(channel);
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/v1/admin/sales-channels/:code/activate',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const channel = await salesChannelsService.activate(
        request.params.code,
        auditContext(request),
      );
      setEtag(reply, channel);
      return serializeDetail(channel);
    },
  );

  app.delete<{ Params: { code: string } }>(
    '/api/v1/admin/sales-channels/:code',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const q = DeleteQuerySchema.parse(request.query ?? {});
      await salesChannelsService.delete(
        request.params.code,
        { fallbackToDefault: q.fallbackToDefault ?? false },
        auditContext(request),
      );
      reply.code(204);
      return reply.send();
    },
  );

  // -------------------------------------------------------------------------
  // Membership routes — feature 005 / Phase 5b (T049-T058 consolidated).
  //
  // Both directions of the bidirectional relationship are mounted under
  // `/api/v1/admin/sales-channels/*` so all 9 entity types (no
  // `inventory-location` per the deferral) get coverage in one
  // centralised file. The plan's per-owning-module mounts under
  // `/admin/products/{id}/sales-channels` etc. would have required
  // touching 9 modules' route files; consolidating here keeps the
  // feature reviewable and the membership service is the single
  // source of truth either way (FR-010).
  //
  //   GET    /api/v1/admin/sales-channels/:code/:entityType
  //   PUT    /api/v1/admin/sales-channels/:code/:entityType/:entityId
  //   DELETE /api/v1/admin/sales-channels/:code/:entityType/:entityId
  //                  ?fallbackToDefault=true
  //   GET    /api/v1/admin/sales-channels/by-entity/:entityType/:entityId
  //
  // The "by-entity" path replaces the contract's
  // `/admin/{T}/{entityId}/sales-channels` shape — functionally
  // equivalent for the admin UI's membership panel and avoids
  // dispersing the implementation across each owning module's
  // routes.admin.ts.
  // -------------------------------------------------------------------------

  const PageQuerySchema = z.object({
    page: z.coerce.number().int().nonnegative().optional(),
    pageSize: z.coerce.number().int().positive().max(200).optional(),
  });

  const MembershipDeleteQuerySchema = z.object({
    fallbackToDefault: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => (typeof v === 'string' ? v === 'true' : v))
      .optional(),
  });

  function parseEntityType(raw: string): ChannelMemberEntityType {
    const result = ChannelMemberEntityTypeSchema.safeParse(raw);
    if (!result.success) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Unknown channel-scoped entity type "${raw}".`,
      );
    }
    return result.data;
  }

  async function requireChannelByCode(code: string): Promise<SalesChannel> {
    const channel = await salesChannelsService.getByCode(code);
    if (channel === null) {
      throw new HttpError(
        404,
        ERROR_CODES.UNKNOWN_SALES_CHANNEL,
        `Sales channel "${code}" was not found.`,
      );
    }
    return channel;
  }

  // -- Channel-side: list members of a channel for one entity type ---------

  app.get<{ Params: { code: string; entityType: string } }>(
    '/api/v1/admin/sales-channels/:code/:entityType',
    { preHandler: requireAdmin(SC_READ) },
    async (request) => {
      const entityType = parseEntityType(request.params.entityType);
      const channel = await requireChannelByCode(request.params.code);
      const q = PageQuerySchema.parse(request.query ?? {});
      const page = q.page ?? 0;
      const pageSize = q.pageSize ?? 100;
      const result = await membershipService.listEntityIdsForChannel(
        channel.id,
        entityType,
        page,
        pageSize,
      );
      return {
        salesChannelCode: channel.code,
        entityType,
        entityIds: result.entityIds,
        page,
        pageSize,
        total: result.total,
      };
    },
  );

  // -- Channel-side: add membership ----------------------------------------

  app.put<{ Params: { code: string; entityType: string; entityId: string } }>(
    '/api/v1/admin/sales-channels/:code/:entityType/:entityId',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const entityType = parseEntityType(request.params.entityType);
      const channel = await requireChannelByCode(request.params.code);
      const ctx = auditContext(request);
      const result = await membershipService.addToChannel(
        channel.id,
        entityType,
        request.params.entityId,
        { actorAdminUserId: ctx.actorAdminUserId },
      );
      reply.code(result.changed ? 201 : 200);
      return {
        salesChannelCode: channel.code,
        entityType,
        entityId: request.params.entityId,
        changed: result.changed,
      };
    },
  );

  // -- Channel-side: remove membership -------------------------------------

  app.delete<{ Params: { code: string; entityType: string; entityId: string } }>(
    '/api/v1/admin/sales-channels/:code/:entityType/:entityId',
    { preHandler: requireAdmin(SC_WRITE) },
    async (request, reply) => {
      const entityType = parseEntityType(request.params.entityType);
      const channel = await requireChannelByCode(request.params.code);
      const q = MembershipDeleteQuerySchema.parse(request.query ?? {});
      const ctx = auditContext(request);
      const result = await membershipService.removeFromChannel(
        channel.id,
        entityType,
        request.params.entityId,
        {
          fallbackToDefault: q.fallbackToDefault ?? false,
          actorAdminUserId: ctx.actorAdminUserId,
        },
      );
      reply.code(200);
      return {
        salesChannelCode: channel.code,
        entityType,
        entityId: request.params.entityId,
        changed: result.changed,
        fallbackAppliedToDefault: result.fallbackAppliedToDefault ?? false,
      };
    },
  );

  // -- Entity-side: list channels of an entity -----------------------------

  app.get<{ Params: { entityType: string; entityId: string } }>(
    '/api/v1/admin/sales-channels/by-entity/:entityType/:entityId',
    { preHandler: requireAdmin(SC_READ) },
    async (request) => {
      const entityType = parseEntityType(request.params.entityType);
      const channels = await membershipService.listChannelsForEntity(
        entityType,
        request.params.entityId,
      );
      return {
        entityType,
        entityId: request.params.entityId,
        channels: channels.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          active: c.active,
          systemDefault: c.systemDefault,
          defaultLanguage: c.defaultLanguage,
          defaultCurrency: c.defaultCurrency,
          themeCode: c.themeCode ?? null,
          logoAssetId: c.logoAssetId ?? null,
          version: c.version,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
      };
    },
  );
}
