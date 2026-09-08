import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import {
  ERROR_CODES,
  INVOICE_LEDGER_READ_PERMISSION,
  INVOICE_LEDGER_WRITE_PERMISSION,
  invoiceLedgerRoutingWriteBodySchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { InvoiceLedgerRoutingWriteService } from './services/invoice-ledger-routing-write.service.js';

export interface InvoiceLedgerAdminRoutesDeps {
  requireAdmin: RequireAdminFactory;
  routingWrite: InvoiceLedgerRoutingWriteService;
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

  app.get('/api/v1/admin/invoice-ledger/deliveries', read, async (_request, reply) => {
    return reply.send({ data: [] });
  });
}
