import { describe, expect, it } from 'vitest';
import type { SettingsReadPort, SettingsReadResult } from '@endora-commerce/platform/kernel';
import { IDLE_LOGOUT_SETTING_CODE, readIdleLogoutMinutes } from './idle-logout-policy.js';

function settingsAnswering(
  result: SettingsReadResult<unknown> | undefined,
): Pick<SettingsReadPort, 'getMany'> & { calls: Array<[string[], string | null]> } {
  const calls: Array<[string[], string | null]> = [];
  return {
    calls,
    getMany: async (codes, salesChannelId) => {
      calls.push([codes, salesChannelId]);
      return new Map(result === undefined ? [] : [[IDLE_LOGOUT_SETTING_CODE, result]]);
    },
  };
}

describe('readIdleLogoutMinutes', () => {
  it('reads the platform-wide value of admin.idle_logout_minutes', async () => {
    const settings = settingsAnswering({ ok: true, value: 10 });
    expect(await readIdleLogoutMinutes(settings)).toBe(10);
    expect(settings.calls).toEqual([[['admin.idle_logout_minutes'], null]]);
  });

  it('accepts a numeric string, as the settings store may hold one', async () => {
    expect(await readIdleLogoutMinutes(settingsAnswering({ ok: true, value: '15' }))).toBe(15);
  });

  it.each([
    ['an unregistered setting', { ok: false, error: 'not_registered' } as const],
    ['a missing result', undefined],
    ['zero', { ok: true, value: 0 } as const],
    ['a negative number', { ok: true, value: -5 } as const],
    ['a non-numeric value', { ok: true, value: 'soon' } as const],
    ['null', { ok: true, value: null } as const],
  ])('answers null for %s, leaving the default to the Admin UI', async (_label, result) => {
    expect(await readIdleLogoutMinutes(settingsAnswering(result))).toBeNull();
  });

  it('does not swallow a failure of the settings store', async () => {
    const settings: Pick<SettingsReadPort, 'getMany'> = {
      getMany: async () => {
        throw new Error('store unavailable');
      },
    };
    await expect(readIdleLogoutMinutes(settings)).rejects.toThrow('store unavailable');
  });
});
