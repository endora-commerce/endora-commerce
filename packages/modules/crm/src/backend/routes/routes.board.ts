import type { FastifyInstance } from 'fastify';
import {
  OpportunityBoardQuerySchema,
  SetOpportunityBoardCardFieldsRequestSchema,
} from '@endora-commerce/contracts';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { BoardCardFieldService } from '../services/board-card-field-service.js';
import type { BoardService } from '../services/board-service.js';

export interface BoardRoutesDeps {
  boardService: BoardService;
  boardCardFieldService: BoardCardFieldService;
  requireAdmin: RequireAdminFactory;
}

/**
 * The board (`specs/143-crm-sales-opportunities/contracts/admin-api.md` §10).
 *
 * One read, gated `crm:read` like the list it is another view of. Moving a
 * card is §2's transition endpoint.
 *
 * What a card shows (§12c, User Story 19) is read on `crm:read` — the board
 * needs it to render — and written on `crm:configure`, answering the
 * configuration as it stands afterwards.
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

  app.get(
    '/api/v1/admin/crm/board/card-fields',
    { preHandler: deps.requireAdmin('crm:read') },
    async () => ({ data: await deps.boardCardFieldService.config() }),
  );

  app.put(
    '/api/v1/admin/crm/board/card-fields',
    {
      preHandler: deps.requireAdmin('crm:configure'),
      schema: { body: SetOpportunityBoardCardFieldsRequestSchema },
    },
    async (request) => ({
      data: await deps.boardCardFieldService.set(
        SetOpportunityBoardCardFieldsRequestSchema.parse(request.body).fields,
      ),
    }),
  );
}
