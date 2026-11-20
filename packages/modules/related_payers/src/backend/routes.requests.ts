import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  createRelatedPayerRequestBodySchema,
  organizationPermissionPreHandler,
  rejectRelatedPayerRequestBodySchema,
  type CustomerRelatedPayerLink,
  type OrganizationPermissionGuardRequest,
  type OrganizationPermissionPort,
  type RelatedPayerRequestDirection,
  type RelatedPayersAvailabilityResponse,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import type { RelatedPayerLink } from './entities/related-payer-link.entity.js';
import type { RelatedPayerRequestService } from './services/request-service.js';
import type { LinkReadService } from './services/link-service.js';
import type { LinkWriteService } from './services/link-write-service.js';
import type { RelatedPayerInvitationDelivery } from './services/invitation-delivery.js';

export interface RequestRoutesDeps {
  readonly requireCustomer: (request: FastifyRequest, reply: unknown) => Promise<void>;
  readonly customerContextResolver: (request: FastifyRequest) => { customerAccountId: string; organizationId: string };
  readonly permissions: () => OrganizationPermissionPort;
  readonly requests: () => RelatedPayerRequestService;
  readonly reads: () => LinkReadService;
  readonly writes: () => LinkWriteService;
  /** The capability on the request's channel (FR-002): off, every route answers not found. */
  readonly channelEnabled: (salesChannelId: string) => Promise<boolean>;
  /** US6 — `related_payers.payer_may_invite_buyers` on the request's channel: off, the invitation routes answer not found. */
  readonly payerMayInviteBuyers: (salesChannelId: string) => Promise<boolean>;
  readonly invitations: () => RelatedPayerInvitationDelivery;
}

const NOT_FOUND = () => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Not found.');

/**
 * `specs/182-related-payers/` T080 (contracts/storefront-api.md) — the customer's side of payer
 * requests and links: X asks (`manage`), Y decides (`approve`), either side revokes (FR-050).
 * The request reply is one `202` whatever the tax ID found (FR-041); the daily limit answers
 * first (FR-046).
 */
