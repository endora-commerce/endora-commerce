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

describe('SettingNoticeRegistry — a provider that fails', () => {
  function throwing(contributorModuleId: string, code: string): SettingNoticeProvider {
    return {
      contributorModuleId,
      codes: [code],
      notice: async () => {
        throw new Error('provider down');
      },
    };
  }

  it('answers the next provider, and logs the failure with its contributor and code', async () => {
    const errors: Array<Record<string, unknown>> = [];
    const registry = new SettingNoticeRegistry(undefined, {
      error: (fields) => {
        errors.push(fields);
      },
    });
    registry.register(throwing('broken', 'x.flag'));
    registry.register(provider('a', 'x.flag'));
    expect(await registry.noticeFor({ code: 'x.flag', ownerModuleId: 'a', value: true })).toEqual({
      code: 'unmet',
      message: 'Not in force.',
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ contributorModuleId: 'broken', settingCode: 'x.flag' });
  });

  it('answers null when the only provider fails', async () => {
    const registry = new SettingNoticeRegistry(undefined, { error: () => undefined });
    registry.register(throwing('broken', 'x.flag'));
    expect(await registry.noticeFor({ code: 'x.flag', ownerModuleId: 'a', value: true })).toBeNull();
  });
});
