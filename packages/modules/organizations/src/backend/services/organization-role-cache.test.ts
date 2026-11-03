import { describe, expect, it, vi } from 'vitest';
import {
  ORGANIZATION_ROLE_CACHE_MAX_AGE_MS,
  ORGANIZATION_ROLES_CHANGED_CHANNEL,
  OrganizationRoleCache,
  type CachedOrganizationRoles,
} from './organization-role-cache.js';
import type { Command } from '@endora-commerce/platform/commands';
import { runRoleCommandAndAnnounce } from './organization-role-service.js';

/**
 * `OrganizationRoleCache` (`specs/170-organization-roles/` WP-02a, T026;
 * research R-16; `contracts/organization-permission-port.md` §4;
 * `contracts/commands-audit-events.md` §5; FR-080, FR-081, FR-082).
 *
 * Written after `custom-field-definitions-cache.test.ts`: an injected clock, an
 * injected loader and a fake publisher, so every obligation is asserted without
 * Redis or a database.
 */

const ORG_A = '00000000-0000-4000-8000-00000000a001';
const ORG_B = '00000000-0000-4000-8000-00000000a002';

function rolesVersion(n: number): CachedOrganizationRoles {
  return new Map([
    [`role-${n}`, { id: `role-${n}`, kind: 'member' as const, permissions: new Set<string>(), memberDefaultsOffered: new Set<string>() }],
  ]);
}

