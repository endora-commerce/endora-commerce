import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope, withSystemScopeActingFor } from '@endora-commerce/platform/tenancy';
import { makeAssignSalesRepCommand, makeUnassignSalesRepCommand } from './sales-rep-assignment.commands.js';

/**
 * `organization.sales_rep_assign` / `organization.sales_rep_unassign` as
 * Commands (`specs/186-aggregate-ports/` research R-16.7). The hand audit of
 * `SalesRepAssignmentService` becomes the bus's one entry, with the same
 * action and state; an idempotent repeat changes nothing and records nothing;
 * the assigner is the ambient administrator; a personal Organization and an
 * unknown administrator are refused before anything is written.
 */

const ORG = '00000000-0000-4000-8000-000000186171';
const REP = '00000000-0000-4000-8000-0000001861a1';
const ADMIN = '00000000-0000-4000-8000-0000001861b1';

function harness(options: { personal?: boolean; assigned?: boolean } = {}) {
  const org = { id: ORG, name: 'Sales Rep Co', isPersonal: options.personal ?? false };
  const rows: Array<Record<string, unknown>> = options.assigned ? [{ organizationId: ORG, adminUserId: REP }] : [];
  const audits: Array<Record<string, unknown>> = [];
  const em = {
    async findOne(entity: { name: string }, where: Record<string, unknown>) {
      if (entity.name === 'Organization') return where['id'] === ORG ? org : null;
      return rows.find((r) => r['organizationId'] === where['organizationId'] && r['adminUserId'] === where['adminUserId']) ?? null;
    },
    create(_entity: unknown, data: Record<string, unknown>) {
      return { ...data };
    },
    persist(row: Record<string, unknown>) {
      rows.push(row);
    },
    remove(row: Record<string, unknown>) {
      rows.splice(rows.indexOf(row), 1);
      return em;
    },
    async flush() {},
    async transactional<T>(cb: (em: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const bus = new CommandBus({ em: { fork: () => em } } as unknown as MikroORM, audit, new EventBus<Record<string, EventBase>>());
  const adminUsers = { findById: async (id: string) => (id === REP ? ({ id } as never) : null) };
  return { rows, audits, bus, adminUsers };
}

describe('organization.sales_rep_assign (186 R-16.7)', () => {
  it('assigns, stamps the ambient administrator, and records the hand audit’s state', async () => {
    const h = harness();
    const outcome = await withSystemScopeActingFor(ADMIN, 'unit test: assign', () =>
      h.bus.run(makeAssignSalesRepCommand({ adminUsers: h.adminUsers }, { organizationId: ORG, adminUserId: REP })),
    );
    expect(outcome.created).toBe(true);
    expect(h.rows).toEqual([{ organizationId: ORG, adminUserId: REP, assignedByAdminUserId: ADMIN }]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'organization.sales_rep_assign',
        objectType: 'organization',
        objectId: ORG,
        actorAdminUserId: ADMIN,
        stateBefore: null,
        stateAfter: { adminUserId: REP },
      }),
    ]);
  });

  it('records nothing for an administrator already assigned', async () => {
    const h = harness({ assigned: true });
    const outcome = await withSystemScope('unit test: assign again', () =>
      h.bus.run(makeAssignSalesRepCommand({}, { organizationId: ORG, adminUserId: REP })),
    );
    expect(outcome.created).toBe(false);
    expect(h.rows).toHaveLength(1);
    expect(h.audits).toEqual([]);
  });

  it('refuses a personal Organization, an unknown Organization and an unknown administrator, writing nothing', async () => {
    const personal = harness({ personal: true });
    await expect(
      withSystemScope('unit test', () =>
        personal.bus.run(makeAssignSalesRepCommand({}, { organizationId: ORG, adminUserId: REP })),
      ),
    ).rejects.toMatchObject({ statusCode: 422, code: 'ORGANIZATION_PERSONAL' });

    const h = harness();
    await expect(
      withSystemScope('unit test', () =>
        h.bus.run(
          makeAssignSalesRepCommand({}, { organizationId: '00000000-0000-4000-8000-000000000000', adminUserId: REP }),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Organization not found.' });
    await expect(
      withSystemScope('unit test', () =>
        h.bus.run(makeAssignSalesRepCommand({ adminUsers: h.adminUsers }, { organizationId: ORG, adminUserId: ADMIN })),
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Admin user not found.' });
    expect([...personal.rows, ...h.rows]).toEqual([]);
    expect([...personal.audits, ...h.audits]).toEqual([]);
  });
});

describe('organization.sales_rep_unassign (186 R-16.7)', () => {
  it('removes the assignment and records it in stateBefore', async () => {
    const h = harness({ assigned: true });
    const removed = await withSystemScope('unit test: unassign', () =>
      h.bus.run(makeUnassignSalesRepCommand({ organizationId: ORG, adminUserId: REP })),
    );
    expect(removed).toBe(true);
    expect(h.rows).toEqual([]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        action: 'organization.sales_rep_unassign',
        stateBefore: { adminUserId: REP },
        stateAfter: null,
      }),
    ]);
  });

  it('answers false and records nothing when there is no assignment, or an id is malformed', async () => {
    for (const input of [
      { organizationId: ORG, adminUserId: REP },
      { organizationId: 'nope', adminUserId: REP },
    ]) {
      const h = harness();
      const removed = await withSystemScope('unit test: unassign nothing', () =>
        h.bus.run(makeUnassignSalesRepCommand(input)),
      );
      expect(removed).toBe(false);
      expect(h.audits).toEqual([]);
    }
  });
});
