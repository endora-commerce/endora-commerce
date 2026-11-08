import { describe, expect, it } from 'vitest';
import type { SettingNoticeProvider } from '@endora-commerce/contracts';
import { SettingNoticeRegistry } from './setting-notices.js';

/**
 * Issue #930 — where the module that declared a setting says that its stored
 * value is not what is in force, so the Settings screen does not show a
 * setting as "on" while it does nothing. The same absent-contributor policy as
 * the write validators: a provider of a module that is off is not asked.
 */
function provider(contributorModuleId: string, code: string): SettingNoticeProvider {
  return {
    contributorModuleId,
    codes: [code],
    notice: async () => ({ code: 'unmet', message: 'Not in force.' }),
  };
}

describe('SettingNoticeRegistry', () => {
  it('answers the first notice a provider for the code gives', async () => {
    const registry = new SettingNoticeRegistry();
    registry.register({ contributorModuleId: 'a', codes: ['x.flag'], notice: async () => null });
    registry.register(provider('a', 'x.flag'));
    registry.register(provider('a', 'x.other'));
    expect(await registry.noticeFor({ code: 'x.flag', ownerModuleId: 'a', value: true })).toEqual({
      code: 'unmet',
      message: 'Not in force.',
    });
    expect(await registry.noticeFor({ code: 'x.none', ownerModuleId: 'a', value: true })).toBeNull();
  });

  it('does not ask a provider whose module is off', async () => {
    const registry = new SettingNoticeRegistry({ presenceOf: (id) => id !== 'a' });
    registry.register(provider('a', 'x.flag'));
    expect(registry.forCode('x.flag')).toEqual([]);
    expect(await registry.noticeFor({ code: 'x.flag', ownerModuleId: 'a', value: true })).toBeNull();
  });
});
