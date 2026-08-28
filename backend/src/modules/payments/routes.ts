import type { FastifyInstance } from 'fastify';
import { receivePaymentRequestSchema } from '@endora-commerce/contracts';
import type { ReceivePaymentHandler } from './services/receive-payment-handler.js';
import type { PaymentService } from './services/payment-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Payments routes (feature 034).
 *
 *   POST /api/v1/payments/receive            — receive_payment ingress (FR-022)
 *   POST /api/v1/admin/orders/:id/payments/retry — open a retry Payment (FR-024)
 *   GET  /api/v1/admin/orders/:id/payments   — full payment history (FR-026)
 *
 * The buyer's own retry is a separate file (`routes.customer.ts`, issue #264):
 * it authorises differently, guards the Organization's ability to transact, and
 * starts the gateway session this one deliberately does not.
 *
 * The ingress is admin-guarded for the MVP; a signed PSP-webhook auth path is a
 * follow-up (the offline reference adapters are settled by an admin anyway).
 *
 * All three gate on this module's own codes. They used to gate on `catalog:read`
 * and `catalog:write`, which meant an operator who could edit a product could
 * read every payment's provider payload and declare an arbitrary payment
 * settled. The reasoning for the pair, and for there being no third code for the
 * ingress, is in `manifest.ts` beside the declaration.
 *
 * The ingress body is `receivePaymentRequestSchema` rather than
 * `receivePaymentSchema`: the two differ only in `providerDetails`, which is
 * bounded for the operator-supplied path and left open for the gateway modules
 * that build the payload in code.
 */
export interface PaymentsRoutesDeps {
  requireAdmin: RequireAdminFactory;
  receiveHandler: ReceivePaymentHandler;
  paymentService: PaymentService;
}

export async function registerPaymentsRoutes(
  app: FastifyInstance,
  deps: PaymentsRoutesDeps,
): Promise<void> {
  app.post(
    '/api/v1/payments/receive',
    {
      preHandler: deps.requireAdmin('payments:write'),
      schema: { body: receivePaymentRequestSchema },
    },
    async (request) => {
      const body = receivePaymentRequestSchema.parse(request.body);
      const result = await deps.receiveHandler.receive(body);
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/payments/retry',
    { preHandler: deps.requireAdmin('payments:write') },
    async (request, reply) => {
      // `opened` is discarded here on purpose: the operator asked for the next
      // attempt and gets it, whether it had to be created or was already open.
      // The buyer-facing twin routes on that difference — see
      // `routes.customer.ts` — because only it starts a provider session.
      const { payment } = await deps.paymentService.openRetry(request.params.id);
      reply.status(201);
      return { data: serializePayment(payment) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/payments',
    { preHandler: deps.requireAdmin('payments:read') },
    async (request) => {
      const payments = await deps.paymentService.listForOrder(request.params.id);
      return { data: payments.map(serializePayment) };
    },
  );
}

function serializePayment(p: {
  id: string;
  orderId: string;
  paymentMethodId: string;
  status: string;
  amount: string;
  refundedAmount?: string;
  currency: string;
  paidAt?: Date | null;
  externalReference?: string | null;
  providerDetails?: Record<string, unknown> | null;
  failureReason?: string | null;
  attemptNo: number;
  updatedAt?: Date | null;
}) {
  return {
    id: p.id,
    orderId: p.orderId,
    paymentMethodId: p.paymentMethodId,
    status: p.status,
    amount: Number(p.amount),
    refundedAmount: Number(p.refundedAmount ?? '0'),
    refundedAt: (p.providerDetails?.['refundedAt'] as string | undefined) ?? null,
    refundReference: (p.providerDetails?.['refundReference'] as string | undefined) ?? null,
    updatedAt: p.updatedAt ? p.updatedAt.toISOString() : null,
    currency: p.currency,
    paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    externalReference: p.externalReference ?? null,
    providerDetails: p.providerDetails ?? null,
    failureReason: p.failureReason ?? null,
    attemptNo: p.attemptNo,
  };
}
