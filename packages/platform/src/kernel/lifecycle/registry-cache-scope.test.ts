import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ModuleRegistryCache,
  STATE_CHANGED_CHANNEL,
} from './registry-cache.js';
import { getCurrentPlatformScope, openPlatformScopeCount } from '../scope.js';
import {
  setEscapeHatchAuditSink,
  type EscapeHatchAuditRecord,
} from '../../tenancy/escape-hatch.js';
import { orgFilterCond, customerFilterCond } from '../../tenancy/filters.js';
import { getTenantContext, runWithoutTenantContext } from '../../tenancy/tenant-context.js';

/**
 * Issue #235 — the pub/sub refresh runs inside a scope, like the timer beside it.
 *
 * `registry-cache.ts` makes the same `refreshFromDb` call from two callbacks
 * that each have no caller to inherit an async context from: the Redis
 * `'message'` handler and the degraded-mode `setInterval`. Only the second one
 * opened a scope, and `check:entry-scope` is file-level by design — it asks
 * whether the file names a sanctioned entry function, never how many entry
 * points that file has — so the file reported `scoped` on the strength of the
 * timer while the handler above it established nothing.
 *
 * The assertion that carries the weight is not "a scope exists" but **"the scope
 * adds no predicate"**: `ModuleRegistration` and `Setting` are both
 * `@GlobalEntity()`, so the absent scope costs nothing *today*. That is an
 * accident of entity classification, and the test has to pin both halves — the
 * context is established, and it narrows nothing — so that neither the gap nor
 * an over-narrow repair can come back unnoticed.
 *
 * `runWithoutTenantContext` is what makes any of this mean anything. The harness
 * installs a system context around every test (`test/tenancy-setup.ts`) — which
 * is exactly the kind of context under test — so without stripping it first
 * every assertion below would pass on the harness's context whether or not the
 * handler opens one of its own.
 */

/** What the refresh saw at the moment it asked for an EntityManager. */
interface Observation {
  readonly tenantMode: string | undefined;
  readonly entryPoint: string | undefined;
  readonly orgCond: unknown;
  readonly customerCond: unknown;
}

function condOrError(read: () => unknown): unknown {
  try {
    return read();
  } catch (err) {
    return err instanceof Error ? err.constructor.name : String(err);
  }
}

/**
 * A subscriber that is only what `watch()` uses of ioredis: two `on(...)`
 * registrations and a `subscribe(...)`. `emit` then delivers a message the way
 * the real client does — a synchronous callback with no caller of its own.
 */
class FakeSubscriber {
  private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  readonly subscribed: string[] = [];

