import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  adjustCreditLimitRequestSchema,
  grantCreditLimitRequestSchema,
  type OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { isOrgInScope } from '@endora-commerce/platform/tenancy';
import type { CreditLimitService } from './services/credit-limit-service.js';
import type { CreditLimit } from './entities/credit-limit.entity.js';
import type { CreditLimitReservation } from './entities/credit-limit-reservation.entity.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

/**
 * `grantedByAdminUserId` is supplied by the host through `resolveAdminUserId`,
 * not read off the request here.
 *
 * This module used to import `testAdminUserId` from the host's
 * `test-actor-carrier.ts`, which `host-package.md` §1.4j classifies **A** —
 * host-internal, deliberately absent from `@endora-commerce/platform/http`'s
 * barrel, because it exists to narrow *this repository's* test-harness Fastify
 * augmentation and an installed package has no relationship to it. Packaging
 * this module is the first time that classification had to bite.
 *
 * The repair is not the carrier-declared-locally idiom §1.4n used for
 * `productAudienceOf`, because that would have preserved a live defect: nothing
 * under `src/` ever writes `request.testActor`, so a production grant recorded
 * **no** `grantedByAdminUserId` at all — the audit trail for a financial grant,
 * empty, with every harness test green because the harness mirrors its actor
 * onto both fields. The host now injects the resolver, so the production path
 * and the harness path read the same thing.
 */

export interface CreditLimitsDeps {
  creditLimitService: CreditLimitService;
  /**
   * `organizationDetailsPort`, owned by `organizations` — the roster's one
   * question about that table (feature 075, Phase C). It replaces an
   * `em.find(Organization, …)`, which linked this module against another
   * module's entity class at build time and kept answering with `organizations`
   * switched off. The port fails the request closed instead.
   */
  organizationDetailsPort: OrganizationDetailsPort;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /**
   * The acting admin's id, resolved from the request the guard in front of
   * these routes has already accepted.
   *
   * Injected rather than read here, because the read used to be
   * `testAdminUserId(request)` — `http/test-actor-carrier`, which
   * `contracts/host-package.md` §1.4j classifies **A**: the file exists to
   * narrow this repository's test-harness Fastify augmentation, and an
   * installed package has no relationship to that harness. It also answered
   * `undefined` in production for every request, because nothing under `src/`
   * writes `request.testActor`.
   *
   * Both composition roots supply it from `adminContextResolver`, which reads
   * the production actor and throws 401 for a non-admin. Every call site sits
   * behind `requireAdmin(...)`, so the actor is an admin by the time it runs.
   */
  resolveAdminUserId: (request: FastifyRequest) => string;
}

