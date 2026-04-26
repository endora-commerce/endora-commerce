import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Invoice } from './entities/invoice.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Admin invoice listing (T162). Read-only — generation happens
 * downstream of order placement; here the admin browses and links to
 * the existing per-order PDF download (`/api/v1/orders/:id/invoice`).
 *
 * Filters: by status (pending / ready / cancelled), by orderId. Default
 * order is most-recent first.
 */
export interface InvoicesAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

export async function registerInvoicesAdminRoutes(
  app: FastifyInstance,
  deps: InvoicesAdminDeps,
): Promise<void> {
  app.get(
    '/api/v1/admin/invoices',
    { preHandler: deps.requireAdmin('orders:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const where: Record<string, unknown> = {};
      if (q['filter[status]']) where['status'] = q['filter[status]'];
      if (q['filter[orderId]']) where['orderId'] = q['filter[orderId]'];
      const limit = Math.min(Math.max(Number.parseInt(q['limit'] ?? '50', 10), 1), 200);
      const em = deps.emFactory();
      const rows = await em.find(Invoice, where, {
        orderBy: { issuedAt: 'desc' },
        limit,
      });
      return {
        data: rows.map(serialize),
        pagination: { cursor: null, hasMore: false, limit: rows.length },
      };
    },
  );
}

function serialize(i: Invoice) {
  return {
    id: i.id,
    orderId: i.orderId,
    kind: i.kind,
    number: i.number,
    issuedAt: i.issuedAt.toISOString(),
    currency: i.currency,
    total: Number(i.total),
    status: i.status,
    pdfReady: i.status === 'ready',
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  };
}
