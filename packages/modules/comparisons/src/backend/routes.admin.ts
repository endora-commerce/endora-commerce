import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  comparisonAdminListQuerySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ComparisonNotFoundError } from './services/comparison-service.js';
import type { ComparisonAdminService } from './services/comparison-admin.service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin HTTP surface — feature 007 / US5 / T064.
 *
 * Mounts under `/api/v1/admin/comparisons/*` and is GET-only:
 *
 *   - GET /api/v1/admin/comparisons         — list with filters
 *   - GET /api/v1/admin/comparisons/:id     — single-comparison detail
 *
 * Spec FR-022: "MUST allow an administrator to open any single
 * Comparison and inspect ... without offering any controls that mutate
 * the Comparison." Translated literally — no PATCH, no POST, no
 * DELETE under this prefix.
 */

export interface ComparisonsAdminDeps {
  adminService: ComparisonAdminService;
  requireAdmin: RequireAdminFactory;
}

export async function registerComparisonsAdminRoutes(
  app: FastifyInstance,
  deps: ComparisonsAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/comparisons',
    { preHandler: requireAdmin('comparisons:read') },
    async (request) => {
      const query = parseListQuery(request.query);
      const { data, nextCursor, limit } = await adminService.list(query);
      return { data, meta: { limit, nextCursor } };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/comparisons/:id',
    { preHandler: requireAdmin('comparisons:read') },
    async (request) => {
      try {
        return { data: await adminService.detail(request.params.id) };
      } catch (err) {
        if (err instanceof ComparisonNotFoundError) {
          throw new HttpError(
            404,
            ERROR_CODES.COMPARISON_NOT_FOUND,
            'Comparison not found.',
          );
        }
        throw err;
      }
    },
  );
}

function parseListQuery(input: unknown) {
  // Coerce numeric strings (Fastify hands query params as strings) before Zod.
  const raw = (input ?? {}) as Record<string, unknown>;
  const coerced = {
    ...raw,
    ...(typeof raw['limit'] === 'string'
      ? { limit: Number(raw['limit']) }
      : {}),
  };
  const parsed = comparisonAdminListQuerySchema.safeParse(coerced);
  if (!parsed.success) {
    throw new HttpError(
      422,
      ERROR_CODES.VALIDATION_FAILED,
      'Validation failed.',
      parsed.error.issues.map((i) => ({
        path: i.path.map(String).join('.'),
        issue: i.message,
      })),
    );
  }
  return parsed.data;
}
