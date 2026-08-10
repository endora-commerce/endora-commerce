import type { FastifyInstance } from 'fastify';
import { receiveShipmentSchema } from '@b2b/contracts';
import type { Shipment } from './entities/shipment.entity.js';
import type { ReceiveShipmentHandler } from './services/receive-shipment-handler.js';
import type { ShipmentService } from './services/shipment-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Shipments routes (feature 035).
 *
 *   POST /api/v1/admin/orders/:id/shipments        — shipment_created (FR-021)
 *   GET  /api/v1/admin/orders/:id/shipments        — full shipment history (FR-026)
 *   POST /api/v1/admin/orders/:id/shipments/retry  — open a retry Shipment (FR-024)
 *   POST /api/v1/shipments/receive                 — receive_shipment ingress (FR-022)
 *
 * The ingress is admin-guarded for the MVP; a signed carrier-webhook auth path
 * is a follow-up (the offline reference adapters are settled by an admin anyway).
 */
export interface ShipmentsRoutesDeps {
  requireAdmin: RequireAdminFactory;
  receiveHandler: ReceiveShipmentHandler;
  shipmentService: ShipmentService;
}

export async function registerShipmentsRoutes(
  app: FastifyInstance,
  deps: ShipmentsRoutesDeps,
): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/shipments',
    { preHandler: deps.requireAdmin('orders:write') },
    async (request, reply) => {
      const shipment = await deps.shipmentService.createShipment(request.params.id);
      reply.status(201);
      return { data: serializeShipment(shipment) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/shipments',
    { preHandler: deps.requireAdmin('orders:read') },
    async (request) => {
      const shipments = await deps.shipmentService.listForOrder(request.params.id);
      return { data: shipments.map(serializeShipment) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/orders/:id/shipments/retry',
    { preHandler: deps.requireAdmin('orders:write') },
    async (request, reply) => {
      const shipment = await deps.shipmentService.openRetry(request.params.id);
      reply.status(201);
      return { data: serializeShipment(shipment) };
    },
  );

  app.post(
    '/api/v1/shipments/receive',
    {
      preHandler: deps.requireAdmin('orders:write'),
      schema: { body: receiveShipmentSchema },
    },
    async (request) => {
      const body = receiveShipmentSchema.parse(request.body);
      const result = await deps.receiveHandler.receive(body);
      return { data: result };
    },
  );
}

function serializeShipment(s: Shipment) {
  return {
    id: s.id,
    orderId: s.orderId,
    deliveryMethodId: s.deliveryMethodId,
    status: s.status,
    externalReference: s.externalReference ?? null,
    providerDetails: s.providerDetails ?? null,
    failureReason: s.failureReason ?? null,
    attemptNo: s.attemptNo,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}
