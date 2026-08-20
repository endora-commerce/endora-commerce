import { describe, expect, it } from 'vitest';
import {
  createRootContainer,
  registerValues,
  type KernelContainer,
} from '../../../src/kernel/container.js';
import { enterPlatformScope, type PlatformScope } from '../../../src/kernel/scope.js';
import { systemTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';

/**
 * A disposed scope releases the container (feature 072, Phase 4 finding).
 *
 * The scope object is what lives in the `AsyncLocalStorage` store, and a store
 * stays reachable for as long as **any** async resource created inside it does
 * — one pooled database connection is enough. That retention was free while the
 * process root container was empty. It stopped being free the moment modules
 * started registering into it: the root then reaches the ORM and its metadata,
 * the Redis client and every module service and cache, so one retained store
 * pinned an entire composed application.
 *
 * Measured on the T040 conversion: with the root captured for the life of the
 * scope, the full suite died with `JavaScript heap out of memory` at file **78**
 * of 928 after 373 s; with it released on disposal, the run completes.
 *
 * The assertion is direct rather than statistical: hold the scope, drop every
 * other reference to the container, force a GC, and ask whether the container
 * was collected. `--expose-gc` comes from `poolOptions.forks.execArgv` in
 * `backend/vitest.config.ts`.
 */

function forceGc(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (typeof gc !== 'function') {
    throw new Error(
      'global.gc is unavailable — this measurement is meaningless without a forced GC. ' +
        'Run vitest through backend/vitest.config.ts, which passes --expose-gc to the fork pool.',
    );
  }
  gc();
}

/** Let V8 finish clearing weak refs — a single synchronous `gc()` is not enough. */
async function collect(): Promise<void> {
  for (let pass = 0; pass < 3; pass += 1) {
    forceGc();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/**
 * Open a scope against a throwaway container and hand back the scope plus a
 * weak reference to that container. Nothing strong to the container survives
 * this function, so whether it stays alive is entirely up to the scope.
 */
async function scopeOver(resolveSomething: boolean): Promise<{
  scope: PlatformScope;
  containerRef: WeakRef<KernelContainer>;
}> {
  const container = createRootContainer();
  registerValues(container, { marker: { heavy: new Array(1000).fill('x') } });
  const containerRef = new WeakRef(container);

  let captured: PlatformScope | undefined;
  await enterPlatformScope(
    systemTenantContext('scope retention test'),
    (scope) => {
      captured = scope;
      // Resolving is what creates the awilix child, so both shapes are covered:
      // a scope that never resolved and one that did.
      if (resolveSomething) void scope.cradle['marker'];
    },
    { container, entryPoint: 'cli' },
  );

  return { scope: captured as PlatformScope, containerRef };
}

describe('a disposed platform scope releases its container', () => {
  it('does not pin the root after disposal — scope that resolved nothing', async () => {
    const { scope, containerRef } = await scopeOver(false);
    await collect();

    expect(scope).toBeDefined();
    expect(containerRef.deref()).toBeUndefined();
  });

  it('does not pin the root after disposal — scope that resolved', async () => {
    const { scope, containerRef } = await scopeOver(true);
    await collect();

    expect(scope).toBeDefined();
    expect(containerRef.deref()).toBeUndefined();
  });

  it('still fails loudly when work outlives its scope', async () => {
    const { scope } = await scopeOver(true);
    expect(() => scope.cradle).toThrow(/disposed/);
  });
});
