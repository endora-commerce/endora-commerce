import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, organizationRoleRefSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { seedRoleScopingFixture } from '../../helpers/seed-roles.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * T177 — `GET /api/v1/organizations/mine/invitations` lists pending
 * invitations and `DELETE /api/v1/organizations/mine/invitations/:id`
 * revokes one. Both reserved to the Organization's administrator.
 *
 * `specs/170-organization-roles/` WP-03: each invitation names its role as
 * `organizationRole` (FR-008, FR-073), and **pending** means neither accepted,
 * revoked nor expired — an invitation whose `expiresAt` is past is no longer
 * listed (T122; FR-010a, owner ruling PR-7, research R-37).
 */

const ADMIN = { b2b_session: 'stub-customer-session' };

interface ListedInvitation {
  id: string;
  email: string;
  organizationRole: unknown;
}

describe('Organization invitations — list + revoke', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRoleScopingFixture(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function list(): Promise<ListedInvitation[]> {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/organizations/mine/invitations', cookies: ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: ListedInvitation[] }).data;
  }

  it('lists pending invitations and revokes one', async () => {
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/mine/invitations',
      cookies: ADMIN,
      payload: { email: 'pending-invitee@example.com' },
    });
    expect(invite.statusCode, invite.body).toBe(201);
    const invitationId = (invite.json() as { data: { invitationId: string } }).data.invitationId;

    const listed = (await list()).find((row) => row.id === invitationId);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('role');
    expect(organizationRoleRefSchema.parse(listed!.organizationRole)).toEqual({
      id: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member'),
      kind: 'member',
      name: 'Member',
    });

    const revoke = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/organizations/mine/invitations/${invitationId}`,
      cookies: ADMIN,
    });
    expect(revoke.statusCode).toBe(204);

    // After revoke, the row drops off the pending list.
    expect((await list()).some((row) => row.id === invitationId)).toBe(false);
  });

  it('omits an expired invitation, beside the accepted and revoked ones (T122, FR-010a, PR-7)', async () => {
    const memberRoleId = await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member');
    const day = 24 * 60 * 60 * 1000;
    const seeded: Record<'pending' | 'expired' | 'accepted' | 'revoked', string> = {
      pending: randomUUID(),
      expired: randomUUID(),
      accepted: randomUUID(),
      revoked: randomUUID(),
    };
    const states: Record<keyof typeof seeded, [Date, Date | null, Date | null]> = {
      pending: [new Date(Date.now() + 7 * day), null, null],
      expired: [new Date(Date.now() - day), null, null],
      accepted: [new Date(Date.now() + 7 * day), new Date(), null],
      revoked: [new Date(Date.now() + 7 * day), null, new Date()],
    };
    for (const [state, id] of Object.entries(seeded) as Array<[keyof typeof seeded, string]>) {
      const [expiresAt, consumedAt, revokedAt] = states[state];
      await h.em().execute(
        `insert into "organization_invitations"
           ("id","organization_id","email","organization_role_id","token_hash","expires_at",
            "consumed_at","revoked_at","created_at","updated_at")
         values (?, ?, ?, ?, ?, ?, ?, ?, now(), now())`,
        [id, TEST_ORGANIZATION_ID, `${state}-${id.slice(0, 8)}@invitations-list.example`, memberRoleId, `h-${id}`, expiresAt, consumedAt, revokedAt],
      );
    }

    const listedIds = new Set((await list()).map((row) => row.id));
    expect(listedIds.has(seeded.pending), 'a pending invitation is listed').toBe(true);
    expect(listedIds.has(seeded.expired), 'an expired invitation is not pending (FR-010a)').toBe(false);
    expect(listedIds.has(seeded.accepted)).toBe(false);
    expect(listedIds.has(seeded.revoked)).toBe(false);
  });

  it('rejects non-admin members with 403 FORBIDDEN', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/organizations/mine/invitations',
      cookies: { b2b_session: 'stub-regular-user-session' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
