import type { FastifyInstance } from 'fastify';
import { receivePaymentSchema } from '@b2b/contracts';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';
import type { ReceivePaymentHandler } from './services/receive-payment-handler.js';
import type { PaymentService } from './services/payment-service.js';

/**
 * Payments routes (feature 034).
 *
 *   POST /api/v1/payments/receive            — receive_payment ingress (FR-022)
 *   POST /api/v1/admin/orders/:id/payments/retry — open a retry Payment (FR-024)
 *   GET  /api/v1/admin/orders/:id/payments   — full payment history (FR-026)
 *
 * The ingress is admin-guarded for the MVP; a signed PSP-webhook auth path is a
 * follow-up (the offline reference adapters are settled by an admin anyway).
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
      preHandler: deps.requireAdmin('catalog:write'),
      schema: { body: receivePaymentSchema },
    },
    async (request) => {
      const body = receivePaymentSchema.parse(request.body);
      const result = await deps.receiveHandler.receive(body);
      return { data: result };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/payments/retry',
    { preHandler: deps.requireAdmin('catalog:write') },
    async (request, reply) => {
      const payment = await deps.paymentService.openRetry(request.params.id);
      reply.status(201);
      return { data: serializePayment(payment) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/payments',
    { preHandler: deps.requireAdmin('catalog:read') },
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
