import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLogFacetsSchema } from '@endora-commerce/contracts';
import type { AuditLogEntry, AuditLogFilter, AuditPort, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { registerAuditLogAdminRoutes } from './routes.admin.js';

/**
 * Issue #1555 (UX audit SHELL-20) — the audit log screen fetched one page and
 * offered no way past it, and asked for action and object-type codes it could
 * have listed. The list now answers a cursor while more entries exist, and
 * `/facets` lists what the filters can offer.
 */

function entry(n: number): AuditLogEntry {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    actorCustomerAccountId: null,
    actedAt: new Date(Date.UTC(2026, 10, 20, 10, 0, 60 - n)),
    action: 'product.update',
    objectType: 'product',
    objectId: `p-${n}`,
    stateBefore: null,
    stateAfter: null,
    ipAddress: null,
    userAgent: null,
    requestId: null,
  } as AuditLogEntry;
}

const LOG = [1, 2, 3, 4, 5].map(entry);

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function serve(): Promise<{ query: ReturnType<typeof vi.fn>; queryFacets: ReturnType<typeof vi.fn> }> {
  // A log of five entries, newest first, honouring `after` and `limit`.
  const query = vi.fn(async (filter: AuditLogFilter = {}) => {
    const after = filter.after;
    const rows = after
      ? LOG.filter((e) => e.actedAt < after.actedAt || (+e.actedAt === +after.actedAt && e.id < after.id))
      : LOG;
    return rows.slice(0, filter.limit ?? 100);
  });
  const queryFacets = vi.fn(async () => ({
    actions: ['audit.redacted', 'product.update', 'setting.update'],
    objectTypes: ['product', 'setting'],
  }));
  const auditLogService = { query, queryFacets } as unknown as AuditPort;
  const requireAdmin = (() => async () => {}) as unknown as RequireAdminFactory;
  app = Fastify();
  await registerAuditLogAdminRoutes(app, { auditLogService, requireAdmin });
  await app.ready();
  return { query, queryFacets };
}

interface Page {
  data: Array<{ id: string }>;
  pagination: { cursor: string | null; hasMore: boolean; limit: number };
}

async function page(url: string): Promise<Page> {
  const res = await app!.inject({ method: 'GET', url });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as Page;
}

describe('GET /api/v1/admin/audit-log — cursor pages', () => {
  it('answers a cursor while more entries exist, and walks the log without a gap or a repeat', async () => {
    await serve();
    const first = await page('/api/v1/admin/audit-log?limit=2');
    expect(first.data.map((e) => e.id)).toEqual([LOG[0]!.id, LOG[1]!.id]);
    expect(first.pagination).toMatchObject({ hasMore: true, limit: 2 });
    expect(first.pagination.cursor).toEqual(expect.any(String));

    const second = await page(`/api/v1/admin/audit-log?limit=2&cursor=${first.pagination.cursor!}`);
    expect(second.data.map((e) => e.id)).toEqual([LOG[2]!.id, LOG[3]!.id]);
    expect(second.pagination.hasMore).toBe(true);

    const last = await page(`/api/v1/admin/audit-log?limit=2&cursor=${second.pagination.cursor!}`);
    expect(last.data.map((e) => e.id)).toEqual([LOG[4]!.id]);
    expect(last.pagination).toEqual({ cursor: null, hasMore: false, limit: 2 });
  });

  it('keeps the filters on a later page', async () => {
    const { query } = await serve();
    const first = await page('/api/v1/admin/audit-log?limit=2&filter[action]=product.update');
    await page(`/api/v1/admin/audit-log?limit=2&filter[action]=product.update&cursor=${first.pagination.cursor!}`);
    expect(query.mock.calls[1]![0]).toMatchObject({
      action: 'product.update',
      after: { actedAt: LOG[1]!.actedAt, id: LOG[1]!.id },
      // One row past the page says whether another page exists.
      limit: 3,
    });
  });

  it('refuses a cursor it did not issue', async () => {
    await serve();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/admin/audit-log?cursor=not-a-cursor' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/v1/admin/audit-log/facets', () => {
  it('lists the actions with the module that labels each, and the object types', async () => {
    await serve();
    const res = await app!.inject({ method: 'GET', url: '/api/v1/admin/audit-log/facets' });
    expect(res.statusCode, res.body).toBe(200);
    const body = auditLogFacetsSchema.parse((res.json() as { data: unknown }).data);
    expect(body).toEqual({
      actions: [
        { action: 'audit.redacted', moduleId: 'audit_logs' },
        { action: 'product.update', moduleId: 'catalog' },
        { action: 'setting.update', moduleId: 'settings' },
      ],
      objectTypes: ['product', 'setting'],
    });
  });
});