  on(event: string, handler: (...args: unknown[]) => void): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
    return this;
  }

  async subscribe(channel: string): Promise<void> {
    this.subscribed.push(channel);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

/** Drain the microtask queue so a `void`-ed refresh has settled. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Arm a cache on a fake subscriber whose EntityManager factory records the
 * ambient context of whoever called it.
 */
function armedCache(emFactory?: () => EntityManager): {
  cache: ModuleRegistryCache;
  subscriber: FakeSubscriber;
  seen: Observation[];
  ready: Promise<void>;
} {
  const seen: Observation[] = [];
  const em = (): EntityManager => {
    seen.push({
      tenantMode: getTenantContext()?.mode,
      entryPoint: getCurrentPlatformScope()?.entryPoint,
      orgCond: condOrError(orgFilterCond),
      customerCond: condOrError(() => customerFilterCond('absent')),
    });
    if (emFactory) return emFactory();
    return { find: async () => [] } as unknown as EntityManager;
  };
  const cache = new ModuleRegistryCache();
  const subscriber = new FakeSubscriber();
  const ready = cache.watch({ redisSubscriber: subscriber as unknown as Redis, em });
  return { cache, subscriber, seen, ready };
}

afterEach(() => {
  // Back to the default stderr sink, so a later test in this file — or any file
  // sharing the fork — is not writing into an array nobody reads.
  setEscapeHatchAuditSink((record) => {
    process.stderr.write(
      `${JSON.stringify({ level: 'info', msg: 'tenant.escape_hatch', ...record })}\n`,
    );
  });
});

describe('the pub/sub refresh establishes its own scope', () => {
  it('starts from no ambient context at all — the handler`s real starting state', async () => {
    // The premise. An ioredis `'message'` callback is delivered from the socket,
    // not from a request, a job or a CLI `main()`: nothing above it has
    // established anything, so a filtered query it made would fail closed.
    // "It works today" is a fact about `@GlobalEntity`, not about this code.
    const { subscriber, seen, ready } = armedCache();
    await ready;

    await runWithoutTenantContext(async () => {
      expect(getTenantContext()).toBeUndefined();
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.tenantMode, 'the refresh ran with no tenant context').toBe('system');
  });

  it('adds no predicate to either tenant filter', async () => {
    // The half that says the repair did not overshoot: in `system` mode both
    // global filters contribute `{}`, so no read the refresh makes can be
    // narrowed. A scope that pinned an organisation would show up here as a
    // `{ organizationId: … }` and would serve that organisation's module
    // presence to the whole process.
    const { subscriber, seen, ready } = armedCache();
    await ready;

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });

    expect(seen[0]?.orgCond).toEqual({});
    expect(seen[0]?.customerCond).toEqual({});
  });

  it('labels the entry point as the message callback it is', async () => {
    const { subscriber, seen, ready } = armedCache();
    await ready;

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });

    expect(seen[0]?.entryPoint).toBe('message');
  });

  it('emits exactly one escape-hatch record, naming the refresh', async () => {
    // Crossing every organisation is the point of the scope and has to be
    // observable — which is why `enterSystemScope` demands a reason at all.
    const { subscriber, ready } = armedCache();
    await ready;

    const records: EscapeHatchAuditRecord[] = [];
    setEscapeHatchAuditSink((record) => records.push(record));

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.scope).toBe('system');
    expect(records[0]?.reason).toMatch(/registry refresh/i);
  });

  it('opens nothing for a message on another channel', async () => {
    const { subscriber, seen, ready } = armedCache();
    await ready;
    const before = openPlatformScopeCount();

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', 'b2b:some:other-channel');
      await settle();
    });

    expect(seen).toHaveLength(0);
    expect(openPlatformScopeCount()).toBe(before);
  });

  it('closes the scope on success and on a failing refresh alike', async () => {
    const before = openPlatformScopeCount();

    const ok = armedCache();
    await ok.ready;
    await runWithoutTenantContext(async () => {
      ok.subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });
    expect(openPlatformScopeCount()).toBe(before);

    const failing = armedCache(() => {
      throw new Error('database unreachable');
    });
    await failing.ready;
    await runWithoutTenantContext(async () => {
      failing.subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });
    expect(openPlatformScopeCount()).toBe(before);
    failing.cache.stopFallbackRefresh();
  });

  it('keeps the failure handling it had — a failed refresh degrades, it does not throw', async () => {
    // The scope is added *inside* the existing `.catch`, not around it: a
    // refresh that cannot reach PostgreSQL must still slip into degraded mode
    // and warn, exactly as before, and must not reject an unhandled promise out
    // of a Redis callback.
    const { cache, subscriber, ready } = armedCache(() => {
      throw new Error('database unreachable');
    });
    await ready;
    expect(cache.isDegraded()).toBe(false);

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
    });

    expect(cache.isDegraded()).toBe(true);
    cache.stopFallbackRefresh();
  });

  it('leaves no context behind after the handler returns', async () => {
    const { subscriber, ready } = armedCache();
    await ready;

    await runWithoutTenantContext(async () => {
      subscriber.emit('message', STATE_CHANGED_CHANNEL);
      await settle();
      expect(getTenantContext()).toBeUndefined();
    });
  });
});
