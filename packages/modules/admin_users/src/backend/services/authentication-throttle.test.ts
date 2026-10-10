import { describe, expect, it } from 'vitest';
import type { AuditPort, PlatformLogger } from '@endora-commerce/platform/kernel';
import {
  ABANDONED_AFTER_SECONDS,
  ACCOUNT_POLICY,
  ADDRESS_POLICY,
  AuthenticationThrottle,
  addressOrigin,
  type AdminCredentialState,
  type AttemptCounterStore,
  accountWideLimitFromEnvironment,
} from './authentication-throttle.js';

/**
 * What the class does around its Redis scripts: which counters an attempt
 * names, what a refusal carries, how an attempt is settled, what is reported,
 * and what happens when the store does not answer. The counting itself runs
 * inside Redis and is asserted through the real routes in
 * `backend/test/contract/admin_users/authentication-throttle.test.ts`.
 */
type Script = 'take' | 'fail' | 'release';

interface Call {
  script: Script;
  keys: string[];
  args: string[];
}

function scriptOf(source: string): Script {
  if (source.includes('ZADD')) return 'take';
  return source.includes('mask') ? 'fail' : 'release';
}

const ADMIN: AdminCredentialState = {
  adminUserId: 'a-1',
  email: 'operator@example.test',
  passwordHash: '$argon2id$stored-hash',
};

