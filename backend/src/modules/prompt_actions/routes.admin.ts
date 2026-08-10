import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ClarifyRequestSchema,
  ERROR_CODES,
  PromptActionListQuerySchema,
  SubmitPromptRequestSchema,
  type PromptActionRequestDto,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { PROMPT_ACTIONS_USE_PERMISSION } from './manifest.js';
import type { PromptActionRequest } from './entities/prompt-action-request.entity.js';
import type { PromptRequestService, OperatorContext } from './services/prompt-request.service.js';
import type { LlmProviderFactory } from './services/llm/provider-factory.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin HTTP surface — feature 043 (contracts/prompt-actions-api.md).
 *
 *   GET    /api/v1/admin/prompt-actions/capability
 *   POST   /api/v1/admin/prompt-actions/requests
 *   GET    /api/v1/admin/prompt-actions/requests          (?unseen=true&limit=)
 *   GET    /api/v1/admin/prompt-actions/requests/:id
 *   POST   /api/v1/admin/prompt-actions/requests/:id/clarify
 *   POST   /api/v1/admin/prompt-actions/requests/:id/confirm
 *   POST   /api/v1/admin/prompt-actions/requests/:id/cancel
 *   POST   /api/v1/admin/prompt-actions/requests/:id/seen
 *
 * All routes are gated by `requireAdmin('prompt_actions:use')`; each
 * planned operation is additionally re-checked against its own permission
 * inside the executor (FR-007).
 */

export interface PromptActionsRoutesDeps {
  requestService: PromptRequestService;
  providerFactory: LlmProviderFactory;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: (req: FastifyRequest) => { adminUserId: string };
}

export async function registerPromptActionsAdminRoutes(
  app: FastifyInstance,
  deps: PromptActionsRoutesDeps,
): Promise<void> {
  const { requestService, providerFactory, requireAdmin, resolveAdminContext } = deps;
  const guard = requireAdmin(PROMPT_ACTIONS_USE_PERMISSION);

  const operator = (request: FastifyRequest): OperatorContext => {
    const { adminUserId } = resolveAdminContext(request);
    const rid = request.headers['x-request-id'];
    const language = request.headers['x-admin-language'];
    return {
      adminUserId,
      language: typeof language === 'string' ? language : null,
      auditCtx: {
        ipAddress: request.ip ?? null,
        userAgent: request.headers['user-agent'] ?? null,
        requestId: typeof rid === 'string' ? rid : null,
      },
    };
  };

  const dto = (row: PromptActionRequest): { data: PromptActionRequestDto } => ({
    data: {
      id: row.id,
      status: row.status,
      prompt: row.prompt,
      plan: row.plan ?? null,
      clarification: row.clarification ?? null,
      result: row.result ?? null,
      error: row.error ?? null,
      bulkOperationId: row.bulkOperationId ?? null,
      expiresAt: requestService.expiresAt(row)?.toISOString() ?? null,
      seenAt: row.seenAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    },
  });

  app.get(
    '/api/v1/admin/prompt-actions/capability',
    { preHandler: guard },
    async () => ({ data: await providerFactory.capability() }),
  );

  app.post(
    '/api/v1/admin/prompt-actions/requests',
    { preHandler: guard },
    async (request, reply) => {
      const body = SubmitPromptRequestSchema.parse(request.body);
      // Disabled / unconfigured assistants reject before any row is created.
      const capability = await providerFactory.capability();
      if (capability.status === 'disabled') {
        throw new HttpError(
          409,
          ERROR_CODES.ASSISTANT_DISABLED,
          'The prompt assistant is disabled on this platform.',
        );
      }
      if (capability.status === 'not_configured') {
        throw new HttpError(
          409,
          ERROR_CODES.ASSISTANT_NOT_CONFIGURED,
          'The prompt assistant is not configured — set the provider, model and API key in Settings.',
        );
      }
      const row = await requestService.submit(operator(request), body.prompt);
      reply.code(201);
      return dto(row);
    },
  );

  app.get(
    '/api/v1/admin/prompt-actions/requests',
    { preHandler: guard },
    async (request) => {
      const q = PromptActionListQuerySchema.parse(request.query ?? {});
      const rows = q.unseen
        ? await requestService.listUnseenFinished(operator(request), q.limit)
        : [];
      return { data: rows.map((r) => dto(r).data) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/prompt-actions/requests/:id',
    { preHandler: guard },
    async (request) => dto(await requestService.get(operator(request), request.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/prompt-actions/requests/:id/clarify',
    { preHandler: guard },
    async (request) => {
      const body = ClarifyRequestSchema.parse(request.body);
      const row = await requestService.clarify(operator(request), request.params.id, body);
      return dto(row);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/prompt-actions/requests/:id/confirm',
    { preHandler: guard },
    async (request) => dto(await requestService.confirm(operator(request), request.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/prompt-actions/requests/:id/cancel',
    { preHandler: guard },
    async (request) => dto(await requestService.cancel(operator(request), request.params.id)),
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/prompt-actions/requests/:id/seen',
    { preHandler: guard },
    async (request, reply) => {
      await requestService.markSeen(operator(request), request.params.id);
      reply.code(204);
    },
  );
}