export async function registerCreditLimitsRoutes(
  app: FastifyInstance,
  deps: CreditLimitsDeps,
): Promise<void> {
  const {
    creditLimitService,
    organizationDetailsPort,
    requireCustomer,
    requireAdmin,
    resolveCustomerContext,
    resolveAdminUserId,
  } = deps;

  /** Resolve organization names for the given ids (read-only, missing ⇒ absent). */
  const loadOrgNames = async (ids: string[]): Promise<Map<string, string>> => {
    const unique = [...new Set(ids)].filter(Boolean);
    if (unique.length === 0) return new Map();
    const orgs = await organizationDetailsPort.findByIds(unique);
    return new Map(orgs.map((o) => [o.id, o.name]));
  };

  app.get(
    '/api/v1/me/credit-limit',
    { preHandler: requireCustomer },
    async (request) => {
      const ctx = resolveCustomerContext(request);
      const limit = await creditLimitService.getForOrganization(ctx.organizationId);
      if (!limit) {
        throw new HttpError(
          404,
          ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
          'Credit limit has not been granted for this organization.',
        );
      }
      const reservations = await creditLimitService.listActiveReservations(limit.id);
      return { data: serializeView(limit, reservations) };
    },
  );

  app.get(
    '/api/v1/admin/credit-limits',
    { preHandler: requireAdmin('credit_limits:manage') },
    async () => {
      const rows = await creditLimitService.listAll();
      const names = await loadOrgNames(rows.map((l) => l.organizationId));
      const data = await Promise.all(
        rows.map(async (l) => {
          const reservations = await creditLimitService.listActiveReservations(l.id);
          return serializeView(l, reservations, names.get(l.organizationId) ?? null);
        }),
      );
      return { data };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/credit-limit',
    {
      preHandler: requireAdmin('credit_limits:manage'),
      schema: { body: grantCreditLimitRequestSchema },
    },
    async (request, reply) => {
      const body = grantCreditLimitRequestSchema.parse(request.body);
      // Feature 050 — inserts are not reachable by the org column filter, so gate
      // the target org explicitly; out-of-scope responds as "not granted" (FR-008).
      if (!isOrgInScope(request.params.id)) {
        throw new HttpError(
          404,
          ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
          'Credit limit has not been granted for this organization.',
        );
      }
      const existing = await creditLimitService.getForOrganization(request.params.id);
      if (existing) {
        throw new HttpError(
          409,
          ERROR_CODES.CREDIT_LIMIT_ALREADY_GRANTED,
          'A credit limit is already granted; use PATCH to adjust it.',
        );
      }
      const limit = await creditLimitService.grant({
        organizationId: request.params.id,
        grantedAmount: body.grantedAmount,
        currency: body.currency,
        grantedByAdminUserId: resolveAdminUserId(request),
      });
      reply.status(201);
      const names = await loadOrgNames([request.params.id]);
      return { data: serializeView(limit, [], names.get(request.params.id) ?? null) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/credit-limit',
    { preHandler: requireAdmin('credit_limits:manage') },
    async (request) => {
      const limit = await creditLimitService.getForOrganization(request.params.id);
      if (!limit) {
        throw new HttpError(
          404,
          ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
          'Credit limit has not been granted for this organization.',
        );
      }
      const reservations = await creditLimitService.listActiveReservations(limit.id);
      const names = await loadOrgNames([request.params.id]);
      return { data: serializeView(limit, reservations, names.get(request.params.id) ?? null) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/credit-limit',
    {
      preHandler: requireAdmin('credit_limits:manage'),
      schema: { body: adjustCreditLimitRequestSchema },
    },
    async (request) => {
      const body = adjustCreditLimitRequestSchema.parse(request.body);
      // Feature 050 — gate the target org (see POST grant above).
      if (!isOrgInScope(request.params.id)) {
        throw new HttpError(
          404,
          ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
          'Credit limit has not been granted for this organization.',
        );
      }
      try {
        const result = await creditLimitService.adjust({
          organizationId: request.params.id,
          grantedAmount: body.grantedAmount,
          ...(body.allowOverAllocation !== undefined
            ? { allowOverAllocation: body.allowOverAllocation }
            : {}),
        });
        if (!result.ok) {
          throw new HttpError(
            409,
            ERROR_CODES.ADJUSTMENT_BELOW_ACTIVE,
            'Cannot reduce credit limit below the sum of active reservations.',
          );
        }
        const reservations = await creditLimitService.listActiveReservations(result.limit.id);
        const names = await loadOrgNames([request.params.id]);
        return { data: serializeView(result.limit, reservations, names.get(request.params.id) ?? null) };
      } catch (err) {
        if (err instanceof Error && err.message === 'CREDIT_LIMIT_NOT_GRANTED') {
          throw new HttpError(
            404,
            ERROR_CODES.CREDIT_LIMIT_NOT_GRANTED,
            'Credit limit has not been granted for this organization.',
          );
        }
        throw err;
      }
    },
  );
}

function serializeView(
  limit: CreditLimit,
  reservations: CreditLimitReservation[],
  organizationName?: string | null,
): Record<string, unknown> {
  const granted = Number(limit.grantedAmount);
  const reservedSum = reservations.reduce((acc, r) => acc + Number(r.amount), 0);
  return {
    organizationId: limit.organizationId,
    organizationName: organizationName ?? null,
    grantedAmount: granted,
    availableAmount: granted - reservedSum,
    currency: limit.currency,
    activeReservations: reservations.map((r) => ({
      orderId: r.orderId,
      amount: Number(r.amount),
      createdAt: r.createdAt.toISOString(),
    })),
    grantedAt: limit.createdAt.toISOString(),
  };
}
