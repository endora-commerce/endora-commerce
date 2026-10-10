import { afterEach, describe, expect, it } from 'vitest';
import type { PlatformLogger } from '@endora-commerce/platform/kernel';
import { adminModule, type AdminModuleOptions } from './plugin.js';

/**
 * The module's composition reads `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT` and warns when
 * it switches the account-wide limit off. Composed here as the host composes
 * it — `adminModule(options)` — so that "warns on every boot" is held by the
 * composition and not only by the function it calls.
 */
const VARIABLE = 'ADMIN_AUTH_ACCOUNT_WIDE_LIMIT';
const OFF = 'account-wide administrator attempt limit is OFF';

function compose(): string[] {
  const warnings: string[] = [];
  const log: PlatformLogger = {
    info: () => undefined,
    warn: (_obj, message) => {
      warnings.push(String(message));
    },
    error: () => undefined,
  };
  // Composing constructs the services and calls none of them.
  adminModule({ log, redis: {}, emFactory: () => ({}) } as unknown as AdminModuleOptions);
  return warnings;
}

describe('adminModule — the account-wide limit opt-out at composition', () => {
  const before = process.env[VARIABLE];
  afterEach(() => {
    if (before === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = before;
  });

  it('warns on every composition while the variable is `off`', () => {
    process.env[VARIABLE] = 'off';
    expect(compose().filter((message) => message.includes(OFF))).toHaveLength(1);
    expect(compose().filter((message) => message.includes(OFF))).toHaveLength(1);
  });

  it('says nothing when the variable is not set', () => {
    delete process.env[VARIABLE];
    expect(compose()).toEqual([]);
  });

  it('keeps the limit on, and says so, for `OFF`', () => {
    process.env[VARIABLE] = 'OFF';
    const warnings = compose();
    expect(warnings.filter((message) => message.includes(OFF))).toEqual([]);
    expect(warnings.filter((message) => message.includes('stays on'))).toHaveLength(1);
  });
});
