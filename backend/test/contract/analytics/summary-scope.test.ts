import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  AdminRole,
  AdminUser,
  AnalyticsEvent,
  Organization,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * The analytics summary is narrowed to the organizations its reader reaches
 * (Principle XI).
 *
 * A sales representative holding `analytics:read` is shown the events of the
 * organizations assigned to them and nothing else; a representative with no
 * assignment is shown nothing; a platform administrator is shown everything,
 * the events that belong to no organization included.
 */
describe('GET /api/v1/admin/analytics/summary — tenant scope', () => {
  let h: BackendServerHandle;
  const stamp = Date.now();
  const URL =
    '/api/v1/admin/analytics/summary?from=2026-05-01T00:00:00Z&to=2026-05-03T00:00:00Z';
  const ASSIGNED_REP = `stub-analytics-rep-${stamp}`;
  const UNASSIGNED_REP = `stub-analytics-rep-none-${stamp}`;

  async function totalFor(cookie: string): Promise<{ status: number; total: number; days: number }> {
    const res = await h.app.inject({ method: 'GET', url: URL, cookies: { b2b_session: cookie } });
    if (res.statusCode !== 200) return { status: res.statusCode, total: -1, days: -1 };
    const body = res.json() as {
      data: {
        totalsByType: Array<{ count: number }>;
        daily: Array<{ count: number }>;
      };
    };
    return {
      status: 200,
      total: body.data.totalsByType.reduce((sum, row) => sum + row.count, 0),
      days: body.data.daily.reduce((sum, row) => sum + row.count, 0),
    };
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    // The admin scope keys on this exact role code, so the row is shared with
    // every other file in the run: widen it with the one code these cases need.
    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['analytics:read'],
      });
    } else {
      role.permissions = Array.from(new Set([...role.permissions, 'analytics:read']));
    }
    await em.persistAndFlush(role);

    const organization = (name: string, suffix: string) =>
      em.create(Organization, {
        name,
        taxId: `PLANA${suffix}${String(stamp).slice(-7)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: {
          street: 'ul. Zakresu 1',
          city: 'Warszawa',
          postalCode: '00-100',
          country: 'PL',
        },
      });
    const assigned = organization('Analytics assigned org', 'A');
    const other = organization('Analytics other org', 'B');
    await em.persistAndFlush([assigned, other]);

    const rep = (label: string) =>
      em.create(AdminUser, {
        email: `analytics-${label}-${stamp}@audit.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'Analytics',
        lastName: label,
      });
    const assignedRep = rep('rep');
    const unassignedRep = rep('rep-none');
    await em.persistAndFlush([assignedRep, unassignedRep]);
    await em.persistAndFlush(
      em.create(OrganizationSalesRepAssignment, {
        organizationId: assigned.id,
        adminUserId: assignedRep.id,
      }),
    );
    ADMIN_COOKIES[ASSIGNED_REP] = { adminUserId: assignedRep.id };
    ADMIN_COOKIES[UNASSIGNED_REP] = { adminUserId: unassignedRep.id };

    const day = new Date('2026-05-01T12:00:00Z');
    const nextDay = new Date('2026-05-02T12:00:00Z');
    const event = (organizationId: string | null, occurredAt: Date) =>
      em.create(AnalyticsEvent, {
        type: 'product.viewed',
        occurredAt,
        ...(organizationId === null ? {} : { organizationId }),
      });
    // Two in the assigned organization, three in another, four in none.
    em.persist([
      event(assigned.id, day),
      event(assigned.id, nextDay),
      event(other.id, day),
      event(other.id, day),
      event(other.id, nextDay),
      event(null, day),
      event(null, day),
      event(null, nextDay),
      event(null, nextDay),
    ]);
    await em.flush();
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[ASSIGNED_REP];
    delete ADMIN_COOKIES[UNASSIGNED_REP];
    await teardownBackendServer(h);
  });

  it('shows a sales representative the events of their organizations only, in both series', async () => {
    expect(await totalFor(ASSIGNED_REP)).toEqual({ status: 200, total: 2, days: 2 });
  });

  it('shows a sales representative with no assignment nothing', async () => {
    expect(await totalFor(UNASSIGNED_REP)).toEqual({ status: 200, total: 0, days: 0 });
  });

  it('shows a platform administrator every event, the unattributed ones included', async () => {
    expect(await totalFor('stub-admin-session')).toEqual({ status: 200, total: 9, days: 9 });
  });
});
