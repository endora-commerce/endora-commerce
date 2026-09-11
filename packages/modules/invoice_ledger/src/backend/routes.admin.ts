import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  ERROR_CODES,
  INVOICE_LEDGER_READ_PERMISSION,
  INVOICE_LEDGER_WRITE_PERMISSION,
  invoiceLedgerDeliveryListQuerySchema,
  invoiceLedgerRoutingWriteBodySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { InvoiceLedgerDeliveryAdminService } from './services/invoice-ledger-delivery-admin.service.js';
import type { InvoiceLedgerRoutingWriteService } from './services/invoice-ledger-routing-write.service.js';

export interface InvoiceLedgerAdminRoutesDeps {
  requireAdmin: RequireAdminFactory;
  routingWrite: InvoiceLedgerRoutingWriteService;
  deliveries: InvoiceLedgerDeliveryAdminService;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.map(String).join('.') || 'body';
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `${path}: ${issue?.message ?? 'invalid'}`, {
      field: path,
    });
  }
  return parsed.data;
}

export async function registerInvoiceLedgerAdminRoutes(
  app: FastifyInstance,
  deps: InvoiceLedgerAdminRoutesDeps,
): Promise<void> {
  const read = { preHandler: deps.requireAdmin(INVOICE_LEDGER_READ_PERMISSION) };
  const write = { preHandler: deps.requireAdmin(INVOICE_LEDGER_WRITE_PERMISSION) };

  app.get('/api/v1/admin/invoice-ledger/routing', read, async (_request, reply) => {
    return reply.send({ data: await deps.routingWrite.view() });
  });

  app.put('/api/v1/admin/invoice-ledger/routing', write, async (request, reply) => {
    const body = parseOrThrow(invoiceLedgerRoutingWriteBodySchema, request.body ?? {});
    return reply.send({ data: await deps.routingWrite.write(body) });
  });

  app.get('/api/v1/admin/invoice-ledger/deliveries', read, async (request, reply) => {
    const query = parseOrThrow(invoiceLedgerDeliveryListQuerySchema, request.query ?? {});
    return reply.send(await deps.deliveries.list(query));
  });

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/invoice-ledger/deliveries/:id/retry',
    write,
    async (request, reply) => {
      const id = request.params.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery not found.');
      }
      return reply.send({ data: await deps.deliveries.retry(id) });
    },
  );
}
