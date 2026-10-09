import { describe, expect, it } from 'vitest';
import type { ModuleCliCommandContext } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { parseUnlockArgs, unlockSignIn } from './unlock-sign-in.js';

function run(
  argv: string[],
  admin: { id: string } | null,
  removed: number,
): Promise<{ code: number; out: string[]; err: string[]; cleared: unknown[]; lookups: unknown[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const cleared: unknown[] = [];
  const lookups: unknown[] = [];
  const ctx = {
    cradle: () => ({
      emFactory: () => ({
        findOne: async (_entity: unknown, where: unknown) => {
          lookups.push(where);
          return admin;
        },
      }),
      admin: {
        handle: {
          authenticationThrottle: {
            describeStore: () => 'redis.internal:6380, database 3',
            clear: async (account: unknown) => {
              cleared.push(account);
              return removed;
            },
          },
        },
      },
    }),
  } as unknown as ModuleContext;
  const context: ModuleCliCommandContext<ModuleContext> = {
    ctx,
    argv,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return unlockSignIn(context).then((code) => ({ code, out, err, cleared, lookups }));
}

describe('admin_users unlock', () => {
  it('folds the address the way sign-in does', () => {
    expect(parseUnlockArgs(['--email= Owner@Example.COM '])).toEqual({ email: 'owner@example.com' });
  });

  it('refuses to run without an address, and clears nothing', async () => {
    const result = await run([], { id: 'a-1' }, 4);
    expect(result.code).toBe(1);
    expect(result.err).toEqual(['Missing required flag: --email=...']);
    expect(result.cleared).toEqual([]);
  });

  it('clears the password and the second-factor counters of the account', async () => {
    const result = await run(['--email=Owner@Example.com'], { id: 'a-1' }, 4);
    expect(result.code).toBe(0);
    expect(result.lookups).toEqual([{ email: 'owner@example.com' }]);
    expect(result.cleared).toEqual([{ email: 'owner@example.com', adminUserId: 'a-1' }]);
    // Which Redis it acted on is said whether or not anything was there.
    expect(result.out[0]).toBe('Redis: redis.internal:6380, database 3');
    expect(result.out.join('\n')).toContain('Cleared the authentication throttle for owner@example.com');
  });

  it('says so when nothing was throttled', async () => {
    const result = await run(['--email=owner@example.com'], { id: 'a-1' }, 0);
    expect(result.out[0]).toBe('Redis: redis.internal:6380, database 3');
    expect(result.out[1]).toContain('Nothing was throttled for owner@example.com in that Redis.');
  });

  it('clears the address counters and says no account has it, for an unknown address', async () => {
    const result = await run(['--email=typo@example.com'], null, 2);
    expect(result.code).toBe(0);
    expect(result.cleared).toEqual([{ email: 'typo@example.com' }]);
    expect(result.out[1]).toBe('No administrator account has the address typo@example.com.');
  });
});
