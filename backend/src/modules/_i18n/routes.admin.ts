import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GetBundlesResponseSchema,
  I18nCoverageQuerySchema,
  I18nCoverageResponseSchema,
  PatchPreferredLanguageBodySchema,
  SupportedAdminLanguageSchema,
  type GetBundlesResponse,
  type I18nCoverageResponse,
  type SupportedAdminLanguage,
} from '@b2b/contracts';
import type { I18nService } from './services/i18n-service.js';
import type { AdminUserService } from '../admin_users/services/admin-user-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin UI i18n HTTP surface — feature 019 / contracts/admin-http.md.
 *
 *   GET  /api/v1/admin/i18n/bundles?language=…   (E-1)
 *   PATCH /api/v1/admin/me/preferred-language    (E-2)
 *
 * Both endpoints sit behind the standard admin auth gate — any
 * authenticated admin may call them; no per-permission grant is
 * required (FR-004).
 */

export interface I18nAdminDeps {
  i18nService: I18nService;
  adminUserService: AdminUserService;
  requireAdmin: RequireAdminFactory;
  /** Resolves the calling admin's id; reads `request.actor` in production. */
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
  /**
   * Re-reads every module's on-disk i18n bundles into the DB without a
   * restart. Optional — when absent the reload endpoint is not registered.
   */
  reload?: () => Promise<{ installed: number; skipped: number; failed: number }>;
}

export async function registerI18nAdminRoutes(
  app: FastifyInstance,
  deps: I18nAdminDeps,
): Promise<void> {
  // --- E-1 GET bundles -----------------------------------------------------
  // The Fastify Zod plugin validates the `language` query param against the
  // supported allowlist; any non-matching value yields the standard 400
  // VALIDATION_FAILED envelope (see http/error-envelope.ts).
  const getBundlesQuerySchema = z.object({
    language: SupportedAdminLanguageSchema,
  });
  app.get(
    '/api/v1/admin/i18n/bundles',
    {
      preHandler: deps.requireAdmin(),
      schema: { querystring: getBundlesQuerySchema },
    },
    async (request): Promise<{ data: GetBundlesResponse }> => {
      const { language } = getBundlesQuerySchema.parse(request.query);
      const merged = await deps.i18nService.getMergedBundleForLanguage(language);
      const payload: GetBundlesResponse = {
        language,
        version: merged.version,
        bundles: merged.bundles,
      };
      // Validate the outgoing shape too — cheap and catches schema drift.
      return { data: GetBundlesResponseSchema.parse(payload) };
    },
  );

  // --- E-4 POST reload bundles (hot-reload on-disk translations) -----------
  // Re-reads every module's i18n JSON into `translation_bundles` (bumping
  // versions) so edited translations appear without a backend restart. Any
  // authenticated admin may trigger it, matching the other i18n endpoints.
  if (deps.reload) {
    const reload = deps.reload;
    app.post(
      '/api/v1/admin/i18n/reload',
      { preHandler: deps.requireAdmin() },
      async (): Promise<{ data: { installed: number; skipped: number; failed: number } }> => {
        const result = await reload();
        return { data: result };
      },
    );
  }

  // --- E-2 PATCH self preferred-language ----------------------------------
  app.patch(
    '/api/v1/admin/me/preferred-language',
    {
      preHandler: deps.requireAdmin(),
      schema: { body: PatchPreferredLanguageBodySchema },
    },
    async (
      request,
    ): Promise<{ data: { preferredLanguage: SupportedAdminLanguage | null } }> => {
      const ctx = deps.resolveAdminContext(request);
      const body = PatchPreferredLanguageBodySchema.parse(request.body);
      const updated = await deps.adminUserService.setPreferredLanguage(
        ctx.adminUserId,
        body.preferredLanguage,
      );
      return {
        data: {
          preferredLanguage:
            (updated.preferredLanguage as SupportedAdminLanguage | null | undefined) ??
            null,
        },
      };
    },
  );

  // --- E-3 GET coverage diagnostic — feature 021 ---------------------------
  app.get(
    '/api/v1/admin/i18n/coverage',
    {
      preHandler: deps.requireAdmin(),
      schema: { querystring: I18nCoverageQuerySchema },
    },
    async (request): Promise<{ data: I18nCoverageResponse }> => {
      const q = I18nCoverageQuerySchema.parse(request.query ?? {});
      const moduleIds = q.module === undefined
        ? undefined
        : Array.isArray(q.module)
          ? q.module
          : [q.module];
      const languageCodes = q.language === undefined
        ? undefined
        : Array.isArray(q.language)
          ? q.language
          : [q.language];
      const snapshot = await deps.i18nService.getCoverageSnapshot({
        ...(moduleIds !== undefined ? { moduleIds } : {}),
        ...(languageCodes !== undefined ? { languageCodes } : {}),
        ...(q.includeKeys !== undefined ? { includeKeys: q.includeKeys } : {}),
      });
      return { data: I18nCoverageResponseSchema.parse(snapshot) };
    },
  );
}