function harness(options: { publish?: (channel: string, message: string) => Promise<unknown>; capacity?: number } = {}) {
  let clock = 1_000;
  const loads: string[] = [];
  let version = 0;
  const loader = vi.fn(async (organizationId: string) => {
    loads.push(organizationId);
    version += 1;
    return rolesVersion(version);
  });
  const publish = vi.fn(options.publish ?? (async () => 1));
  const logWarn = vi.fn();
  const cache = new OrganizationRoleCache({
    loader,
    publisher: { publish },
    now: () => clock,
    logWarn,
    ...(options.capacity !== undefined ? { capacity: options.capacity } : {}),
  });
  return {
    cache,
    loads,
    publish,
    logWarn,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

describe('OrganizationRoleCache', () => {
  it('serves a repeat read from memory (FR-080)', async () => {
    const h = harness();
    await h.cache.get(ORG_A);
    await h.cache.get(ORG_A);
    expect(h.loads).toEqual([ORG_A]);
  });

  it('the writing process sees its own change immediately, and announces it (FR-081)', async () => {
    const h = harness();
    const before = await h.cache.get(ORG_A);
    await h.cache.dropAndAnnounce(ORG_A);
    const after = await h.cache.get(ORG_A);
    expect(after).not.toBe(before);
    expect(h.loads).toEqual([ORG_A, ORG_A]);
    expect(h.publish).toHaveBeenCalledWith(ORGANIZATION_ROLES_CHANGED_CHANNEL, JSON.stringify({ organizationId: ORG_A }));
  });

  it('another process drops exactly the announced Organization', async () => {
    const h = harness();
    await h.cache.get(ORG_A);
    await h.cache.get(ORG_B);
    h.cache.handleMessage(JSON.stringify({ organizationId: ORG_A }));
    await h.cache.get(ORG_A);
    await h.cache.get(ORG_B);
    expect(h.loads).toEqual([ORG_A, ORG_B, ORG_A]);
  });

  it('a malformed announcement drops everything rather than nothing (fail safe)', async () => {
    const h = harness();
    await h.cache.get(ORG_A);
    await h.cache.get(ORG_B);
    h.cache.handleMessage('not-json');
    await h.cache.get(ORG_A);
    await h.cache.get(ORG_B);
    expect(h.loads).toHaveLength(4);
  });

  it('a lost announcement is bounded by 30 s (FR-081)', async () => {
    const h = harness();
    expect(ORGANIZATION_ROLE_CACHE_MAX_AGE_MS).toBe(30_000);
    await h.cache.get(ORG_A);
    h.advance(ORGANIZATION_ROLE_CACHE_MAX_AGE_MS - 1);
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(1);
    h.advance(2);
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(2);
  });

  it('a fill that raced a drop is answered to its caller and not stored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const cache = new OrganizationRoleCache({
      loader: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return rolesVersion(calls);
      },
    });
    const racing = cache.get(ORG_A);
    cache.invalidateLocal(ORG_A);
    release();
    expect([...(await racing).keys()]).toEqual(['role-1']);
    await cache.get(ORG_A);
    expect(calls).toBe(2);
  });

  it('Redis unreachable: the publish failure is logged and swallowed, and reads degrade to the source (FR-082)', async () => {
    const h = harness({ publish: async () => Promise.reject(new Error('ECONNREFUSED')) });
    await h.cache.get(ORG_A);
    await expect(h.cache.dropAndAnnounce(ORG_A)).resolves.toBeUndefined();
    expect(h.logWarn).toHaveBeenCalled();
    await h.cache.get(ORG_A);
    expect(h.loads).toEqual([ORG_A, ORG_A]);
  });

  it('never falls open: a loader failure is the caller’s error, and nothing is stored', async () => {
    let fail = true;
    const cache = new OrganizationRoleCache({
      loader: async () => {
        if (fail) throw new Error('database down');
        return rolesVersion(1);
      },
    });
    await expect(cache.get(ORG_A)).rejects.toThrow('database down');
    fail = false;
    expect((await cache.get(ORG_A)).size).toBe(1);
  });

  it('is bounded: the least recently used Organization is evicted past the cap', async () => {
    const h = harness({ capacity: 2 });
    await h.cache.get('org-1');
    await h.cache.get('org-2');
    await h.cache.get('org-1'); // touch: org-2 is now the least recently used
    await h.cache.get('org-3');
    await h.cache.get('org-1');
    expect(h.loads).toEqual(['org-1', 'org-2', 'org-3']);
    await h.cache.get('org-2');
    expect(h.loads).toEqual(['org-1', 'org-2', 'org-3', 'org-2']);
  });

  it('subscribes once to its channel and ignores every other channel', async () => {
    const h = harness();
    const listeners: Array<(channel: string, message: string) => void> = [];
    const subscriber = {
      subscribe: vi.fn(async () => 1),
      on: vi.fn((_event: 'message', listener: (channel: string, message: string) => void) => {
        listeners.push(listener);
        return subscriber;
      }),
    };
    await h.cache.start(subscriber);
    await h.cache.start(subscriber);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith(ORGANIZATION_ROLES_CHANGED_CHANNEL);
    await h.cache.get(ORG_A);
    listeners[0]!('b2b:custom_fields:definitions-changed', JSON.stringify({ organizationId: ORG_A }));
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(1);
    listeners[0]!(ORGANIZATION_ROLES_CHANGED_CHANNEL, JSON.stringify({ organizationId: ORG_A }));
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(2);
  });
});

describe('the drop follows the commit (commands-audit-events.md §5)', () => {
  it('drops and announces after a Command resolves', async () => {
    const h = harness();
    await h.cache.get(ORG_A);
    const bus = {
      run: async <R>(command: Command<R>): Promise<R> =>
        (await command.run({ em: {} as never, actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' } })).result,
    };
    const result = await runRoleCommandAndAnnounce(bus, h.cache, ORG_A, {
      action: 'organization_role.create',
      objectType: 'organization',
      objectId: ORG_A,
      run: async () => ({ result: 'done' }),
    });
    expect(result).toBe('done');
    expect(h.publish).toHaveBeenCalledTimes(1);
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(2);
  });

  it('a rolled-back Command drops nothing', async () => {
    const h = harness();
    await h.cache.get(ORG_A);
    await expect(
      runRoleCommandAndAnnounce(
        {
          run: async <R>(): Promise<R> => {
            throw new Error('rolled back');
          },
        },
        h.cache,
        ORG_A,
        { action: 'organization_role.update', objectType: 'organization', objectId: ORG_A, run: async () => ({ result: null }) },
      ),
    ).rejects.toThrow('rolled back');
    expect(h.publish).not.toHaveBeenCalled();
    await h.cache.get(ORG_A);
    expect(h.loads).toHaveLength(1);
  });
});