function harness(
  answers: { take?: [number, number] | Promise<[number, number]>; fail?: [number, number] } = {},
  options: {
    admin?: AdminCredentialState | null;
    storeDeadlineMs?: number;
    accountWideLimit?: boolean;
  } = {},
): {
  throttle: AuthenticationThrottle;
  calls: () => Call[];
  audits: () => Array<Record<string, unknown>>;
  warnings: () => object[];
  errors: () => object[];
  credentialReads: () => string[];
  setAdmin: (admin: AdminCredentialState | null) => void;
} {
  const calls: Call[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const warnings: object[] = [];
  const errors: object[] = [];
  const credentialReads: string[] = [];
  let admin = options.admin === undefined ? ADMIN : options.admin;
  const redis: AttemptCounterStore = {
    eval: async (source, numberOfKeys, ...rest) => {
      const script = scriptOf(source);
      calls.push({ script, keys: rest.slice(0, numberOfKeys), args: rest.slice(numberOfKeys) });
      if (script === 'take') return answers.take ?? [1, 0];
      if (script === 'fail') return answers.fail ?? [0, 0];
      return 1;
    },
    scan: async () => ['0', []],
    del: async (...keys) => keys.length,
  };
  const auditLog = {
    record: async (input: Record<string, unknown>) => {
      audits.push(input);
    },
  } as unknown as AuditPort;
  const log: PlatformLogger = {
    info: () => undefined,
    warn: (obj) => {
      warnings.push(obj);
    },
    error: (obj) => {
      errors.push(obj);
    },
  };
  return {
    throttle: new AuthenticationThrottle({
      redis,
      auditLog,
      log,
      now: () => 1_000_000,
      credentialOf: async (adminUserId) => {
        credentialReads.push(adminUserId);
        return admin && admin.adminUserId === adminUserId ? admin : null;
      },
      ...(options.storeDeadlineMs === undefined ? {} : { storeDeadlineMs: options.storeDeadlineMs }),
      ...(options.accountWideLimit === undefined ? {} : { accountWideLimit: options.accountWideLimit }),
    }),
    calls: () => calls,
    audits: () => audits,
    warnings: () => warnings,
    errors: () => errors,
    credentialReads: () => credentialReads,
    setAdmin: (next) => {
      admin = next;
    },
  };
}

const ATTEMPT = { factor: 'password', account: 'operator@example.test', ip: '203.0.113.9' } as const;
const policyArgs = (policy: typeof ACCOUNT_POLICY): string[] => [
  String(policy.threshold),
  String(policy.windowSeconds * 1000),
  String(policy.baseDelaySeconds * 1000),
  String(policy.maxDelaySeconds * 1000),
];

describe('AuthenticationThrottle — the counters an attempt is held to', () => {
  it('holds a stranger to the account and to the address, and keeps both out of the key', async () => {
    const h = harness();
    await h.throttle.verify(ATTEMPT, async () => ({ ok: false }));

    const take = h.calls()[0]!;
    expect(take.script).toBe('take');
    expect(take.keys).toHaveLength(4);
    expect(take.keys[0]).toMatch(/^admin-auth-throttle:v1:password:\{[0-9a-f]{64}\}:account$/);
    expect(take.keys[1]).toBe(`${take.keys[0]}:unsettled`);
    expect(take.keys[2]).toMatch(
      /^admin-auth-throttle:v1:password:\{[0-9a-f]{64}\}:address:[0-9a-f]{64}$/,
    );
    expect(take.keys[3]).toBe(`${take.keys[2]}:unsettled`);
    expect(take.keys.join(' ')).not.toContain('operator');
    expect(take.keys.join(' ')).not.toContain('203.0.113.9');
    const [now, attemptId, abandonedAfter, ...policies] = take.args;
    expect(now).toBe('1000000');
    expect(attemptId).toMatch(/^[0-9a-f]{24}$/);
    expect(abandonedAfter).toBe(String(ABANDONED_AFTER_SECONDS * 1000));
    expect(policies).toEqual([...policyArgs(ACCOUNT_POLICY), ...policyArgs(ADDRESS_POLICY)]);
    // No row is read for a request that carries no known-device value.
    expect(h.credentialReads()).toEqual([]);
  });

  it('counts the account alone when the caller has no address', async () => {
    const h = harness();
    await h.throttle.verify({ factor: 'second_factor', account: 'a-1' }, async () => ({ ok: false }));

    expect(h.calls()[0]!.keys).toHaveLength(2);
    expect(h.calls()[0]!.keys[0]).toMatch(/:second_factor:\{[0-9a-f]{64}\}:account$/);
  });

  it('keeps a password and a second factor on separate counters', async () => {
    const h = harness();
    await h.throttle.verify({ factor: 'password', account: 'same' }, async () => ({ ok: false }));
    await h.throttle.verify({ factor: 'second_factor', account: 'same' }, async () => ({ ok: false }));

    expect(h.calls()[0]!.keys[0]).not.toBe(h.calls()[2]!.keys[0]);
  });

  it('counts every host of one IPv6 /64 as one origin', async () => {
    const h = harness();
    await h.throttle.verify({ ...ATTEMPT, ip: '2001:db8:1:2::1' }, async () => ({ ok: false }));
    await h.throttle.verify({ ...ATTEMPT, ip: '2001:db8:1:2:ffff:ffff:ffff:fffe' }, async () => ({ ok: false }));
    await h.throttle.verify({ ...ATTEMPT, ip: '2001:db8:1:3::1' }, async () => ({ ok: false }));

    const address = (index: number): string => h.calls().filter((c) => c.script === 'take')[index]!.keys[2]!;
    expect(address(1)).toBe(address(0));
    expect(address(2)).not.toBe(address(0));
  });
});

describe('addressOrigin', () => {
  it.each([
    ['203.0.113.9', '203.0.113.9'],
    ['::ffff:203.0.113.9', '203.0.113.9'],
    ['::FFFF:cb00:7109', '203.0.113.9'],
    ['0:0:0:0:0:ffff:cb00:7109', '203.0.113.9'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::203.0.113.9', '64:ff9b:0:0::/64'],
    ['not-an-address', 'not-an-address'],
  ])('%s is counted as %s', (ip, origin) => {
    expect(addressOrigin(ip)).toBe(origin);
  });
});

describe('AuthenticationThrottle — a known device', () => {
  async function issued(h: ReturnType<typeof harness>): Promise<string> {
    const value = await h.throttle.issueKnownDevice('a-1');
    if (value === null) throw new Error('expected a known-device value');
    return value;
  }

  it('is held to its own counter and to neither the account nor the address', async () => {
    const h = harness();
    const knownDevice = await issued(h);
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false }));

    const take = h.calls()[0]!;
    expect(take.keys).toHaveLength(2);
    expect(take.keys[0]).toMatch(/^admin-auth-throttle:v1:password:\{[0-9a-f]{64}\}:device:[0-9a-f]{64}$/);
    expect(take.args.slice(3)).toEqual(policyArgs(ADDRESS_POLICY));
  });

  it('gives every device its own id, so one device cannot use up another one’s budget', async () => {
    const h = harness();
    const first = await issued(h);
    const second = await issued(h);
    await h.throttle.verify({ ...ATTEMPT, knownDevice: first }, async () => ({ ok: false }));
    await h.throttle.verify({ ...ATTEMPT, knownDevice: second }, async () => ({ ok: false }));

    const takes = h.calls().filter((c) => c.script === 'take');
    expect(takes[0]!.keys[0]).not.toBe(takes[1]!.keys[0]);
  });

  it('is known for the second factor too, where the account is the administrator id', async () => {
    const h = harness();
    const knownDevice = await issued(h);
    await h.throttle.verify(
      { factor: 'second_factor', account: 'a-1', knownDevice },
      async () => ({ ok: false }),
    );
    expect(h.calls()[0]!.keys[0]).toContain(':device:');
  });

  it('is a stranger for any other account', async () => {
    const h = harness();
    const knownDevice = await issued(h);
    await h.throttle.verify(
      { ...ATTEMPT, account: 'somebody-else@example.test', knownDevice },
      async () => ({ ok: false }),
    );
    expect(h.calls()[0]!.keys).toHaveLength(4);
    expect(h.calls()[0]!.keys[0]).toMatch(/:account$/);
  });

  it('stops being known when the password changes', async () => {
    const h = harness();
    const knownDevice = await issued(h);
    h.setAdmin({ ...ADMIN, passwordHash: '$argon2id$a-new-hash' });
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false }));

    expect(h.calls()[0]!.keys[0]).toMatch(/:account$/);
  });

  it('stops being known when the account is no longer active', async () => {
    const h = harness();
    const knownDevice = await issued(h);
    h.setAdmin(null);
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false }));

    expect(h.calls()[0]!.keys[0]).toMatch(/:account$/);
  });

  it.each([
    ['empty', ''],
    ['not four parts', 'v1.a-1.device'],
    ['five parts', 'v1.a-1.device.stamp.more'],
    ['another version', 'v0.a-1.device.stamp'],
    ['a stamp nobody issued', 'v1.a-1.device.0123456789abcdef0123456789abcdef'],
  ])('treats a value that is %s as a stranger', async (_label, knownDevice) => {
    const h = harness();
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false }));
    expect(h.calls()[0]!.keys[0]).toMatch(/:account$/);
  });

  it('mints nothing for an account that is gone or inactive', async () => {
    const h = harness({}, { admin: null });
    await expect(h.throttle.issueKnownDevice('a-1')).resolves.toBeNull();
  });

  it('does not put the password hash in the value', async () => {
    const h = harness();
    expect(await issued(h)).not.toContain('stored-hash');
  });
});

