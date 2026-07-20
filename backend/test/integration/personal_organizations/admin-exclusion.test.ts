import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { AdminUser } from '../../../src/modules/admin_users/entities/admin-user.entity.js';
import { AdminRole } from '../../../src/modules/admin_roles/entities/admin-role.entity.js';
import { OrganizationSalesRepAssignment } from '../../../src/modules/organizations/entities/organization-sales-rep-assignment.entity.js';
import { SalesRepAssignmentService } from '../../../src/modules/organizations/services/sales-rep-assignment-service.js';

/**
 * Feature 051 US3 — personal (B2C) orgs are excluded from B2B admin surfaces by
 * default (org list + `includePersonal` opt-in), and cannot receive a sales rep.
 */
describe('Personal orgs excluded from B2B admin surfaces (feature 051 US3)', () => {
  let h: BackendServerHandle;
  let companyId: string;
  let personalId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const company = em.create(Organization, {
      name: '051 Company', taxId: `C${Date.now()}`, status: 'active', vatStatus: 'vat_payer',
      isPersonal: false, registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    const personal = em.create(Organization, {
      name: '051 Individual', taxId: randomUUID().replace(/-/g, ''), status: 'active', vatStatus: 'vat_exempt',
      isPersonal: true, registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush([company, personal]);
    companyId = company.id;
    personalId = personal.id;
  });

  afterAll(async () => teardownBackendServer(h));

  it('admin org list excludes personal orgs by default', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?limit=200',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
    expect(ids).toContain(companyId);
    expect(ids).not.toContain(personalId);
  });

  it('includePersonal=true surfaces personal orgs', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations?limit=200&includePersonal=true',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const ids = (res.json() as { data: Array<{ id: string }> }).data.map((o) => o.id);
    expect(ids).toContain(companyId);
    expect(ids).toContain(personalId);
  });

  it('a sales rep cannot be assigned to a personal org', async () => {
    const em = h.em();
    const role = em.create(AdminRole, { code: `r${Date.now()}`, name: 'R', permissions: [] });
    await em.persistAndFlush(role);
    const rep = em.create(AdminUser, {
      email: `rep-${Date.now()}@x.test`, passwordHash: 'x'.repeat(60), adminRoleId: role.id,
      firstName: 'R', lastName: 'R',
    });
    await em.persistAndFlush(rep);

    const svc = new SalesRepAssignmentService(h.em);
    await expect(svc.assign({ organizationId: personalId, adminUserId: rep.id })).rejects.toThrow(
      /personal/i,
    );
    // company org is fine
    await expect(svc.assign({ organizationId: companyId, adminUserId: rep.id })).resolves.toBeTruthy();
    void OrganizationSalesRepAssignment;
  });

  it('admin direct-member add is refused for a personal org (single-member invariant, T024)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${personalId}/members`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: `member-${Date.now()}@x.test`,
        firstName: 'M',
        lastName: 'M',
        password: 'a-very-strong-pass',
      },
    });
    expect(res.statusCode).toBe(422);
    // company org accepts a direct member
    const ok = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${companyId}/members`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: `member-ok-${Date.now()}@x.test`,
        firstName: 'M',
        lastName: 'M',
        password: 'a-very-strong-pass',
      },
    });
    expect(ok.statusCode).toBe(201);
  });
});
