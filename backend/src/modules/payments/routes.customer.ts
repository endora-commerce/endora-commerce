import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ERROR_CODES, OrganizationCannotTransactError } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { PaymentRetryService } from './services/payment-retry-service.js';

/**
 * The buyer's own payment surface (issue #264).
 *
 *   POST /api/v1/orders/:orderId/payments/retry — pay an unpaid order again
 *
 * It sits in this module rather than in `orders` because the attempt row and
 * the adapter dispatch are this module's, and because `payments` already
 * declares `orders` — the reverse edge would close a cycle. It is the customer
 * twin of `POST /api/v1/admin/orders/:id/payments/retry`, and both run through
 * the same `PaymentService.openRetry`.
 */
export interface PaymentsCustomerRoutesDeps {
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerAccountId: (req: FastifyRequest) => string;
  retryService: PaymentRetryService;
}

export async function registerPaymentsCustomerRoutes(
  app: FastifyInstance,
  deps: PaymentsCustomerRoutesDeps,
): Promise<void> {
  app.post<{ Params: { orderId: string } }>(
    '/api/v1/orders/:orderId/payments/retry',
    { preHandler: deps.requireCustomer },
    async (request, reply) => {
      const callerId = deps.resolveCustomerAccountId(request);
      try {
        const result = await deps.retryService.retryForCustomer({
          orderId: request.params.orderId,
          customerAccountId: callerId,
        });
        return reply.send({ data: result });
      } catch (err) {
        // The same mapping placement uses for the same refusal, so a buyer of a
        // suspended Organization is told the same thing whether they are
        // placing an order or paying one.
        if (err instanceof OrganizationCannotTransactError) {
          throw new HttpError(
            423,
            ERROR_CODES.FORBIDDEN,
            'Your Organization cannot transact in its current status.',
            { code: 'organization_cannot_transact', status: err.status },
          );
        }
        throw err;
      }
    },
  );
}
