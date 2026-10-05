import type { FastifyInstance } from 'fastify';
import { OpportunityBoardQuerySchema } from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { BoardService } from '../services/board-service.js';

export interface BoardRoutesDeps {
  boardService: BoardService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The board (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10).
 *
 * One read, gated `crm:read` like the list it is another view of. There is no
 * board-specific write: moving a card is §2's transition endpoint.
 */
export async function registerCrmBoardRoutes(
  app: FastifyInstance,
  deps: BoardRoutesDeps,
): Promise<void> {
  app.get(
    '/api/v1/admin/crm/board',
    { preHandler: deps.requireAdmin('crm:read') },
    async (request) => ({
      data: await deps.boardService.get(OpportunityBoardQuerySchema.parse(request.query ?? {})),
    }),
  );
}
