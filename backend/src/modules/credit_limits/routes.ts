import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  adjustCreditLimitRequestSchema,
  grantCreditLimitRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { CreditLimitService } from './services/credit-limit-service.js';
import type { CreditLimit } from './entities/credit-limit.entity.js';
import type { CreditLimitReservation } from './entities/credit-limit-reservation.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface CreditLimitsDeps {
  creditLimitService: CreditLimitService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
}

export async function registerCreditLimitsRoutes(
  app: FastifyInstance,
  deps: CreditLimitsDeps,
): Promise<void> {
  const { creditLimitService, requireCustomer, requireAdmin, resolveCustomerContext } = deps;

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

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/credit-limit',
    {
      preHandler: requireAdmin('credit_limits:manage'),
      schema: { body: grantCreditLimitRequestSchema },
    },
    async (request, reply) => {
      const body = grantCreditLimitRequestSchema.parse(request.body);
      const existing = await creditLimitService.getForOrganization(request.params.id);
      if (existing) {
        throw new HttpError(
          409,
          ERROR_CODES.CREDIT_LIMIT_ALREADY_GRANTED,
          'A credit limit is already granted; use PATCH to adjust it.',
        );
      }
      const adminId = (request.testActor?.kind === 'admin'
        ? request.testActor.adminUserId
        : undefined) as string | undefined;
      const limit = await creditLimitService.grant({
        organizationId: request.params.id,
        grantedAmount: body.grantedAmount,
        currency: body.currency,
        ...(adminId !== undefined ? { grantedByAdminUserId: adminId } : {}),
      });
      reply.status(201);
      return { data: serializeView(limit, []) };
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
      return { data: serializeView(limit, reservations) };
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
        return { data: serializeView(result.limit, reservations) };
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
): Record<string, unknown> {
  const granted = Number(limit.grantedAmount);
  const reservedSum = reservations.reduce((acc, r) => acc + Number(r.amount), 0);
  return {
    organizationId: limit.organizationId,
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
