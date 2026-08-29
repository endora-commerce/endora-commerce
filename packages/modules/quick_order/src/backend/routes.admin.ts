import type { FastifyInstance } from 'fastify';
import {
  ERROR_CODES,
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  type CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import type { QuickOrderImportPipeline } from './services/import-pipeline.js';
import type { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { parseImportRequest } from './services/import-from-request.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * Admin quick-order routes (feature 039, FR-008). An operator imports a file
 * and builds a Cart / Quote Request on behalf of a specific customer +
 * organization (`onBehalfOf`), priced under that organization's price list.
 * Guarded by the `orders:write` permission.
 *
 * **A permission is not a tenant gate.** `onBehalfOf` names the customer
 * account and the organization the built Cart or Quote Request is written to,
 * and it arrives in the request body. No filter can reach it: MikroORM applies
 * a global filter to `SELECT`, `UPDATE` and `DELETE` and **not** to `INSERT`,
 * so a route that takes its tenant identity from its own input writes wherever
 * the input says. An assignment-scoped administrator (`allowed-set`) therefore
 * has to be refused here or nowhere — see {@link assertOnBehalfOfInScope}.
 */
export interface QuickOrderAdminRoutesDeps {
  pipeline: QuickOrderImportPipeline;
  buildService: QuickOrderBuildService;
  requireAdmin: RequireAdminFactory;
  resolveImportMaxRows: () => Promise<number>;
  /**
   * `customer_accounts`' published read model — the tenant boundary of the
   * build route and not a convenience. The account is `@OrgScoped`, so asking
   * this port whether it exists *is* asking whether this caller may act for
   * that customer. The module already declares the edge for its two preference
   * surfaces (manifest `dependencies`).
   */
  customerAccounts: CustomerAccountReadPort;
}

export async function registerQuickOrderAdminRoutes(
  app: FastifyInstance,
  deps: QuickOrderAdminRoutesDeps,
): Promise<void> {
  const { pipeline, buildService, requireAdmin, resolveImportMaxRows, customerAccounts } = deps;

  /**
   * Refuse an `onBehalfOf` the caller's organizations do not reach.
   *
   * Two questions, because the body answers two: the organization the row is
   * stamped with must be one the caller may act in, and the customer account
   * the row hangs off must be one the caller may reach. Passing an in-scope
   * organization id beside a foreign customer account would otherwise satisfy
   * the first on its own.
   *
   * 404 rather than 403, and the code an absent customer gets: an out-of-scope
   * customer must not be distinguishable from one that is not there.
   */
  const assertOnBehalfOfInScope = async (onBehalfOf: {
    customerAccountId: string;
    organizationId: string;
  }): Promise<void> => {
    const refuse = (): never => {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Customer account not found.');
    };
    if (!isOrgInScope(onBehalfOf.organizationId)) refuse();
    const account = await customerAccounts.findById(onBehalfOf.customerAccountId);
    if (!account) refuse();
  };

  app.post(
    '/api/v1/admin/quick-order/import',
    { preHandler: requireAdmin('orders:write'), schema: { body: quickOrderImportRequestSchema } },
    async (request) => {
      const body = quickOrderImportRequestSchema.parse(request.body);
      const maxRows = await resolveImportMaxRows();
      const parse = await parseImportRequest(body);
      // Issue #227 — `'unrestricted'`, and stated rather than omitted. This
      // route is gated by `orders:write`, and the operator names the
      // organisation on the *build* call one step later, so at import time
      // there is no buyer whose allow-list this run could be scoped by.
      const result = await pipeline.run(parse, { maxRows, audience: 'unrestricted' });
      return { data: result };
    },
  );

  app.post(
    '/api/v1/admin/quick-order/build',
    { preHandler: requireAdmin('orders:write'), schema: { body: quickOrderBuildRequestSchema } },
    async (request) => {
      const body = quickOrderBuildRequestSchema.parse(request.body);
      if (!body.onBehalfOf) {
        throw new HttpError(
          422,
          ERROR_CODES.VALIDATION_FAILED,
          'onBehalfOf is required for an admin quick-order build.',
        );
      }
      await assertOnBehalfOfInScope({
        customerAccountId: body.onBehalfOf.customerAccountId,
        organizationId: body.onBehalfOf.organizationId,
      });
      const result = await buildService.build(
        {
          customerAccountId: body.onBehalfOf.customerAccountId,
          organizationId: body.onBehalfOf.organizationId,
          isOrgAdmin: false,
        },
        {
          target: body.target,
          items: body.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          })),
        },
      );
      return { data: result };
    },
  );
}
