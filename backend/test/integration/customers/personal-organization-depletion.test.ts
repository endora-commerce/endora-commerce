import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * `customers`' depletion guards apply to company Organizations only
 * (`specs/170-organization-roles/` WP-03, T119/T120; owner ruling PR-3; research
 * R-34; FR-070a).
 *
 * A personal Organization's sole member holds *Administrator*, so a guard that
 * asked only "is this the last administrator?" would refuse the operator's
 * deletion and blocking of **every** B2C customer with `409
 * ORG_OWNER_DEPLETION`. A personal Organization's depletion is its intended
 * end (`anonymizeIfOrphaned`), so the guards ask whether the Organization is a
 * company first. The same operations on a company Organization's last
 * administrator are still refused.
 */

const OPERATOR = { b2b_session: 'stub-admin-session' };

describe('customers — depletion guards are for company Organizations only (PR-3)', () => {
  let h: BackendServerHandle;

  async function organization(isPersonal: boolean): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, ?, now(), now())`,
      [id, `Depletion ${id.slice(0, 8)}`, `depl-${id.slice(0, 13)}`, `/${id}/`, isPersonal],
    );
    return id;
  }

  /** An account of `organizationId` holding its `kind` role; the legacy column as an individual's is today. */
  async function account(
    organizationId: string,
    kind: 'administrator' | 'member',
    options: { blocked?: boolean } = {},
  ): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","blocked_at","created_at","updated_at")
       values (?, ?, ?, 'x', 'Dep', 'Letion', ?, ?, now(), now())`,
      [
        id,
        organizationId,
        `${id.slice(0, 8)}@depletion.example`,
        await predefinedRoleIdOf(h.em(), organizationId, kind),
        options.blocked ? new Date() : null,
      ],
    );
    return id;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('deletes a personal Organization’s member, its administrator (not ORG_OWNER_DEPLETION)', async () => {
    const individual = await account(await organization(true), 'administrator');
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${individual}`, cookies: OPERATOR });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { deleted: boolean } }).data.deleted).toBe(true);
  });

  it('blocks a personal Organization’s member, its administrator (not ORG_OWNER_DEPLETION)', async () => {
    const individual = await account(await organization(true), 'administrator');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${individual}/block`,
      cookies: OPERATOR,
      payload: { reason: 'abuse' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: { blocked: boolean } }).data.blocked).toBe(true);
  });

  it('still refuses deleting a company Organization’s last administrator', async () => {
    const company = await organization(false);
    const onlyAdministrator = await account(company, 'administrator');
    await account(company, 'member');
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${onlyAdministrator}`, cookies: OPERATOR });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
  });

  it('still refuses blocking a company Organization’s last administrator', async () => {
    const company = await organization(false);
    const onlyAdministrator = await account(company, 'administrator');
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${onlyAdministrator}/block`,
      cookies: OPERATOR,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
  });

  it('still refuses unassigning a company Organization’s last administrator', async () => {
    const company = await organization(false);
    const onlyAdministrator = await account(company, 'administrator');
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${onlyAdministrator}/organization`,
      cookies: OPERATOR,
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
  });

  // Owner ruling (lead, 2026-11-03): blocked administrators do not count toward
  // last-administrator protection — for deletion and unassign as for blocking.
  it('refuses deleting the last unblocked administrator when the only other one is blocked', async () => {
    const company = await organization(false);
    const administrator = await account(company, 'administrator');
    await account(company, 'administrator', { blocked: true });
    const res = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${administrator}`, cookies: OPERATOR });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
  });

  it('refuses unassigning the last unblocked administrator when the only other one is blocked', async () => {
    const company = await organization(false);
    const administrator = await account(company, 'administrator');
    await account(company, 'administrator', { blocked: true });
    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${administrator}/organization`,
      cookies: OPERATOR,
    });
    expect(res.statusCode, res.body).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.ORG_OWNER_DEPLETION);
  });

  it('judges the administrator by the role it holds (T058)', async () => {
    // The one holding the Administrator role is the one the guard protects.
    const company = await organization(false);
    const administrator = await account(company, 'administrator');
    const member = await account(company, 'member');
    const deleteMember = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${member}`, cookies: OPERATOR });
    expect(deleteMember.statusCode, deleteMember.body).toBe(200);
    const deleteAdministrator = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/customers/${administrator}`, cookies: OPERATOR });
    expect(deleteAdministrator.statusCode).toBe(409);
  });
});
