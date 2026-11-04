import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { organizationRoleRefSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { assignOrganizationRole, predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { dropOrganizationRoleCache, seedCustomRole } from './organization-role-fixtures.js';

/**
 * The member's own session views (`specs/170-organization-roles/` WP-03, T053;
 * `contracts/storefront-api.md` §1, §3; FR-008, FR-056, FR-073).
 *
 * Login, `GET /api/v1/me`, `GET /api/v1/me/customer` and the invitation accept
 * answer the member's role as `organizationRole: { id, name, kind }` — a
 * predefined role's label translated in the response language, a custom role's
 * own name verbatim — and the effective permission codes, and none of them
 * carries the legacy `role` any more.
 *
 * `stub-customer-session` is `TEST_ORGANIZATION_ID`'s administrator;
 * `stub-empty-draft-customer-session` one of its members.
 */

const ADMIN = { b2b_session: 'stub-customer-session' };
const MEMBER = { b2b_session: 'stub-empty-draft-customer-session' };

interface SessionAccount {
  role?: unknown;
  organizationRole?: unknown;
  permissions?: unknown;
}

function expectRoleView(account: SessionAccount, expected: { id: string; kind: string; name: string }): void {
  expect(account, 'FR-073 — the legacy `role` is no longer answered').not.toHaveProperty('role');
  expect(organizationRoleRefSchema.parse(account.organizationRole)).toEqual(expected);
  expect(Array.isArray(account.permissions), 'FR-056 — the effective permission codes travel with the role').toBe(true);
}

describe('session views carry the organization role (170 WP-03)', () => {
  let h: BackendServerHandle;
  let administratorRoleId: string;
  let memberRoleId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    administratorRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'administrator');
    memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
  });

  afterAll(async () => {
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, memberRoleId);
    await teardownBackendServer(h);
  });

  it('login answers organizationRole and permissions, and no role', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: 'stub-customer@example.com', password: STUB_CUSTOMER_PASSWORD },
      headers: { 'accept-language': 'en' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const account = (res.json() as { data: { customerAccount: SessionAccount & { id: string } } }).data
      .customerAccount;
    expect(account.id).toBe(TEST_CUSTOMER_ID);
    expectRoleView(account, { id: administratorRoleId, kind: 'administrator', name: 'Administrator' });
    // The administrator holds every present code (FR-007); `addresses.manage` is one (FR-014a).
    expect(account.permissions).toContain('addresses.manage');
  });

  it('GET /api/v1/me names a predefined role in the request language (FR-008)', async () => {
    const en = await h.app.inject({ method: 'GET', url: '/api/v1/me', cookies: MEMBER, headers: { 'accept-language': 'en' } });
    expect(en.statusCode, en.body).toBe(200);
    const enAccount = (en.json() as { data: { customerAccount: SessionAccount } }).data.customerAccount;
    expectRoleView(enAccount, { id: memberRoleId, kind: 'member', name: 'Member' });
    expect(enAccount.permissions, '`addresses.manage` is a member default').toContain('addresses.manage');

    const pl = await h.app.inject({ method: 'GET', url: '/api/v1/me', cookies: MEMBER, headers: { 'accept-language': 'pl' } });
    expect(pl.statusCode).toBe(200);
    const plAccount = (pl.json() as { data: { customerAccount: SessionAccount } }).data.customerAccount;
    expectRoleView(plAccount, { id: memberRoleId, kind: 'member', name: 'Członek' });
  });

  it('GET /api/v1/me names a custom role by its own name and answers exactly its present grants', async () => {
    const customRoleId = await seedCustomRole(h.em(), {
      organizationId: TEST_ORGANIZATION_ID,
      name: 'Purchasing Lead',
      permissions: ['addresses.manage', 'no_such_module.no_such_action'],
    });
    dropOrganizationRoleCache(h, TEST_ORGANIZATION_ID);
    await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, customRoleId);
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/me', cookies: MEMBER, headers: { 'accept-language': 'pl' } });
      expect(res.statusCode, res.body).toBe(200);
      const account = (res.json() as { data: { customerAccount: SessionAccount } }).data.customerAccount;
      expectRoleView(account, { id: customRoleId, kind: 'custom', name: 'Purchasing Lead' });
      expect(account.permissions, 'an undeclared code is never effective (FR-007)').toEqual(['addresses.manage']);
    } finally {
      await assignOrganizationRole(h.em(), TEST_CUSTOMER_EMPTY_ID, memberRoleId);
    }
  });

  it('GET /api/v1/me/customer answers organizationRole and permissions, and no role', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/me/customer', cookies: ADMIN, headers: { 'accept-language': 'en' } });
    expect(res.statusCode, res.body).toBe(200);
    const account = (res.json() as { data: SessionAccount }).data;
    expectRoleView(account, { id: administratorRoleId, kind: 'administrator', name: 'Administrator' });
  });

  it('the invitation accept answers the new member with the role the invitation named', async () => {
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      cookies: ADMIN,
      payload: { email: 'session-views-invitee@example.com' },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    const probe = await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-invitation-token' });
    const { token } = probe.json() as { token: string };

    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${token}/accept`,
      headers: { 'accept-language': 'pl' },
      payload: { password: 'invited-strong-password-12!', firstName: 'Sess', lastName: 'Ion' },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    const account = (accept.json() as { data: { customerAccount: SessionAccount } }).data.customerAccount;
    expectRoleView(account, { id: memberRoleId, kind: 'member', name: 'Członek' });
  });
});
