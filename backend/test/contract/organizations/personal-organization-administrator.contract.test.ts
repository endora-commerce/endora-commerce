import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CUSTOMER_COOKIES, OTHER_TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { bindOrganizationsToFixtureChannelsSql } from '../../helpers/sales-channel-access.js';

/**
 * A personal Organization's member is its administrator — and that opens
 * nothing it must not have (`specs/170-organization-roles/` WP-03, T119; owner
 * rulings PR-3 and PR-10; research R-34; FR-070a).
 *
 * The member and invitation routes answer as for any administrator: the members
 * list shows the one member, the invitations list is empty, revoking another
 * Organization's invitation is `404` (the lookup is scoped to the caller's
 * Organization). Inviting is refused `422 VALIDATION_FAILED` because the
 * Organization is personal, **before** the role id is read — a role id the
 * Organization does not have would otherwise be `404`. Removing or demoting
 * oneself is the last-administrator refusal. The role routes stay `404`
 * (T028's rule, re-asserted from the member side).
 *
 * The account is inserted without a role, as a self-registered individual's
 * row is; the default trigger gives it the personal Organization's
 * *Administrator* (PR-3, R-28).
 */

const PERSONAL = 'stub-personal-administrator-session';

describe('a personal Organization’s administrator (PR-3)', () => {
  let h: BackendServerHandle;
  let personalOrganizationId: string;
  let personalAccountId: string;
  let otherOrganizationInvitationId: string;

  const inject = (request: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: object }) =>
    h.app.inject({ ...request, cookies: { b2b_session: PERSONAL } });

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOtherTestOrganization(h.em());
    personalOrganizationId = randomUUID();
    personalAccountId = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, 'Personal administrator test', ?, 'active', 'vat_payer', '{}'::jsonb, ?, true, now(), now())`,
      [personalOrganizationId, `personal-${personalOrganizationId.slice(0, 13)}`, `/${personalOrganizationId}/`],
    );
    await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","created_at","updated_at")
       values (?, ?, ?, 'x', 'Indi', 'Vidual', now(), now())`,
      [personalAccountId, personalOrganizationId, `${personalAccountId.slice(0, 8)}@personal-admin.example`],
    );
    await bindOrganizationsToFixtureChannelsSql(h.em(), [personalOrganizationId]);
    CUSTOMER_COOKIES[PERSONAL] = { customerAccountId: personalAccountId, organizationId: personalOrganizationId };

    otherOrganizationInvitationId = randomUUID();
    await h.em().execute(
      `insert into "organization_invitations"
         ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
       values (?, ?, ?, ?, ?, now() + interval '7 days', now(), now())`,
      [
        otherOrganizationInvitationId,
        OTHER_TEST_ORGANIZATION_ID,
        `${otherOrganizationInvitationId.slice(0, 8)}@other-org-invite.example`,
        await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'member'),
        `h-${otherOrganizationInvitationId}`,
      ],
    );
  });

  afterAll(async () => {
    delete CUSTOMER_COOKIES[PERSONAL];
    await teardownBackendServer(h);
  });

  it('holds the personal Organization’s Administrator role', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/me' });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: { customerAccount: { organizationRole: { id: string; kind: string } }; organization: { isPersonal: boolean } } };
    expect(body.data.organization.isPersonal).toBe(true);
    expect(body.data.customerAccount.organizationRole).toMatchObject({
      id: await predefinedRoleIdOf(h.em(), personalOrganizationId, 'administrator'),
      kind: 'administrator',
    });
  });

  it('lists the members — only themself (PR-10)', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/organizations/mine/members' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Array<{ id: string }> }).data.map((m) => m.id)).toEqual([personalAccountId]);
  });

  it('lists no invitations (PR-10)', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/organizations/mine/invitations' });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it.each([
    ['a Member', () => ({})],
    ['an Administrator', async (): Promise<object> => ({ roleId: await predefinedRoleIdOf(h.em(), personalOrganizationId, 'administrator') })],
    [
      'with a role id the Organization does not have — refused before it is resolved',
      async (): Promise<object> => ({ roleId: await predefinedRoleIdOf(h.em(), OTHER_TEST_ORGANIZATION_ID, 'member') }),
    ],
  ])('cannot invite %s → 422 VALIDATION_FAILED', async (_label, roleBody) => {
    const res = await inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      payload: { email: `personal-invite-${randomUUID().slice(0, 8)}@example.com`, ...(await roleBody()) },
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it('cannot revoke another Organization’s invitation → 404', async () => {
    const res = await inject({ method: 'DELETE', url: `/api/v1/organizations/mine/invitations/${otherOrganizationInvitationId}` });
    expect(res.statusCode).toBe(404);
  });

  it('cannot remove themself → 409 CANNOT_REMOVE_LAST_ADMIN', async () => {
    const res = await inject({ method: 'DELETE', url: `/api/v1/organizations/mine/members/${personalAccountId}` });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CANNOT_REMOVE_LAST_ADMIN);
  });

  it('cannot demote themself → 409 CANNOT_DEMOTE_LAST_ADMIN', async () => {
    const res = await inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/members/${personalAccountId}/role`,
      payload: { roleId: await predefinedRoleIdOf(h.em(), personalOrganizationId, 'member') },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.CANNOT_DEMOTE_LAST_ADMIN);
  });

  it('keeping the Administrator role is a no-op that answers 200', async () => {
    const res = await inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/members/${personalAccountId}/role`,
      payload: { roleId: await predefinedRoleIdOf(h.em(), personalOrganizationId, 'administrator') },
    });
    expect(res.statusCode, res.body).toBe(200);
  });

  it('the role routes stay 404 for a personal Organization', async () => {
    const res = await inject({ method: 'GET', url: '/api/v1/organizations/mine/roles' });
    expect(res.statusCode).toBe(404);
  });
});
