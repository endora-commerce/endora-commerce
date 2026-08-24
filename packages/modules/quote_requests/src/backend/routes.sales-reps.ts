import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrganizationDetailsPort,
  SalesRepAssignmentPort,
} from '@endora-commerce/contracts';
import { QuoteRequest } from './entities/quote-request.entity.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * `GET /api/v1/admin/sales-reps/:adminUserId/organizations` — the reverse side
 * of the sales-rep assignment relation, with the open quote-request count per
 * organisation (feature 008 / T077; moved here by D-166).
 *
 * It sat in `organizations/routes.sales-reps.ts` with the three assignment
 * endpoints, in a file `quote_requests` registered through a dynamic
 * `import()`. That arrangement is what two of `organizations`' three
 * cross-module-import ledger entries described, and this is the endpoint that
 * made one of them: the open-RFQ count is **this** module's fact, so counting
 * it there meant `organizations` naming `quote_requests`' entity, and repairing
 * it in place by resolving `quoteRequestReadPort` from `organizations` would
 * have closed a manifest cycle (`quote_requests` already declares
 * `organizations`) for a question `organizations` does not own.
 *
 * Here it is built from two published ports and this module's own entity, and
 * it names no file in another module's directory at all. It stays gated
 * `rfqs:handle`, and that is the point of the split: the code is declared
 * `module: 'quote_requests'`, so it disappears from `/admin-roles` when this
 * module is switched off — which is correct precisely because this route
 * disappears with it. The three endpoints that must **not** disappear are
 * `organizations`', under `organizations:assign-sales-rep`.
 *
 * The statuses counted as "open" are the three the RFQ workflow treats as live;
 * the list is the one this endpoint has always used.
 */

/** The statuses a quote request is counted under while it is still live. */
const OPEN_STATUSES = ['Pending', 'Created from admin', 'Approved'] as const;

export interface QuoteRequestsSalesRepRoutesDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  salesRepAssignment: SalesRepAssignmentPort;
  organizations: OrganizationDetailsPort;
}

export async function registerQuoteRequestsSalesRepRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsSalesRepRoutesDeps,
): Promise<void> {
  const { emFactory, requireAdmin, salesRepAssignment, organizations } = deps;
  const guard = requireAdmin('rfqs:handle');

  app.get<{ Params: { adminUserId: string } }>(
    '/api/v1/admin/sales-reps/:adminUserId/organizations',
    { preHandler: guard },
    async (request) => {
      const orgIds = await salesRepAssignment.listAssignedOrganizationIds(
        request.params.adminUserId,
      );
      if (orgIds.length === 0) return { data: [] };

      const orgs = await organizations.findByIds(orgIds);
      const em = emFactory();
      const open = await em.find(QuoteRequest, {
        organizationId: { $in: orgIds },
        status: { $in: [...OPEN_STATUSES] },
      });
      const countByOrg = new Map<string, number>();
      for (const r of open) {
        countByOrg.set(r.organizationId, (countByOrg.get(r.organizationId) ?? 0) + 1);
      }
      return {
        data: orgs.map((o) => ({
          organizationId: o.id,
          name: o.name,
          openRfqCount: countByOrg.get(o.id) ?? 0,
          assignedAt: o.createdAt.toISOString(),
        })),
      };
    },
  );
}
