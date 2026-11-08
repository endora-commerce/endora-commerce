import { describe, expect, it } from 'vitest';
import type { MfaEndUnprotectedAdminSessionsOptions } from '@endora-commerce/contracts';
import {
  createAdminEnforcementSettingConfirmation,
  createEndSessionsOnAdminEnforcement,
} from './admin-enforcement-setting-sessions.js';

/**
 * Issue #349, E-349-1 (owner ruling 2026-11-08) — switching
 * `mfa.admin.totp_enforced` on ends the sessions every administrator without a
 * second factor opened without one, as ticking a role's box does for its
 * holders. An administrator session lasts thirty days, so "at the next sign-in"
 * could otherwise mean a month.
 *
 * The write is `settings`'; this module hears of it through
 * `settings.value_changed`, after the commit. The acting administrator keeps
 * the session the change was made from. Without an encryption key the
 * enforcement port ends nothing (issue #948), and that is held by its own test.
 */
const ENFORCED = 'mfa.admin.totp_enforced';

function harness(options: { enforced: boolean; admins?: readonly string[] }) {
  const calls: Array<[readonly string[], MfaEndUnprotectedAdminSessionsOptions]> = [];
  const handle = createEndSessionsOnAdminEnforcement({
    readEnforced: async () => options.enforced,
    liveAdminIds: async () => options.admins ?? ['a1', 'a2'],
    enforcement: {
      endUnprotectedAdminSessions: async (ids, opts) => {
        calls.push([ids, opts]);
        return ids.length;
      },
    },
  });
  return { handle, calls };
}

describe('ending unprotected sessions when mfa.admin.totp_enforced is switched on', () => {
  it('asks to end the unprotected sessions of every live administrator, sparing the acting one', async () => {
    const { handle, calls } = harness({ enforced: true });
    await handle({ settingCode: ENFORCED, actorAdminUserId: 'a1', actorSessionId: 's-actor' });
    expect(calls).toEqual([
      [['a1', 'a2'], { trigger: 'setting_enabled', settingCode: ENFORCED, exceptSessionId: 's-actor' }],
    ]);
  });

  it('spares no session when the write named none', async () => {
    const { handle, calls } = harness({ enforced: true });
    await handle({ settingCode: ENFORCED, actorAdminUserId: null });
    expect(calls).toEqual([[['a1', 'a2'], { trigger: 'setting_enabled', settingCode: ENFORCED }]]);
  });

  // Architect ruling on #967 — a write with no session behind it (a boot
  // reconciler, a seed) has nothing to spare.
  it('spares nobody for a write made with no actor session, as a boot reconciler or a seed makes', async () => {
    const { handle, calls } = harness({ enforced: true });
    await handle({ settingCode: ENFORCED, actorAdminUserId: null, actorSessionId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).not.toHaveProperty('exceptSessionId');
  });

  it('does nothing when the setting was switched off', async () => {
    const { handle, calls } = harness({ enforced: false });
    await handle({ settingCode: ENFORCED, actorAdminUserId: 'a1', actorSessionId: 's-actor' });
    expect(calls).toEqual([]);
  });

  it('does nothing for any other setting', async () => {
    const { handle, calls } = harness({ enforced: true });
    await handle({ settingCode: 'mfa.admin.totp_enabled', actorAdminUserId: 'a1' });
    expect(calls).toEqual([]);
  });

  it('does nothing when there is no administrator', async () => {
    const { handle, calls } = harness({ enforced: true, admins: [] });
    await handle({ settingCode: ENFORCED });
    expect(calls).toEqual([]);
  });
});

/**
 * The Settings screen asks before it saves, as the role screen does: "N
 * administrators … will be signed out". The count is the enforcement port's
 * `countUnprotected` over every live administrator.
 */
describe('the Settings confirmation for switching mfa.admin.totp_enforced on', () => {
  function confirmation(options: { canEnrol?: boolean; unprotected: number }) {
    return createAdminEnforcementSettingConfirmation({
      canEnrolSecondFactor: () => options.canEnrol ?? true,
      liveAdminIds: async () => ['a1', 'a2', 'a3'],
      countUnprotected: async () => options.unprotected,
    });
  }

  it('asks about turning it on, with how many administrators will be signed out', async () => {
    const provider = confirmation({ unprotected: 2 });
    expect(provider.codes).toEqual([ENFORCED]);
    expect(await provider.confirmation!({ code: ENFORCED, ownerModuleId: 'mfa', value: false })).toEqual({
      whenValue: true,
      code: 'signs_out_unprotected',
      message:
        'Administrators who have not set up two-step verification: 2. They will be signed out now ' +
        'and asked to set it up at their next sign-in. Continue?',
      params: { count: 2 },
    });
  });

  it('asks nothing while it is already on', async () => {
    const provider = confirmation({ unprotected: 2 });
    expect(await provider.confirmation!({ code: ENFORCED, ownerModuleId: 'mfa', value: true })).toBeNull();
  });

  it('asks nothing when nobody would be signed out', async () => {
    const provider = confirmation({ unprotected: 0 });
    expect(await provider.confirmation!({ code: ENFORCED, ownerModuleId: 'mfa', value: false })).toBeNull();
  });

  it('asks nothing without an encryption key, where the write is refused anyway', async () => {
    const provider = confirmation({ canEnrol: false, unprotected: 2 });
    expect(await provider.confirmation!({ code: ENFORCED, ownerModuleId: 'mfa', value: false })).toBeNull();
  });

  it('contributes no notice of its own', async () => {
    const provider = confirmation({ unprotected: 2 });
    expect(await provider.notice({ code: ENFORCED, ownerModuleId: 'mfa', value: false })).toBeNull();
  });
});
