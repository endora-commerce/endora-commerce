import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import type { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { registerAuditLogAdminRoutes } from '../../../../packages/modules/audit_logs/src/backend/routes.admin.js';

/**
 * D-102 — what `audit_logs` can actually promise when `admin_users` is not
 * there, asserted at the seam where the promise is true.
 *
 * The module's own comment used to claim that "an operator investigating an
 * incident wants the record more, not less, when part of the platform is off",
 * and the route cannot deliver that: `requireAdmin` reads `adminUserReadPort`
 * since feature 075 Phase C, so on a deployment without `admin_users` the
 * request is refused before this handler runs
 * (`test/integration/audit_logs/detached-from-admin-users.test.ts` pins that).
 *
 * What survives is narrower and real: **the enrichment degrades and the record
 * does not.** With no `resolveActors` contribution the rows still render, with
 * raw actor ids in the actor column. That is a claim about this module's own
 * handler, so it is tested over this module's own handler — the route mounted
 * on a bare Fastify instance with the guard satisfied, which is the only
 * arrangement in which the interesting input (an absent contribution) is
 * reachable at all.
 */

const ACTOR = '11111111-1111-4111-8111-111111111111';

const ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  actorAdminUserId: ACTOR,
  impersonatedCustomerAccountId: null,
  actedAt: new Date('2026-08-18T10:00:00.000Z'),
  action: 'product.update',
  objectType: 'product',
  objectId: '33333333-3333-4333-8333-333333333333',
  stateBefore: null,
  stateAfter: null,
  ipAddress: null,
  userAgent: null,
  requestId: null,
} as unknown as AuditLogEntry;

const auditLogService = {
  query: async () => [ROW],
} as unknown as AuditLogService;

/** The guard is satisfied here on purpose: its refusal is another file's subject. */
const requireAdmin = () => async (): Promise<void> => {};

async function appWith(
  resolveActors?: (ids: string[]) => Promise<
    Array<{ id: string; firstName: string; lastName: string; email: string }>
  >,
): Promise<FastifyInstance> {
  const app = Fastify();
  await registerAuditLogAdminRoutes(app, {
    auditLogService,
    requireAdmin,
    ...(resolveActors ? { resolveActors } : {}),
  });
  await app.ready();
  return app;
}

describe('GET /api/v1/admin/audit-log — the actor column degrades, the record does not', () => {
  let degraded: FastifyInstance;
  let enriched: FastifyInstance;

  beforeAll(async () => {
    degraded = await appWith();
    enriched = await appWith(async (ids) =>
      ids.map((id) => ({ id, firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' })),
    );
  });

  afterAll(async () => {
    await degraded.close();
    await enriched.close();
  });

  it('renders the row with a raw actor id when nothing contributes the resolver', async () => {
    const res = await degraded.inject({ method: 'GET', url: '/api/v1/admin/audit-log' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.['actorAdminUserId']).toBe(ACTOR);
    expect(body.data[0]?.['action']).toBe('product.update');
    // Degraded, not missing: the column answers `null` rather than the request
    // failing, which is the whole difference between an enrichment and a
    // dependency.
    expect(body.data[0]?.['actorName']).toBeNull();
    expect(body.data[0]?.['actorEmail']).toBeNull();
  });

  it('renders the same row enriched when the contribution is there', async () => {
    // The other half of the same claim, so "degraded" is a measured difference
    // rather than a field that is null everywhere.
    const res = await enriched.inject({ method: 'GET', url: '/api/v1/admin/audit-log' });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data[0]?.['actorName']).toBe('Ada Lovelace');
    expect(body.data[0]?.['actorEmail']).toBe('ada@example.com');
  });
});
