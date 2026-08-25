import type { FastifyInstance, FastifyRequest } from 'fastify';
import { LlmToggleRequestSchema, type SettingsAdminAuditContext } from '@endora-commerce/contracts';
import type { LlmToggleService } from './services/llm-toggle.service.js';
import type { SearchReindexWorker } from './services/search-reindex-worker.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin HTTP surface — feature 006 / US2 (T025).
 *
 * Mounts under `/api/v1/admin/search/*`:
 *   - POST /llm/toggle — flip `search.llm.enabled` on/off with cross-
 *     setting validation. Refuses to enable for any channel whose
 *     embedder.* triplet is incomplete (FR-011).
 *
 * The three embedder.* values themselves are still saved through the
 * generic Settings admin route (`PUT /api/v1/admin/settings/:code/value`).
 * That keeps the per-field audit trail intact while the toggle remains
 * the single guarded entry point for `enabled`.
 */

export interface SearchAdminDeps {
  llmToggleService: LlmToggleService;
  /** Backs the manual "Reindex now" admin action. */
  reindexWorker: SearchReindexWorker;
  requireAdmin: RequireAdminFactory;
  /** Resolves the audit actor from the request; mirrors Settings' shape. */
  resolveAdminAuditContext?: (req: FastifyRequest) => SettingsAdminAuditContext;
}

export async function registerSearchAdminRoutes(
  app: FastifyInstance,
  deps: SearchAdminDeps,
): Promise<void> {
  const { llmToggleService, reindexWorker, requireAdmin, resolveAdminAuditContext } = deps;

  // Manual full Meilisearch reindex — the on-demand equivalent of the
  // periodic `search.reindex_interval_minutes` sweep. Runs synchronously and
  // returns a per-run summary. Gated by the existing `search:write`
  // permission (no new permission code introduced).
  app.post(
    '/api/v1/admin/search/reindex',
    { preHandler: requireAdmin('search:write') },
    async (_request, reply) => {
      const result = await reindexWorker.reindex();
      return reply.send(result);
    },
  );

  app.post(
    '/api/v1/admin/search/llm/toggle',
    { preHandler: requireAdmin('search:write') },
    async (request) => {
      const body = LlmToggleRequestSchema.parse(request.body);
      const actor: SettingsAdminAuditContext = resolveAdminAuditContext
        ? resolveAdminAuditContext(request)
        : { actorAdminUserId: null };
      const result = await llmToggleService.toggle({
        enabled: body.enabled,
        ...(body.salesChannelCodes !== undefined
          ? { salesChannelCodes: body.salesChannelCodes }
          : {}),
        expectedVersion: body.expectedVersion ?? null,
        actor,
      });
      return {
        code: 'search.llm.enabled' as const,
        enabled: result.enabled,
        newVersion: result.newVersion,
        appliedChannelIds: result.appliedChannelIds,
      };
    },
  );
}