export async function registerRelatedPayersRequestRoutes(app: FastifyInstance, deps: RequestRoutesDeps): Promise<void> {
  // The codes are named at the guard, where the permission inventory reads them.
  const managesPayers = [deps.requireCustomer, organizationPermissionPreHandler(deps.permissions, 'related_payers.manage')];
  const approvesGuard = organizationPermissionPreHandler(deps.permissions, 'related_payers.approve');
  const approvesPayers = [deps.requireCustomer, approvesGuard];
  const ordersWithPayer = organizationPermissionPreHandler(deps.permissions, 'related_payers.order_with_payer');
  /** FR-047 — X's payer list: who manages payers, or who may order with one. */
  const readsPayers = [
    deps.requireCustomer,
    async (request: FastifyRequest) => {
      const { actor: who } = request as unknown as OrganizationPermissionGuardRequest;
      if (who.kind === 'customer') {
        const subject = {
          customerAccountId: who.customerAccountId,
          organizationId: who.organizationId ?? '',
          organizationRoleId: who.organizationRoleId ?? null,
        };
        if (await deps.permissions().can(subject, 'related_payers.manage')) return;
      }
      await ordersWithPayer(request as unknown as OrganizationPermissionGuardRequest);
    },
  ];
  /**
   * FR-042, US6 — the requests awaiting this Organization: a request to pay is decided by who
   * approves payer requests, an invitation from a payer by who manages payers. The route admits
   * either; the directions the member may decide are answered per request.
   */
  const decidable = async (request: FastifyRequest): Promise<RelatedPayerRequestDirection[]> => {
    const { actor: who } = request as unknown as OrganizationPermissionGuardRequest;
    if (who.kind !== 'customer') return [];
    const subject = {
      customerAccountId: who.customerAccountId,
      organizationId: who.organizationId ?? '',
      organizationRoleId: who.organizationRoleId ?? null,
    };
    const [approves, manages] = await Promise.all([
      deps.permissions().can(subject, 'related_payers.approve'),
      deps.permissions().can(subject, 'related_payers.manage'),
    ]);
    return [...(approves ? (['buyer_request'] as const) : []), ...(manages ? (['payer_invitation'] as const) : [])];
  };
  const decidesRequests = [
    deps.requireCustomer,
    async (request: FastifyRequest) => {
      if ((await decidable(request)).length > 0) return;
      // Neither: the refusal the approving guard answers.
      await approvesGuard(request as unknown as OrganizationPermissionGuardRequest);
    },
  ];
  /** The customer's view of a link: the other side named, terms shown and never writable (FR-119). */
  const customerLinks = async (links: RelatedPayerLink[], side: 'payer' | 'buyer'): Promise<CustomerRelatedPayerLink[]> =>
    (await deps.reads().toDtos(links)).map((l) => ({
      id: l.id,
      organizationId: side === 'payer' ? l.payerOrganizationId : l.buyerOrganizationId,
      name: side === 'payer' ? l.payerName : l.buyerName,
      // RP-20 (d) — each side reads the other's tax ID.
      taxId: side === 'payer' ? l.payerTaxId : l.buyerTaxId,
      state: l.state,
      addressScope: l.addressScope,
      billingAddressId: l.billingAddressId,
      validFrom: l.validFrom,
      validTo: l.validTo,
      commercialTerms: l.commercialTerms,
    }));
  const actor = async (request: FastifyRequest) => {
    const channel = getResolvedChannel(request);
    if (!(await deps.channelEnabled(channel.id))) throw NOT_FOUND();
    return { ...deps.customerContextResolver(request), salesChannelId: channel.id };
  };
  const idOf = (request: FastifyRequest, key = 'id') => (request.params as Record<string, string>)[key]!;

  /**
   * FR-002 — whether the capability is on for the request's channel, so the storefront offers
   * *Payers* and *Orders we pay for* only where the routes below answer. Any signed-in customer:
   * the answer is the channel's, not the member's. Not cached, as the operator's switch must
   * reach the next render.
   */
  app.get('/api/v1/related-payers/availability', { preHandler: deps.requireCustomer }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const body: RelatedPayersAvailabilityResponse = {
      data: { enabled: await deps.channelEnabled(getResolvedChannel(request).id) },
    };
    return body;
  });

  app.get('/api/v1/account/related-payers', { preHandler: readsPayers }, async (request) => {
    const who = await actor(request);
    return { data: await customerLinks(await deps.reads().listAsBuyer(who.organizationId), 'payer') };
  });

  app.get('/api/v1/account/payees', { preHandler: approvesPayers }, async (request) => {
    const who = await actor(request);
    return { data: await customerLinks(await deps.reads().listAsPayer(who.organizationId), 'buyer') };
  });

  app.post(
    '/api/v1/account/related-payers/requests',
    { preHandler: managesPayers, schema: { body: createRelatedPayerRequestBodySchema } },
    async (request, reply) => {
      const who = await actor(request);
      const body = createRelatedPayerRequestBodySchema.parse(request.body);
      const created = await deps.requests().create(
        { ...who, language: await request.responseLanguage() },
        body,
        'buyer_request',
      );
      reply.status(202);
      return { data: created };
    },
  );

  app.get('/api/v1/account/related-payers/requests', { preHandler: managesPayers }, async (request) => {
    const who = await actor(request);
    return { data: await deps.requests().listSent(who.organizationId, 'buyer_request') };
  });

  app.post('/api/v1/account/related-payers/requests/:id/withdraw', { preHandler: managesPayers }, async (request) => {
    const who = await actor(request);
    await deps.requests().withdraw(who.organizationId, who.customerAccountId, idOf(request), 'buyer_request');
    return { data: { id: idOf(request), state: 'withdrawn' } };
  });

  app.get('/api/v1/account/related-payers/incoming', { preHandler: decidesRequests }, async (request) => {
    const who = await actor(request);
    return { data: await deps.requests().listIncoming(who.organizationId, await decidable(request)) };
  });

  app.post('/api/v1/account/related-payers/incoming/:id/accept', { preHandler: decidesRequests }, async (request) => {
    const who = await actor(request);
    await deps.requests().acceptIncoming(who.organizationId, who.customerAccountId, idOf(request), await decidable(request));
    return { data: { id: idOf(request) } };
  });

  app.post(
    '/api/v1/account/related-payers/incoming/:id/reject',
    { preHandler: decidesRequests, schema: { body: rejectRelatedPayerRequestBodySchema } },
    async (request) => {
      const who = await actor(request);
      const body = rejectRelatedPayerRequestBodySchema.parse(request.body ?? {});
      await deps
        .requests()
        .rejectIncoming(who.organizationId, who.customerAccountId, idOf(request), body.reason ?? null, await decidable(request));
      return { data: { id: idOf(request), state: 'rejected' } };
    },
  );

  // US6 (FR-040, T091) — a payer invites a buyer: the request route's one reply (FR-041), the
  // daily limit shared with requests (FR-046), behind `payer_may_invite_buyers` on the channel.
  const inviter = async (request: FastifyRequest) => {
    const who = await actor(request);
    if (!(await deps.payerMayInviteBuyers(who.salesChannelId))) throw NOT_FOUND();
    return who;
  };

  app.post(
    '/api/v1/account/payees/invitations',
    { preHandler: approvesPayers, schema: { body: createRelatedPayerRequestBodySchema } },
    async (request, reply) => {
      const who = await inviter(request);
      const body = createRelatedPayerRequestBodySchema.parse(request.body);
      const created = await deps.requests().create(
        { ...who, language: await request.responseLanguage() },
        body,
        'payer_invitation',
      );
      reply.status(202);
      return { data: created };
    },
  );

  // FR-045 — the payer withdraws an invitation it sent while it is pending. Not behind the
  // channel setting: an invitation sent before it was switched off can still be taken back.
  app.post('/api/v1/account/payees/invitations/:id/withdraw', { preHandler: approvesPayers }, async (request) => {
    const who = await actor(request);
    await deps.requests().withdraw(who.organizationId, who.customerAccountId, idOf(request), 'payer_invitation');
    return { data: { id: idOf(request), state: 'withdrawn' } };
  });

  app.get('/api/v1/account/payees/invitations', { preHandler: approvesPayers }, async (request) => {
    const who = await inviter(request);
    return { data: await deps.requests().listSent(who.organizationId, 'payer_invitation') };
  });

  // FR-044, T092 — anonymous: the registration form pre-fills the tax ID an invitation names.
  app.get('/api/v1/related-payers/invitations/:token', async (request) => {
    const token = idOf(request, 'token');
    const found = await withSystemScope('related_payers: the tax ID an invitation to register names', () =>
      deps.invitations().lookup(token),
    );
    if (!found) throw NOT_FOUND();
    return { data: found };
  });

  // FR-050 — X revokes a payer link; Y revokes a link where it pays. Not ours ⇒ 404.
  app.post('/api/v1/account/related-payers/:linkId/revoke', { preHandler: managesPayers }, async (request) => {
    const who = await actor(request);
    const linkId = idOf(request, 'linkId');
    const mine = (await deps.reads().listAsBuyer(who.organizationId)).some((l) => l.id === linkId);
    if (!mine) throw NOT_FOUND();
    await deps.writes().revoke(linkId, { revokedByKind: 'buyer', revokedById: who.customerAccountId });
    return { data: { id: linkId, state: 'revoked' } };
  });

  app.post('/api/v1/account/payees/:linkId/revoke', { preHandler: approvesPayers }, async (request) => {
    const who = await actor(request);
    const linkId = idOf(request, 'linkId');
    if (!(await deps.reads().findAsPayer(who.organizationId, linkId))) throw NOT_FOUND();
    // The link is the buyer's row: the payer reaches it only this way, constrained above to a
    // link naming the payer asking (research R-5).
    await withSystemScope('related_payers: the payer revokes a link naming it', () =>
      deps.writes().revoke(linkId, { revokedByKind: 'payer', revokedById: who.customerAccountId }),
    );
    return { data: { id: linkId, state: 'revoked' } };
  });
}
