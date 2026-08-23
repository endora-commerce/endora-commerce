import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KnownIconNameSchema,
  RecentActivityVisibilityListSchema,
  RecentActivityVisibilityRequestSchema,
  RecentActivityVisibilityResponseSchema,
  type RecentActivityVisibilityList,
  type RecentActivityVisibilityResponse,
} from '@endora-commerce/contracts';
import type { CommandBus } from '../../commands/index.js';
import { HttpError } from '../../http/error-envelope.js';
import { makeSetRecentActivityVisibilityCommand } from './commands/recent-activity-visibility.commands.js';
import type { RecentActivityCatalog } from './services/recent-activity-catalog.js';
import type { RecentActivityService } from './services/recent-activity-service.js';
import type { RecentActivityVisibility } from './services/recent-activity-visibility.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Feature 024 — `GET /api/v1/admin/audit-log/recent-activity`, and since
 * feature 080's T042j the two routes behind the operator's control over it.
 *
 * **The response schema is derived** (D-163.1). `action` and `module` used to
 * be `z.enum` over two host-written arrays — the second three members long,
 * against a server that could emit four — so the contract and the server
 * disagreed about `prompt_action.execute` for as long as feature 043 had
 * shipped. Both enums are built from the composed modules' `recentActivity`
 * declarations now, which is the same input the query's `$in` is built from, so
 * they cannot disagree with it and a packaged module is in both.
 *
 * The **declaration** axis decides the schema and the **operator** axis decides
 * the data, deliberately: a schema that narrowed to the currently-visible set
 * would change shape when an operator flipped a switch, and a client holding
 * the OpenAPI document would see a breaking change in a display preference.
 *
 * Permission: the same `audit_log:read` scope as the wider audit-log read
 * endpoint for the card itself; `platform.modules.activate` for the visibility
 * surface, which is the code that already governs this operator's per-module
 * switches on the screen the control renders on.
 */

export interface RecentActivityAdminDeps {
  recentActivityService: RecentActivityService;
  recentActivityCatalog: RecentActivityCatalog;
  recentActivityVisibility: RecentActivityVisibility;
  requireAdmin: RequireAdminFactory;
  /**
   * Omitted in a composition with no Command Bus — the card still renders,
   * because reading the dashboard must not depend on being able to reconfigure
   * it. The same shape `_lifecycle`'s activation write uses.
   */
  commandBus?: CommandBus;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).optional(),
});

/**
 * A closed enum where the composition declares something, a plain string where
 * it declares nothing.
 *
 * `z.enum([])` is not a schema, and a bare-core build with every declaring
 * module removed is a legitimate composition. The fallback describes the shape
 * honestly rather than pretending to a closed set of nothing.
 */
function tokenSchema(values: readonly string[]): z.ZodType<string> {
  if (values.length === 0) return z.string().min(1);
  return z.enum(values as [string, ...string[]]);
}

export function buildRecentActivityResponseSchema(catalog: RecentActivityCatalog) {
  const itemSchema = z.object({
    id: z.string().uuid(),
    actedAt: z.string(),
    action: tokenSchema(catalog.actions()),
    module: tokenSchema(catalog.moduleIds()),
    icon: KnownIconNameSchema,
    labelKey: z.string().min(1),
    actorDisplayName: z.string().min(1),
    actorKind: z.enum(['admin', 'system']),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    targetDisplayName: z.string().min(1),
    targetUrl: z.string().nullable(),
    summary: z.record(z.string(), z.unknown()).nullable(),
  });

  return z.object({
    data: z.array(itemSchema),
    pagination: z.object({
      limit: z.number().int().min(1).max(12),
      fetchedAt: z.string(),
    }),
  });
}

export type RecentActivityRouteResponse = z.infer<
  ReturnType<typeof buildRecentActivityResponseSchema>
>;

export async function registerRecentActivityRoutes(
  app: FastifyInstance,
  deps: RecentActivityAdminDeps,
): Promise<void> {
  const {
    recentActivityService,
    recentActivityCatalog,
    recentActivityVisibility,
    requireAdmin,
  } = deps;

  app.get(
    '/api/v1/admin/audit-log/recent-activity',
    { preHandler: requireAdmin('audit_log:read') },
    async (request, reply) => {
      const parsed = querySchema.safeParse(request.query ?? {});
      if (!parsed.success) {
        return reply.status(400).send({
          error: {
            code: 'validation_error',
            message: 'Invalid query parameters',
            details: parsed.error.flatten(),
          },
        });
      }
      const input: { limit?: number } = {};
      if (parsed.data.limit !== undefined) input.limit = parsed.data.limit;
      return recentActivityService.list(input);
    },
  );

  /**
   * The operator axis of D-163.1, read.
   *
   * Gated on `platform.modules.activate` rather than on `audit_log:read`: this
   * is a per-module operator switch, it renders beside the activation control
   * on `/platform/modules`, and whoever may switch a module off may certainly
   * decide whether its rows reach a dashboard. Declaring a second code for the
   * same operator on the same screen would be a checkbox that grants nothing
   * anybody would grant separately.
   */
  app.get(
    '/api/v1/admin/audit-log/recent-activity/visibility',
    {
      preHandler: requireAdmin('platform.modules.activate'),
      schema: { response: { 200: RecentActivityVisibilityListSchema } },
    },
    async (): Promise<RecentActivityVisibilityList> => ({
      modules: await recentActivityVisibility.list(),
    }),
  );

  const commandBus = deps.commandBus;
  if (!commandBus) return;

  app.post<{ Params: { moduleId: string } }>(
    '/api/v1/admin/audit-log/recent-activity/visibility/:moduleId',
    {
      preHandler: requireAdmin('platform.modules.activate'),
      schema: {
        body: RecentActivityVisibilityRequestSchema,
        response: { 200: RecentActivityVisibilityResponseSchema },
      },
    },
    async (request): Promise<RecentActivityVisibilityResponse> => {
      const body = RecentActivityVisibilityRequestSchema.parse(request.body);
      const { moduleId } = request.params;
      const result = await commandBus.run(
        makeSetRecentActivityVisibilityCommand(recentActivityCatalog, {
          moduleId,
          visible: body.visible,
        }),
      );
      // Re-read rather than echo, for the reason the activation control does
      // not update optimistically: what the operator sees is what the platform
      // resolved, not what this handler assumed.
      const row = (await recentActivityVisibility.list()).find(
        (entry) => entry.moduleId === result.moduleId,
      );
      if (!row) {
        throw new HttpError(
          500,
          'INTERNAL',
          `Module "${result.moduleId}" vanished from the recent-activity catalog after its ` +
            `dashboard visibility was written.`,
        );
      }
      return { module: row };
    },
  );
}
