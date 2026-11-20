import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  adminAddRelatedPayerBodySchema,
  adminCreatePayerOrganizationBodySchema,
  adminUpdateRelatedPayerLinkBodySchema,
  isUuidShape,
  type OrganizationDetailsPort,
  type OrganizationWritePort,
  type RelatedPayerLink as RelatedPayerLinkDto,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { orgInScope } from '@endora-commerce/platform/tenancy';
import type { RelatedPayerLink } from './entities/related-payer-link.entity.js';
import type { LinkReadService } from './services/link-service.js';
import type { LinkWriteService } from './services/link-write-service.js';

export interface RelatedPayersAdminRouteDeps {
  readonly requireAdmin: RequireAdminFactory;
  readonly reads: LinkReadService;
  readonly writes: LinkWriteService;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  readonly organizationWrites: Pick<OrganizationWritePort, 'create'>;
  readonly resolveAdminUserId: (request: FastifyRequest) => string;
}

const NOT_FOUND = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
const LINK_NOT_FOUND = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payer link not found.');

/**
 * The version a client last read, from `If-Match: "<version>"`; `undefined` when it sent
 * none or `*`. A header that is there and cannot be read is 400 — taking it for "no
 * precondition" would turn a guarded write into an unguarded one (the CRM precedent).
 */
function expectedVersionOf(request: FastifyRequest): number | undefined {
  const header = request.headers['if-match'];
  if (header === undefined) return undefined;
  const value = typeof header === 'string' ? header.trim() : '';
  if (value === '*') return undefined;
  const match = /^(?:"(\d{1,9})"|(\d{1,9}))$/.exec(value);
  if (!match) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'If-Match must carry the version last read, as in the ETag: "3".');
  }
  return Number(match[1] ?? match[2]);
}

/**
 * The operator surface of payer links (`contracts/admin-api.md`, FR-020 – FR-022).
 *
 * Reach: a scoped administrator reaches a link through its **buyer** (the link's tenant),
 * and a payer-side list through the payer it is asked for. Out of reach answers the same
 * `404` as a missing Organization or link. Mounted through `ctx.routes`, so the module's
 * presence gates every route.
 */
export async function registerRelatedPayersAdminRoutes(
  app: FastifyInstance,
  deps: RelatedPayersAdminRouteDeps,
): Promise<void> {
  const { requireAdmin, reads, writes } = deps;

  async function organizationInReach(id: string): Promise<void> {
    if (!isUuidShape(id) || !(await orgInScope(id))) throw NOT_FOUND();
    const org = await deps.organizations.findById(id);
    if (!org || org.deletedAt) throw NOT_FOUND();
  }

  /** The link, in reach through its buyer — the ambient tenant filter decides. */
  async function linkInReach(linkId: string): Promise<RelatedPayerLink> {
    const link = isUuidShape(linkId) ? await writes.find(linkId) : null;
    if (!link) throw LINK_NOT_FOUND();
    return link;
  }

  async function one(link: RelatedPayerLink): Promise<{ data: RelatedPayerLinkDto }> {
    const [dto] = await reads.toDtos([link]);
    return { data: dto! };
  }

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/related-payers',
    { preHandler: requireAdmin('related_payers:read') },
    async (request) => {
      await organizationInReach(request.params.id);
      const [asBuyer, asPayer] = await Promise.all([
        reads.listAsBuyer(request.params.id),
        reads.listAsPayer(request.params.id),
      ]);
      return { data: { asBuyer: await reads.toDtos(asBuyer), asPayer: await reads.toDtos(asPayer) } };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/related-payers',
    { preHandler: requireAdmin('related_payers:manage'), schema: { body: adminAddRelatedPayerBodySchema } },
    async (request, reply) => {
      const body = adminAddRelatedPayerBodySchema.parse(request.body);
      await organizationInReach(request.params.id);
      // The payer is named by the operator: it has to be in reach too, or the route
      // would tell a scoped administrator which ids exist outside it.
      await organizationInReach(body.payerOrganizationId);
      const { link } = await writes.create({
        buyerOrganizationId: request.params.id,
        payerOrganizationId: body.payerOrganizationId,
        addressScope: body.addressScope,
        validFrom: body.validFrom ?? null,
        validTo: body.validTo ?? null,
        commercialTerms: body.commercialTerms,
        notifyPayerOnOrders: body.notifyPayerOnOrders,
        origin: 'operator',
        actorKind: 'operator',
      });
      reply.status(201);
      return one(link);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/related-payers/new-organization',
    {
      // Creating the payer is the organization create, whose own gate is
      // `customers:manage` (`POST /api/v1/admin/organizations`); both are required.
      preHandler: [requireAdmin('related_payers:manage'), requireAdmin('customers:manage')],
      schema: { body: adminCreatePayerOrganizationBodySchema },
    },
    async (request, reply) => {
      const body = adminCreatePayerOrganizationBodySchema.parse(request.body);
      await organizationInReach(request.params.id);
      const [first, ...rest] = body.organization.salesChannelIds;
      const created = await deps.organizationWrites.create({
        name: body.organization.name,
        taxId: body.organization.taxId,
        registeredAddress: body.organization.registeredAddress,
        salesChannelIds: [first!, ...rest],
        status: 'active',
        ...(body.organization.vatStatus ? { vatStatus: body.organization.vatStatus } : {}),
      });
      const { link } = await writes.create({
        buyerOrganizationId: request.params.id,
        payerOrganizationId: created.id,
        addressScope: { kind: 'all' },
        validFrom: body.link.validFrom ?? null,
        validTo: body.link.validTo ?? null,
        commercialTerms: body.link.commercialTerms,
        notifyPayerOnOrders: body.link.notifyPayerOnOrders,
        origin: 'operator',
        actorKind: 'operator',
      });
      reply.status(201);
      const [dto] = await reads.toDtos([link]);
      return { data: { organizationId: created.id, link: dto! } };
    },
  );

  app.patch<{ Params: { linkId: string } }>(
    '/api/v1/admin/related-payers/links/:linkId',
    { preHandler: requireAdmin('related_payers:manage'), schema: { body: adminUpdateRelatedPayerLinkBodySchema } },
    async (request, reply) => {
      const body = adminUpdateRelatedPayerLinkBodySchema.parse(request.body);
      const expectedVersion = expectedVersionOf(request);
      let link = await linkInReach(request.params.linkId);
      const { state, ...terms } = body;
      const hasTerms = Object.values(terms).some((value) => value !== undefined);
      if (hasTerms) {
        link = await writes.update(link.id, terms, { expectedVersion, actorKind: 'operator' });
      }
      if (state !== undefined && state !== link.state) {
        link = await writes.setState(link.id, state, {
          expectedVersion: hasTerms ? link.version : expectedVersion,
          actorKind: 'operator',
        });
      }
      reply.header('etag', `"${link.version}"`);
      return one(link);
    },
  );

  app.post<{ Params: { linkId: string } }>(
    '/api/v1/admin/related-payers/links/:linkId/revoke',
    { preHandler: requireAdmin('related_payers:manage') },
    async (request) => {
      const link = await linkInReach(request.params.linkId);
      const revoked = await writes.revoke(link.id, {
        revokedByKind: 'operator',
        revokedById: deps.resolveAdminUserId(request),
        expectedVersion: expectedVersionOf(request),
      });
      return one(revoked);
    },
  );
}
