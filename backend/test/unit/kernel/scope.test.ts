import { describe, expect, it } from 'vitest';
import { asClass, asValue } from 'awilix';
import { createRootContainer } from '../../../src/kernel/container.js';
import { enterPlatformScope } from '../../../src/kernel/scope.js';
import { getTenantContext } from '../../../src/tenancy/tenant-context.js';
import {
  orgPinnedTenantContext,
  systemTenantContext,
} from '../../../src/tenancy/resolve-tenant-context.js';

/**
 * The request seam. Its failure mode is a **leak, not a throw**: if the
 * AsyncLocalStorage store stops nesting, a handler runs under whatever context
 * was ambient and sees everything. So the assertions here are about nesting and
 * restoration, not about an error being raised.
 *
 * `test/tenancy-setup.ts` enters a system context for every test in the
 * repository, which is exactly the ambient store these tests nest over — the
 * same relationship a request has with it.
 */

const ORG = '11111111-1111-4111-8111-111111111111';

describe('enterPlatformScope — the ambient tenant store', () => {
  it('makes the passed context ambient inside `run`', async () => {
    const container = createRootContainer();
    const tenant = orgPinnedTenantContext(ORG, 'scope unit test');

    const seen = await enterPlatformScope(tenant, () => getTenantContext(), { container });

    expect(seen).toEqual(tenant);
  });

  it('nests over the ambient store and restores it afterwards', async () => {
    const container = createRootContainer();
    const outer = getTenantContext();
    expect(outer?.mode).toBe('system'); // the harness default

    await enterPlatformScope(orgPinnedTenantContext(ORG, 'nesting'), () => {
      expect(getTenantContext()?.organizationId).toBe(ORG);
    }, { container });

    expect(getTenantContext()).toEqual(outer);
  });

  it('propagates the store across awaited continuations', async () => {
    const container = createRootContainer();
    const tenant = orgPinnedTenantContext(ORG, 'async propagation');

    const seen = await enterPlatformScope(
      tenant,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        await Promise.resolve();
        return getTenantContext();
      },
      { container },
    );

    expect(seen).toEqual(tenant);
  });

  it('restores the ambient store even when `run` throws', async () => {
    const container = createRootContainer();
    const outer = getTenantContext();

    await expect(
      enterPlatformScope(
        orgPinnedTenantContext(ORG, 'throwing'),
        () => {
          throw new Error('boom');
        },
        { container },
      ),
    ).rejects.toThrow('boom');

    expect(getTenantContext()).toEqual(outer);
  });
});

describe('enterPlatformScope — the resolution scope', () => {
  it('registers the resolved channel as a per-scope value', async () => {
    const container = createRootContainer();
    const channel = { id: 'c1', code: 'default' } as never;

    const resolved = await enterPlatformScope(
      systemTenantContext('channel registration'),
      (scope) => scope.cradle['salesChannel'],
      { container, channel },
    );

    expect(resolved).toBe(channel);
  });

  it('registers null for the channel outside HTTP rather than failing to resolve', async () => {
    const container = createRootContainer();

    const resolved = await enterPlatformScope(
      systemTenantContext('worker run'),
      (scope) => scope.cradle['salesChannel'],
      { container },
    );

    expect(resolved).toBeNull();
  });

  it('gives each scoped registration its own instance per scope', async () => {
    const container = createRootContainer();
    class PerScope {}
    container.register({ perScope: asClass(PerScope).scoped() });

    const first = await enterPlatformScope(
      systemTenantContext('scope a'),
      (scope) => scope.cradle['perScope'],
      { container },
    );
    const second = await enterPlatformScope(
      systemTenantContext('scope b'),
      (scope) => scope.cradle['perScope'],
      { container },
    );

    expect(first).not.toBe(second);
  });

  it('does not register the tenant context in the container', async () => {
    const container = createRootContainer();

    await enterPlatformScope(systemTenantContext('no tenancy in the cradle'), (scope) => {
      // Tenancy stays ambient: the MikroORM filter cond reads AsyncLocalStorage
      // at query-build time, so a container value would be a second, divergent
      // source of truth.
      expect(() => scope.cradle['tenantContext']).toThrow();
    }, { container });
  });
});

describe('enterPlatformScope — disposal', () => {
  it('disposes the scope on success', async () => {
    const container = createRootContainer();
    const disposed: string[] = [];
    container.register({
      perScope: asClass(class PerScope {})
        .scoped()
        .disposer(() => {
          disposed.push('perScope');
        }),
    });

    await enterPlatformScope(
      systemTenantContext('disposal on success'),
      (scope) => scope.cradle['perScope'],
      { container },
    );

    expect(disposed).toEqual(['perScope']);
  });

  it('disposes the scope when `run` throws', async () => {
    const container = createRootContainer();
    const disposed: string[] = [];
    container.register({
      perScope: asClass(class PerScope {})
        .scoped()
        .disposer(() => {
          disposed.push('perScope');
        }),
    });

    await expect(
      enterPlatformScope(
        systemTenantContext('disposal on error'),
        (scope) => {
          void scope.cradle['perScope'];
          throw new Error('handler failed');
        },
        { container },
      ),
    ).rejects.toThrow('handler failed');

    expect(disposed).toEqual(['perScope']);
  });

  it('disposes the scope when the caller aborts', async () => {
    const container = createRootContainer();
    const disposed: string[] = [];
    container.register({
      perScope: asClass(class PerScope {})
        .scoped()
        .disposer(() => {
          disposed.push('perScope');
        }),
    });

    // The HTTP shape: the scope stays open until the response closes, and a
    // client abort closes it just like a completed response does.
    const abort = new AbortController();
    const run = enterPlatformScope(
      systemTenantContext('disposal on abort'),
      (scope) => {
        void scope.cradle['perScope'];
        return new Promise<void>((resolve) => {
          abort.signal.addEventListener('abort', () => resolve());
        });
      },
      { container },
    );

    abort.abort();
    await run;

    expect(disposed).toEqual(['perScope']);
  });

  it('is idempotent — a second dispose is a no-op', async () => {
    const container = createRootContainer();
    const disposed: string[] = [];
    container.register({
      perScope: asClass(class PerScope {})
        .scoped()
        .disposer(() => {
          disposed.push('perScope');
        }),
    });

    await enterPlatformScope(
      systemTenantContext('idempotent disposal'),
      async (scope) => {
        void scope.cradle['perScope'];
        await scope.dispose();
      },
      { container },
    );

    expect(disposed).toEqual(['perScope']);
  });

  it('leaves the root container usable after a scope is disposed', async () => {
    const container = createRootContainer();
    container.register({ singletonThing: asValue('root-value') });

    await enterPlatformScope(systemTenantContext('root survives'), () => undefined, {
      container,
    });

    expect(container.resolve('singletonThing')).toBe('root-value');
  });
});
