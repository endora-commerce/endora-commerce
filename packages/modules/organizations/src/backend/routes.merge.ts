import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  isUuidShape,
  organizationMergeListQuerySchema,
  organizationMergePreviewBodySchema,
  organizationMergeStartBodySchema,
  organizationMergeVersionBodySchema,
  type OrganizationMergeListResponse,
  type OrganizationMergePreviewResponse,
  type OrganizationMergeRecord,
  type OrganizationMergeRecordResponse,
  type OrganizationMergeView,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminAnyFactory, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { orgConstraintFor } from '@endora-commerce/platform/tenancy';
import { Organization } from './entities/organization.entity.js';
import { organizationMergeViews } from './merge/organization-merge-names.js';
import type { OrganizationMergeService } from './merge/organization-merge-service.js';
import { adminActorOf, organizationInReach } from './organization-reach.js';
import type { SalesRepAssignmentPort } from './services/sales-rep-assignment-service.js';

/**
 * The Organization merge's admin API (`specs/192-organization-merge/`
 * `contracts/organization-merge.md` §4, FR-050).
 *
 * `organizations:merge` gates every write and the list; the merge's detail is
 * a `customers:read` read. The actor must also reach **both** Organizations
 * under the one reach rule (`specs/175-sales-rep-reach-rule/`): an unreachable
 * one answers `404 NOT_FOUND`, indistinguishable from absence (FR-025), and a
 * merge one of whose Organizations the actor does not reach does not exist for
 * them. The permission is not granted to the predefined sales-representative
 * role (FR-050).
 */
export interface OrganizationMergeRoutesDeps {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly requireAdminAny: RequireAdminAnyFactory;
  readonly salesRepScope: Pick<SalesRepAssignmentPort, 'canSeeOrganization'>;
  readonly merges: () => OrganizationMergeService;
  /** Names beside the ids in every merge answered (`OrganizationMergeView`). */
  readonly organizationNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly adminNames: (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
}

function notFound(what = 'Organization'): HttpError {
  return new HttpError(404, ERROR_CODES.NOT_FOUND, `${what} not found.`);
}

export async function registerOrganizationMergeRoutes(
  app: FastifyInstance,
  deps: OrganizationMergeRoutesDeps,
): Promise<void> {
  const views = (records: readonly OrganizationMergeRecord[]): Promise<OrganizationMergeView[]> =>
    organizationMergeViews(records, { organizationNames: deps.organizationNames, adminNames: deps.adminNames });
  const view = async (record: OrganizationMergeRecord): Promise<OrganizationMergeView> => (await views([record]))[0]!;

  const survivorInReach = organizationInReach({ emFactory: deps.emFactory, salesRepScope: deps.salesRepScope, param: 'id' });
  const merge = deps.requireAdmin('organizations:merge');
  const customersRead = deps.requireAdminAny(['customers:read', 'customers:manage']);

  /** Does the actor reach this Organization (any state)? */
  const reaches = async (request: FastifyRequest, organizationId: string): Promise<boolean> => {
    if (orgConstraintFor().kind === 'all') return true;
    const actor = adminActorOf(request);
    return actor !== null && (await deps.salesRepScope.canSeeOrganization(actor.adminUserId, organizationId));
  };

  /** The loser named in a body: it exists and the actor reaches it, or 404 (FR-025). */
  const assertLoser = async (request: FastifyRequest, loserId: string): Promise<void> => {
    const exists = (await deps.emFactory().count(Organization, { id: loserId })) > 0;
    if (!exists || !(await reaches(request, loserId))) throw notFound();
  };

  /** A merge both of whose Organizations the actor reaches, or 404. */
  const reachableMerge = async (request: FastifyRequest, mergeId: string): Promise<OrganizationMergeRecord> => {
    if (!isUuidShape(mergeId)) throw notFound('Merge');
    const record = await deps.merges().get(mergeId);
    if (record === null || !(await reaches(request, record.survivorId)) || !(await reaches(request, record.loserId))) {
      throw notFound('Merge');
    }
    return record;
  };

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/merge-preview',
    { preHandler: [merge, survivorInReach], schema: { body: organizationMergePreviewBodySchema } },
    async (request): Promise<OrganizationMergePreviewResponse> => {
      const { loserId } = organizationMergePreviewBodySchema.parse(request.body);
      await assertLoser(request, loserId);
      return { data: await deps.merges().preview(request.params.id, loserId) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/merges',
    { preHandler: [merge, survivorInReach], schema: { body: organizationMergeStartBodySchema } },
    async (request, reply): Promise<OrganizationMergeRecordResponse> => {
      const body = organizationMergeStartBodySchema.parse(request.body);
      await assertLoser(request, body.loserId);
      const record = await deps.merges().start(request.params.id, {
        loserId: body.loserId,
        ...(body.fieldChoices ? { fieldChoices: body.fieldChoices } : {}),
        ...(body.customFieldChoices ? { customFieldChoices: body.customFieldChoices } : {}),
        ...(body.acknowledgeIrreversible !== undefined ? { acknowledgeIrreversible: body.acknowledgeIrreversible } : {}),
      });
      reply.status(202);
      return { data: await view(record) };
    },
  );

  app.get(
    '/api/v1/admin/organization-merges',
    { preHandler: [merge] },
    async (request): Promise<OrganizationMergeListResponse> => {
      const query = organizationMergeListQuerySchema.parse(request.query);
      const records = await deps.merges().list({
        ...(query.state !== undefined ? { state: query.state } : {}),
        ...(query.organizationId !== undefined ? { organizationId: query.organizationId } : {}),
      });
      const visible: OrganizationMergeRecord[] = [];
      for (const record of records) {
        if ((await reaches(request, record.survivorId)) && (await reaches(request, record.loserId))) visible.push(record);
      }
      return { data: await views(visible) };
    },
  );

  app.get<{ Params: { mergeId: string } }>(
    '/api/v1/admin/organization-merges/:mergeId',
    { preHandler: [customersRead] },
    async (request): Promise<OrganizationMergeRecordResponse> => ({
      data: await view(await reachableMerge(request, request.params.mergeId)),
    }),
  );

  app.post<{ Params: { mergeId: string } }>(
    '/api/v1/admin/organization-merges/:mergeId/resume',
    { preHandler: [merge], schema: { body: organizationMergeVersionBodySchema } },
    async (request): Promise<OrganizationMergeRecordResponse> => {
      const { expectedVersion } = organizationMergeVersionBodySchema.parse(request.body);
      await reachableMerge(request, request.params.mergeId);
      return { data: await view(await deps.merges().resume(request.params.mergeId, expectedVersion)) };
    },
  );

  app.post<{ Params: { mergeId: string } }>(
    '/api/v1/admin/organization-merges/:mergeId/cancel',
    { preHandler: [merge], schema: { body: organizationMergeVersionBodySchema } },
    async (request): Promise<OrganizationMergeRecordResponse> => {
      const { expectedVersion } = organizationMergeVersionBodySchema.parse(request.body);
      await reachableMerge(request, request.params.mergeId);
      return { data: await view(await deps.merges().cancel(request.params.mergeId, expectedVersion)) };
    },
  );
}
