import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptInvitationResponseSchema,
  adminOrganizationDetailSchema,
  adminOrganizationListResponseSchema,
  adminOrganizationMemberSchema,
  inviteMemberResponseSchema,
  organizationInvitationListResponseSchema,
  organizationMemberListResponseSchema,
  organizationMemberSchema,
  registerOrganizationResponseSchema,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
/** The seeded Organization's administrator. */
const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };

/**
 * The organization replies answer what `@endora-commerce/contracts` publishes,
 * and nothing beside it (Constitution II, issue #599 §1).
 *
 * The admin organization list and detail, the admin member reply, the buyer's
 * member and invitation lists, the invite and accept replies and the
 * registration reply were built by serialisers typed `Record<string, unknown>`
 * or by none at all, and nothing parsed them against a schema. Each is parsed
 * here with a strict copy of its published schema: a declared field answered
 * with a type the schema refuses, a required field not answered, and a key no
 * schema declares all red this file.
 *
 * `GET /api/v1/me` and the password sign-in are in
 * `session-response-schema.contract.test.ts`.
 *
 * The only rows written are this file's own: one invitation (and the account
 * that accepts it) on the seeded Organization, and one registered Organization.
 */
describe('organization responses parse with the published schemas', () => {
  let h: BackendServerHandle;
  const stamp = `${Date.now()}`.slice(-9);

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function get(url: string, actor: typeof ADMIN): Promise<unknown> {
    const res = await h.app.inject({ method: 'GET', url, ...actor });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  it('GET /api/v1/admin/organizations — the list envelope and every row', async () => {
    const body = await get('/api/v1/admin/organizations', ADMIN);
    expect((body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    expect(disagreements(deepStrict(adminOrganizationListResponseSchema), body)).toEqual([]);
  });

  it('GET /api/v1/admin/organizations/:id — the detail, its members and its predefined roles', async () => {
    const body = (await get(`/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`, ADMIN)) as {
      data: { members: unknown[]; predefinedRoles: unknown[] };
    };
    expect(body.data.members.length).toBeGreaterThan(0);
    expect(body.data.predefinedRoles).toHaveLength(2);
    expect(disagreements(deepStrict(adminOrganizationDetailSchema), body.data)).toEqual([]);
    // The member rows are the admin member reply (`PATCH …/members/:id/rollup` and the rest).
    expect(body.data.members.flatMap((m) => disagreements(deepStrict(adminOrganizationMemberSchema), m))).toEqual(
      [],
    );
  });

  it('GET /api/v1/organizations/mine/members — the buyer roster', async () => {
    const body = await get('/api/v1/organizations/mine/members', CUSTOMER);
    expect((body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    expect(disagreements(deepStrict(organizationMemberListResponseSchema), body)).toEqual([]);
  });

  it('invite, the pending invitation list, and accept', async () => {
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      ...CUSTOMER,
      payload: { email: `schema-invitee-${stamp}@example.test` },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    expect(disagreements(deepStrict(inviteMemberResponseSchema), invite.json())).toEqual([]);
    const invitationId = (invite.json() as { data: { invitationId: string } }).data.invitationId;

    const list = (await get('/api/v1/organizations/mine/invitations', CUSTOMER)) as { data: Array<{ id: string }> };
    expect(list.data.map((row) => row.id)).toContain(invitationId);
    expect(disagreements(deepStrict(organizationInvitationListResponseSchema), list)).toEqual([]);

    const probe = await h.app.inject({ method: 'GET', url: '/api/v1/_test/latest-invitation-token' });
    const { token } = probe.json() as { token: string };
    const accept = await h.app.inject({
      method: 'POST',
      url: `/api/v1/organizations/invitations/${token}/accept`,
      payload: { password: 'invited-strong-password-12!', firstName: 'Schema', lastName: 'Invitee' },
    });
    expect(accept.statusCode, accept.body).toBe(200);
    expect(disagreements(deepStrict(acceptInvitationResponseSchema), accept.json())).toEqual([]);
  });

  it('PATCH /api/v1/organizations/mine/members/:id/role — the member it answers', async () => {
    const roster = (await get('/api/v1/organizations/mine/members', CUSTOMER)) as {
      data: Array<{ id: string; email: string; organizationRole: { id: string; kind: string } }>;
    };
    const member = roster.data.find((m) => m.email === `schema-invitee-${stamp}@example.test`);
    expect(member, 'the account the previous test accepted').toBeDefined();
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/organizations/mine/members/${member!.id}/role`,
      ...CUSTOMER,
      payload: { roleId: member!.organizationRole.id },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(disagreements(deepStrict(organizationMemberSchema), (res.json() as { data: unknown }).data)).toEqual([]);
  });

  it('POST /api/v1/organizations/register — the registration reply', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: `Schema Co ${stamp}`,
          taxId: `PL9${stamp}`,
          registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-001', country: 'PL' },
        },
        firstUser: {
          email: `schema-register-${stamp}@example.test`,
          password: 'a-very-strong-password-123!',
          firstName: 'Anna',
          lastName: 'Nowak',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(
      disagreements(deepStrict(registerOrganizationResponseSchema), (res.json() as { data: unknown }).data),
    ).toEqual([]);
  });
});
