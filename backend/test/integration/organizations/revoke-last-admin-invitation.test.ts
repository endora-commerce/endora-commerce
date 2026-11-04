import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CustomerAccountReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { makeRevokeOrganizationInvitationCommand } from '../../../../packages/modules/organizations/src/backend/commands/organization-invitation-revoke.command.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * The last-administrator invitation rule (`specs/170-organization-roles/`
 * WP-03; lead's rulings on the WP-03 questions, 2026-11-03).
 *
 * While an Organization has no active administrator, its only outstanding
 * invitation to the *Administrator* role cannot be revoked
 * (`409 CANNOT_REVOKE_LAST_ADMIN_INVITE`). "Outstanding" is FR-010a's
 * "pending": an **expired** administrator invitation is not a path back in,
 * and a **blocked** administrator is not an active one.
 */

describe('revoking the last administrator invitation', () => {
  let h: BackendServerHandle;

  const cradle = () =>
    h.container.cradle as unknown as {
      commandBus: { run<T>(command: { run: (ctx: never) => Promise<{ result: T }> }): Promise<T> };
      customerAccountReadPort: CustomerAccountReadPort;
    };

  async function organization(): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "organizations"
         ("id","name","tax_id","status","vat_status","registered_address","path","is_personal","created_at","updated_at")
       values (?, ?, ?, 'active', 'vat_payer', '{}'::jsonb, ?, false, now(), now())`,
      [id, `Revoke ${id.slice(0, 8)}`, `rev-${id.slice(0, 13)}`, `/${id}/`],
    );
    return id;
  }

  async function account(organizationId: string, kind: 'administrator' | 'member', blocked = false): Promise<void> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","blocked_at","created_at","updated_at")
       values (?, ?, ?, 'x', 'Re', 'Voke', ?, ?, now(), now())`,
      [
        id,
        organizationId,
        `${id.slice(0, 8)}@revoke.example`,
        await predefinedRoleIdOf(h.em(), organizationId, kind),
        blocked ? new Date() : null,
      ],
    );
  }

  async function administratorInvitation(organizationId: string, expired: boolean): Promise<string> {
    const id = randomUUID();
    await h.em().execute(
      `insert into "organization_invitations"
         ("id","organization_id","email","organization_role_id","token_hash","expires_at","created_at","updated_at")
       values (?, ?, ?, ?, ?, ?, now(), now())`,
      [
        id,
        organizationId,
        `${id.slice(0, 8)}@revoke-invite.example`,
        await predefinedRoleIdOf(h.em(), organizationId, 'administrator'),
        `h-${id}`,
        new Date(Date.now() + (expired ? -1 : 7) * 24 * 60 * 60 * 1000),
      ],
    );
    return id;
  }

  const revoke = (organizationId: string, invitationId: string) =>
    cradle().commandBus.run(
      makeRevokeOrganizationInvitationCommand(
        { accounts: cradle().customerAccountReadPort },
        { organizationId, invitationId },
      ),
    );

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('an expired administrator invitation is not an outstanding path: the pending one cannot be revoked', async () => {
    const org = await organization();
    await account(org, 'member');
    const pending = await administratorInvitation(org, false);
    await administratorInvitation(org, true);
    await expect(revoke(org, pending)).rejects.toMatchObject({ code: ERROR_CODES.CANNOT_REVOKE_LAST_ADMIN_INVITE });
  });

  it('a blocked administrator is not an active one', async () => {
    const org = await organization();
    await account(org, 'administrator', true);
    const pending = await administratorInvitation(org, false);
    await expect(revoke(org, pending)).rejects.toMatchObject({ code: ERROR_CODES.CANNOT_REVOKE_LAST_ADMIN_INVITE });
  });

  it('another pending administrator invitation is an outstanding path', async () => {
    const org = await organization();
    const first = await administratorInvitation(org, false);
    await administratorInvitation(org, false);
    await expect(revoke(org, first)).resolves.toBeUndefined();
  });
});