describe('AuthenticationThrottle — taking and settling', () => {
  it('refuses with 429, Retry-After and the seconds, without running the check', async () => {
    const h = harness({ take: [0, 59_001] });
    let checked = false;

    await expect(
      h.throttle.verify(ATTEMPT, async () => {
        checked = true;
        return { ok: true, adminUserId: 'a-1' };
      }),
    ).rejects.toMatchObject({
      statusCode: 429,
      code: 'ADMIN_AUTHENTICATION_THROTTLED',
      details: { retryAfterSeconds: 60 },
      headers: { 'Retry-After': '60' },
    });
    expect(checked).toBe(false);
    expect(h.calls().map((c) => c.script)).toEqual(['take']);
    expect(h.audits()).toEqual([]);
    expect(h.warnings()).toEqual([]);
  });

  it('asks for one second when every slot is held by an attempt still being verified', async () => {
    const h = harness({ take: [0, 0] });
    let checked = false;

    await expect(
      h.throttle.verify(ATTEMPT, async () => {
        checked = true;
        return { ok: true };
      }),
    ).rejects.toMatchObject({ statusCode: 429, headers: { 'Retry-After': '1' } });
    expect(checked).toBe(false);
  });

  it('takes the attempt before it runs the check', async () => {
    const h = harness();
    const order: string[] = [];
    await h.throttle.verify(ATTEMPT, async () => {
      order.push(`check after ${h.calls().map((c) => c.script).join(',')}`);
      return { ok: true };
    });
    expect(order).toEqual(['check after take']);
  });

  it('gives the slot back and forgets the failures on a success', async () => {
    const h = harness();
    const ok = await h.throttle.verify(ATTEMPT, async () => ({ ok: true, adminUserId: 'a-1' }));

    expect(ok).toBe(true);
    const [take, release] = h.calls();
    expect(release!.script).toBe('release');
    expect(release!.keys).toEqual(take!.keys);
    expect(release!.args).toEqual([take!.args[1], '1']);
    expect(h.audits()).toEqual([]);
    expect(h.warnings()).toEqual([]);
  });

  it('settles a wrong credential as a failure, under the id it was taken with', async () => {
    const h = harness();
    const ok = await h.throttle.verify(ATTEMPT, async () => ({ ok: false, adminUserId: 'a-1' }));

    expect(ok).toBe(false);
    const [take, fail] = h.calls();
    expect(fail!.script).toBe('fail');
    expect(fail!.keys).toEqual(take!.keys);
    expect(fail!.args.slice(0, 2)).toEqual(['1000000', take!.args[1]]);
    expect(fail!.args.slice(2)).toEqual([...policyArgs(ACCOUNT_POLICY), ...policyArgs(ADDRESS_POLICY)]);
    // No delay started, so nothing is written anywhere.
    expect(h.audits()).toEqual([]);
    expect(h.warnings()).toEqual([]);
  });

  it('withdraws the attempt, counting nothing, when the check throws', async () => {
    const h = harness();
    const failure = new Error('database is away');

    await expect(
      h.throttle.verify(ATTEMPT, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    const [take, release] = h.calls();
    expect(release!.script).toBe('release');
    expect(release!.args).toEqual([take!.args[1], '0']);
  });

  it('audits and logs the failure that starts a delay for the address', async () => {
    const h = harness({ fail: [60_000, 2] });
    await h.throttle.verify(ATTEMPT, async () => ({ ok: false, adminUserId: 'a-1' }));

    expect(h.audits()).toEqual([
      {
        action: 'admin_user.authentication_throttled',
        objectType: 'admin_user',
        objectId: 'a-1',
        stateAfter: { factor: 'password', scope: 'address', retryAfterSeconds: 60 },
        ipAddress: '203.0.113.9',
      },
    ]);
    expect(h.warnings()).toHaveLength(1);
  });

  it('reports the account when its counter started the delay, alone or with the address', async () => {
    for (const mask of [1, 3]) {
      const h = harness({ fail: [120_000, mask] });
      await h.throttle.verify(ATTEMPT, async () => ({ ok: false, adminUserId: 'a-1' }));

      expect(h.audits()[0]!['stateAfter']).toEqual({
        factor: 'password',
        scope: 'account',
        retryAfterSeconds: 120,
      });
    }
  });

  it('reports the device when a known device used up its own budget', async () => {
    const h = harness({ fail: [60_000, 1] });
    const knownDevice = (await h.throttle.issueKnownDevice('a-1'))!;
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false, adminUserId: 'a-1' }));

    expect(h.audits()[0]!['stateAfter']).toMatchObject({ scope: 'device' });
  });

  it('logs, and writes no audit row, when the address belongs to no account', async () => {
    const h = harness({ fail: [60_000, 2] });
    await h.throttle.verify(ATTEMPT, async () => ({ ok: false }));

    expect(h.audits()).toEqual([]);
    expect(h.warnings()).toEqual([
      {
        factor: 'password',
        scope: 'address',
        retryAfterSeconds: 60,
        accountKnown: false,
        ip: '203.0.113.9',
      },
    ]);
  });
});

