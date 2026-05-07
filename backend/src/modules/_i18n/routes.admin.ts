import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  GetBundlesResponseSchema,
  PatchPreferredLanguageBodySchema,
  SupportedAdminLanguageSchema,
  type GetBundlesResponse,
  type SupportedAdminLanguage,
} from '@b2b/contracts';
import type { I18nService } from './services/i18n-service.js';
import type { AdminUserService } from '../admin_users/services/admin-user-service.js';

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

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface I18nAdminDeps {
  i18nService: I18nService;
  adminUserService: AdminUserService;
  requireAdmin: RequireAdminFactory;
  /** Resolves the calling admin's id; reads `request.actor` in production. */
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
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
}
