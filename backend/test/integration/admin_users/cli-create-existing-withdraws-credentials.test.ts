import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { cliCommands } from '@endora-commerce/mod-admin-users';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Session } from '../../helpers/package-entities.js';

/**
 * `admin_users create` run again for an account that already exists replaces
 * its password. That is a credential change made by somebody else, exactly as
 * a peer reset is, so it withdraws what the old password had been exchanged
 * for — the account's sessions and the logins it had begun — and leaves an
 * audit row. It used to do neither.
 *
 * The command is driven through the module's own `cliCommands` declaration,
 * over the harness's composed container.
 */

const EMAIL = 'cli-rerun@example.com';
const P1 = 'cli-first-strong-pass-123!';
const P2 = 'cli-second-strong-pass-456!';
const MFA_SETTINGS = ['mfa.admin.totp_enabled', 'mfa.admin.totp_enforced'];

describe('admin_users create — re-run on an existing account', () => {
  let h: BackendServerHandle;

  async function runCreate(password: string): Promise<{ code: number; lines: string[] }> {
    const lines: string[] = [];
    const ctx = {
      module: { id: 'admin_users' },
      cradle: () => h.container.cradle,
    } as unknown as ModuleContext;
    const command = cliCommands.find((c) => c.name === 'create')!;
    const code = await command.run({
      ctx,
      argv: [`--email=${EMAIL}`, `--password=${password}`, '--first-name=Cli', '--last-name=Rerun'],
      out: (line) => lines.push(line),
      err: (line) => lines.push(line),
    });
    return { code: code ?? 0, lines };
  }

  async function login(password: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password },
    });
  }

  async function sessionCookie(password: string): Promise<string> {
    const res = await login(password);
    expect(res.statusCode).toBe(200);
    return (res.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
    )!.value;
  }

  async function meStatus(cookie: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
    });
    return res.statusCode;
  }

  async function setMfa(value: boolean): Promise<void> {
    for (const code of MFA_SETTINGS) {
      await h.settings.adminService.setValueForAllChannels(code, value, null, {
        actorAdminUserId: null,
      });
    }
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await setMfa(false);
    await teardownBackendServer(h);
  });

  it('creating a new account writes no password-change audit row', async () => {
    const created = await runCreate(P1);
    expect(created.lines.join('\n')).toContain('Created admin');
    expect(created.code).toBe(0);
    expect(await h.em().count(AuditLogEntry, { action: 'admin_user.change_password' })).toBe(0);
    expect(await meStatus(await sessionCookie(P1))).toBe(200);
  });

  it('withdraws the sessions and pending logins of the existing account, and audits it', async () => {
    const first = await sessionCookie(P1);
    const second = await sessionCookie(P1);
    expect(await meStatus(first)).toBe(200);
    expect(await meStatus(second)).toBe(200);

    // A login begun with the old password and not finished: a setup ticket.
    await setMfa(true);
    const begun = await login(P1);
    const { status, setupTicket } = (begun.json() as { data: Record<string, string> }).data;
    expect(status).toBe('mfaSetupRequired');

    const rerun = await runCreate(P2);
    expect(rerun.lines.join('\n')).toContain('Updated existing admin');
    expect(rerun.code).toBe(0);

    expect(await meStatus(first)).toBe(401);
    expect(await meStatus(second)).toBe(401);
    const stale = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/begin',
      payload: { setupTicket },
    });
    expect(stale.statusCode).toBe(400);
    expect((stale.json() as { error: { code: string } }).error.code).toBe('MFA_INVALID_CHALLENGE');

    await setMfa(false);
    expect((await login(P1)).statusCode).toBe(401);
    expect(await meStatus(await sessionCookie(P2))).toBe(200);

    const rows = await h.em().find(AuditLogEntry, { action: 'admin_user.change_password' });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // No administrator acted: the command runs from a shell on the host.
    expect(row.actorAdminUserId ?? null).toBeNull();
    expect(row.stateAfter).toMatchObject({ email: EMAIL, via: 'cli' });
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(P1);
    expect(dump).not.toContain(P2);
    expect(dump).not.toContain('argon2');
    expect(await h.em().count(Session, { id: { $ne: null }, adminUserId: row.objectId })).toBe(1);
  });
});