describe('AuthenticationThrottle — the store does not answer', () => {
  it('refuses with 503 after the deadline instead of waiting, without running the check', async () => {
    let admit: (answer: [number, number]) => void = () => undefined;
    const pending = new Promise<[number, number]>((resolve) => {
      admit = resolve;
    });
    const h = harness({ take: pending }, { storeDeadlineMs: 20 });
    let checked = false;

    const started = Date.now();
    await expect(
      h.throttle.verify(ATTEMPT, async () => {
        checked = true;
        return { ok: true };
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'ADMIN_AUTHENTICATION_UNAVAILABLE',
      headers: { 'Retry-After': '5' },
    });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(checked).toBe(false);
    expect(h.errors()).toHaveLength(1);

    // The store comes back and admits the attempt nobody is waiting for: it
    // is withdrawn, so the outage leaves nothing counted against the account.
    admit([1, 0]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const [take, release] = h.calls();
    expect(release).toMatchObject({ script: 'release', args: [take!.args[1], '0'] });
  });

  it('refuses with 503 when the store rejects the command', async () => {
    const h = harness({ take: Promise.reject(new Error('READONLY')) });

    await expect(h.throttle.verify(ATTEMPT, async () => ({ ok: true }))).rejects.toMatchObject({
      statusCode: 503,
      code: 'ADMIN_AUTHENTICATION_UNAVAILABLE',
    });
  });
});

describe('AuthenticationThrottle — clear', () => {
  it('removes every key of the account, for both factors, and records who it was for', async () => {
    const scans: string[] = [];
    const deleted: string[][] = [];
    const audits: Array<Record<string, unknown>> = [];
    const throttle = new AuthenticationThrottle({
      redis: {
        eval: async () => 1,
        scan: async (cursor, _match, pattern) => {
          scans.push(`${cursor} ${pattern}`);
          // Two pages for the first pattern, one for the second.
          if (pattern.includes(':password:') && cursor === '0') return ['7', [`${pattern}#1`]];
          return ['0', [`${pattern}#2`]];
        },
        del: async (...keys) => {
          deleted.push(keys);
          return keys.length;
        },
      },
      auditLog: {
        record: async (input: Record<string, unknown>) => {
          audits.push(input);
        },
      } as unknown as AuditPort,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      credentialOf: async () => null,
    });

    const removed = await throttle.clear({ email: 'operator@example.test', adminUserId: 'a-1' });

    expect(removed).toBe(3);
    expect(scans).toHaveLength(3);
    expect(scans[0]).toMatch(/^0 admin-auth-throttle:v1:password:\{[0-9a-f]{64}\}:\*$/);
    expect(scans[1]).toMatch(/^7 admin-auth-throttle:v1:password:/);
    expect(scans[2]).toMatch(/^0 admin-auth-throttle:v1:second_factor:\{[0-9a-f]{64}\}:\*$/);
    expect(deleted).toHaveLength(3);
    expect(audits).toEqual([
      {
        actorAdminUserId: null,
        action: 'admin_user.authentication_throttle_cleared',
        objectType: 'admin_user',
        objectId: 'a-1',
        stateAfter: { via: 'cli', removed: 3 },
      },
    ]);
  });
});

describe('AuthenticationThrottle — describeStore', () => {
  const describeWith = (options: AttemptCounterStore['options']): string =>
    new AuthenticationThrottle({
      redis: {
        eval: async () => 1,
        scan: async () => ['0', []],
        del: async () => 0,
        ...(options === undefined ? {} : { options }),
      },
      auditLog: {} as AuditPort,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      credentialOf: async () => null,
    }).describeStore();

  it('names the host, the port and the database index', () => {
    expect(describeWith({ host: 'redis.internal', port: 6380, db: 3 })).toBe(
      'redis.internal:6380, database 3',
    );
  });

  it('names the socket for a client connected by path', () => {
    expect(describeWith({ path: '/run/redis.sock', db: 1 })).toBe('/run/redis.sock, database 1');
  });

  it('says nothing of a password or a username the client holds', () => {
    const described = describeWith({
      host: 'redis.internal',
      port: 6379,
      db: 0,
      ...({ password: 'a-secret', username: 'an-account' } as object),
    });
    expect(described).toBe('redis.internal:6379, database 0');
  });

  it('does not invent an address for a store that reports none', () => {
    expect(describeWith(undefined)).toBe('an unidentified Redis');
  });
});

describe('AuthenticationThrottle — the account-wide limit switched off for the instance', () => {
  it('holds a stranger’s password to the address alone', async () => {
    const h = harness({}, { accountWideLimit: false });
    await h.throttle.verify(ATTEMPT, async () => ({ ok: false }));

    const take = h.calls()[0]!;
    expect(take.keys).toHaveLength(2);
    expect(take.keys[0]).toMatch(/:password:\{[0-9a-f]{64}\}:address:[0-9a-f]{64}$/);
    expect(take.args.slice(3)).toEqual(policyArgs(ADDRESS_POLICY));
  });

  it('still counts the account when the caller has no address, so no attempt goes uncounted', async () => {
    const h = harness({}, { accountWideLimit: false });
    await h.throttle.verify({ factor: 'password', account: 'operator@example.test' }, async () => ({
      ok: false,
    }));

    expect(h.calls()[0]!.keys).toHaveLength(2);
    expect(h.calls()[0]!.keys[0]).toMatch(/:password:\{[0-9a-f]{64}\}:account$/);
  });

  it('leaves the second factor on both counters', async () => {
    const h = harness({}, { accountWideLimit: false });
    await h.throttle.verify(
      { factor: 'second_factor', account: 'a-1', ip: '203.0.113.9' },
      async () => ({ ok: false }),
    );

    const take = h.calls()[0]!;
    expect(take.keys).toHaveLength(4);
    expect(take.keys[0]).toMatch(/:second_factor:\{[0-9a-f]{64}\}:account$/);
  });

  it('leaves a known device on its own counter', async () => {
    const h = harness({}, { accountWideLimit: false });
    const knownDevice = (await h.throttle.issueKnownDevice('a-1'))!;
    await h.throttle.verify({ ...ATTEMPT, knownDevice }, async () => ({ ok: false }));

    expect(h.calls()[0]!.keys).toHaveLength(2);
    expect(h.calls()[0]!.keys[0]).toMatch(/:device:[0-9a-f]{64}$/);
  });
});

describe('accountWideLimitFromEnvironment', () => {
  function logs(): { log: PlatformLogger; warnings: string[] } {
    const warnings: string[] = [];
    return {
      warnings,
      log: {
        info: () => undefined,
        warn: (_obj, message) => {
          warnings.push(String(message));
        },
        error: () => undefined,
      },
    };
  }

  it('is on, silently, when the variable is not set or says on', () => {
    for (const value of [undefined, '', 'on']) {
      const { log, warnings } = logs();
      expect(accountWideLimitFromEnvironment(value, log)).toBe(true);
      expect(warnings).toEqual([]);
    }
  });

  it('is off only for `off`, and says so every time it is read', () => {
    const { log, warnings } = logs();
    expect(accountWideLimitFromEnvironment('off', log)).toBe(false);
    expect(accountWideLimitFromEnvironment(' OFF ', log)).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('account-wide administrator attempt limit is OFF');
    expect(warnings[0]).toContain('demo instances with published credentials');
  });

  it('stays on, with a warning, for a value it does not know', () => {
    for (const value of ['false', '0', 'disabled']) {
      const { log, warnings } = logs();
      expect(accountWideLimitFromEnvironment(value, log)).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ADMIN_AUTH_ACCOUNT_WIDE_LIMIT');
    }
  });
});
