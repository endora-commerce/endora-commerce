import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GetBundlesResponseSchema,
  I18nCoverageQuerySchema,
  I18nCoverageResponseSchema,
  PatchPreferredLanguageBodySchema,
  SupportedAdminLanguageSchema,
  type AdminUserPreferencePort,
  type GetBundlesResponse,
  type I18nCoverageResponse,
  type SupportedAdminLanguage,
} from '@endora-commerce/contracts';
import type { I18nService } from './services/i18n-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin UI i18n HTTP surface — feature 019 / contracts/admin-http.md.
 *
 *   GET   /api/v1/admin/i18n/bundles?language=…   (E-1)
 *   PATCH /api/v1/admin/me/preferred-language     (E-2)
 *   GET   /api/v1/admin/i18n/coverage             (E-3)  settings:read
 *   POST  /api/v1/admin/i18n/reload               (E-4)  settings:write
 *
 * E-1 and E-2 sit behind the admin session alone — any authenticated admin may
 * call them, no per-permission grant is required (FR-004): the first is the
 * strings every screen renders and the second writes the caller's own row.
 *
 * **E-3 and E-4 are not in that class, and were written as if they were**
 * (issue #141). Both act on the whole instance — one reports on every module's
 * bundles, the other replaces them — so each checks a permission. The codes
 * are `settings`' rather than new ones of this module's: the reload's only
 * caller is the cache screen under Settings, which is `settings:write`, and an
 * operator who can open that screen and not press one of its buttons would be
 * holding a page that half refuses. `settings` is non-deactivatable, so the
 * codes cannot become un-grantable while these routes go on enforcing them.
 */

export interface I18nAdminDeps {
  i18nService: I18nService;
  /**
   * Owned by `admin_users` (feature 075, Phase C). One method, because the
   * language override is the whole of what this surface writes to an admin
   * row; the service class this used to name carried creation, roles, deletion
   * and impersonation with it. When `admin_users` is off the PATCH answers 503
   * `MODULE_DISABLED`, which is right: there is no admin to hold a preference.
   */
  adminUserPreference: AdminUserPreferencePort;
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
  // versions) so edited translations appear without a backend restart. It
  // replaces the strings every administrator and every error envelope reads,
  // so it takes the code of the cache screen it is pressed from.
  if (deps.reload) {
    const reload = deps.reload;
    app.post(
      '/api/v1/admin/i18n/reload',
      { preHandler: deps.requireAdmin('settings:write') },
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
      const updated = await deps.adminUserPreference.setPreferredLanguage(
        ctx.adminUserId,
        body.preferredLanguage,
      );
      return {
        data: {
          preferredLanguage:
            (updated.preferredLanguage as SupportedAdminLanguage | null) ?? null,
        },
      };
    },
  );

  // --- E-3 GET coverage diagnostic — feature 021 ---------------------------
  app.get(
    '/api/v1/admin/i18n/coverage',
    {
      preHandler: deps.requireAdmin('settings:read'),
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
