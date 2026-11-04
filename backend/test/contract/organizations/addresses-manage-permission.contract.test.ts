import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedRoleScopingFixture, TEST_REGULAR_USER_ID } from '../../helpers/seed-roles.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, holdCustomRole } from './organization-role-fixtures.js';

/**
 * Organization addresses need `addresses.manage` to be written
 * (`specs/170-organization-roles/` WP-03, T056; `contracts/storefront-api.md`
 * §4; FR-014a, owner ruling OR-8, research R-8b, #668).
 *
 * Creating, editing and deleting a shared address of the Organization is
 * refused `403 ORGANIZATION_PERMISSION_REQUIRED` — naming the permission and
 * its translated label — to a member whose role lacks the code, and allowed
 * to one whose role holds it. Reading the list stays open to every member. The
 * code is a *Member* default, so today's members keep the outcome they have
 * (FR-072).
 *
 * `stub-regular-user-session` is `TEST_REGULAR_USER_ID`, moved between roles
 * below.
 */

const MEMBER = { b2b_session: 'stub-regular-user-session' };

const ADDRESS = {
  kind: 'delivery',
  recipientName: 'Warehouse',
  street: 'ul. Magazynowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
} as const;

interface ErrorBody {
  error: { code: string; message: string; details?: { permission?: string; permissionLabel?: string } };
}

describe('organization addresses — writes need addresses.manage (FR-014a)', () => {
  let h: BackendServerHandle;
  let memberRoleId: string;
  let addressId: string;

  async function create(cookies = MEMBER) {
    return h.app.inject({ method: 'POST', url: '/api/v1/organizations/mine/addresses', cookies, payload: ADDRESS });
  }

  function expectRefused(res: { statusCode: number; json: () => unknown }, language: 'en' | 'pl' = 'en'): void {
    expect(res.statusCode).toBe(403);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(ERROR_CODES.ORGANIZATION_PERMISSION_REQUIRED);
    expect(body.error.details?.permission).toBe('addresses.manage');
    if (language === 'en') expect(body.error.details?.permissionLabel).toBe('Manage organization addresses');
    else expect(body.error.details?.permissionLabel).not.toBe('Manage organization addresses');
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRoleScopingFixture(h.em());
    memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');

    // As a Member, which holds the code: the address the refused role then tries to edit.
    const created = await create();
    expect(created.statusCode, created.body).toBe(201);
    addressId = (created.json() as { data: { id: string } }).data.id;

    await holdCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_REGULAR_USER_ID,
      permissions: [],
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);
  });

  afterAll(async () => {
    await assignOrganizationRole(h.em(), TEST_REGULAR_USER_ID, memberRoleId);
    await teardownBackendServer(h);
  });

  it('refuses create, update and delete to a role without the code', async () => {
    expectRefused(await create());
    expectRefused(
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/organizations/mine/addresses/${addressId}`,
        cookies: MEMBER,
        payload: { city: 'Kraków' },
      }),
    );
    expectRefused(
      await h.app.inject({ method: 'DELETE', url: `/api/v1/organizations/mine/addresses/${addressId}`, cookies: MEMBER }),
    );
  });

  it('names the permission in the request language', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/addresses',
      cookies: MEMBER,
      headers: { 'accept-language': 'pl' },
      payload: ADDRESS,
    });
    expectRefused(res, 'pl');
  });

  it('keeps the list open to the same member', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/addresses', cookies: MEMBER });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: Array<{ id: string }> }).data.some((a) => a.id === addressId)).toBe(true);
  });

  it('allows create, update and delete to a role holding the code', async () => {
    await holdCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_REGULAR_USER_ID,
      permissions: ['addresses.manage'],
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);
    const created = await create();
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    const patched = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/addresses/${id}`,
      cookies: MEMBER,
      payload: { city: 'Kraków' },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const deleted = await h.app.inject({ method: 'DELETE', url: `/api/v1/organizations/mine/addresses/${id}`, cookies: MEMBER });
    expect(deleted.statusCode).toBe(204);
  });

  it('allows the Member role, which holds the code by default (FR-072)', async () => {
    await assignOrganizationRole(h.em(), TEST_REGULAR_USER_ID, memberRoleId);
    const created = await create();
    expect(created.statusCode, created.body).toBe(201);
  });
});
