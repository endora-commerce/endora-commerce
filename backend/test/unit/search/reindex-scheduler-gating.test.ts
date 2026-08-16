import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentPlatformScope } from '../../../src/kernel/scope.js';
import { getTenantContext } from '../../../src/tenancy/tenant-context.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { searchModule, type SearchModuleOptions } from '../../../src/modules/search/plugin.js';

/**
 * Issue #126 — the reindex scheduler is an entry point, so it decides presence.
 *
 * `search` schedules its own tick with `setTimeout` and re-arms it from inside
 * the callback. That is the same position as a `setInterval`: nothing can catch
 * a throw from there, so presence is decided before the work rather than caught
 * after it — otherwise a module an operator switched off goes on rebuilding
 * every Meilisearch index on a timer.
 *
 * The second property here is the one a `return` would quietly break: this timer
 * *is* the loop. Skipping the reschedule while the module is off would stop the
 * scheduler for the life of the process, and switching the module back on would
 * never bring it back.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

interface ScheduledTimer {
  readonly callback: () => void;
  readonly delayMs: number;
}

describe('search reindex scheduler is gated on effective presence', () => {
  let scheduled: ScheduledTimer[];
  let restoreTimers: () => void;

  beforeEach(() => {
    scheduled = [];
    const spy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      callback: () => void,
      delayMs: number,
    ): NodeJS.Timeout => {
      scheduled.push({ callback, delayMs });
      return { unref: () => undefined, ref: () => undefined } as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout);
    restoreTimers = () => spy.mockRestore();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterEach(() => {
    restoreTimers();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('reindexes nothing while the module is off, keeps polling, and resumes when it is back on', async () => {
    const settingsGet = vi.fn(async () => 5);
    const { handle, plugin } = searchModule(searchOptions(settingsGet));
    const reindex = vi
      .spyOn(handle.reindexWorker, 'reindex')
      .mockResolvedValue({ channelsReindexed: 1, documentCount: 7 });

    await plugin(Fastify());
    // The plugin body arms the first poll; everything after this is a tick.
    expect(scheduled).toHaveLength(1);

    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['search'] });
    await runLastTick(scheduled);

    expect(settingsGet, 'a switched-off module read its own setting').not.toHaveBeenCalled();
    expect(reindex, 'a switched-off module rebuilt the search indexes').not.toHaveBeenCalled();
    expect(scheduled, 'the off tick killed the loop instead of re-arming it').toHaveLength(2);

    registryCache.__setEnabledForTesting(ALL_IDS);
    await runLastTick(scheduled);

    expect(reindex).toHaveBeenCalledTimes(1);
  });

  /**
   * Issue #128 — the same tick, on the other rule. `check-entry-scope` classified
   * interval entry points by grepping for `setInterval(`, so this loop was never
   * in its population and FR-020 went unmet here while the check read clean: the
   * sweep queried whatever `@OrgScoped` filters happened not to apply to it.
   *
   * The scope wraps the **work**, not the guard: the presence decision and the
   * reschedule stay outside it, because this timer is the loop and losing the
   * re-arm would stop the scheduler for the life of the process.
   */
  it('runs the sweep inside a system scope opened at the timer', async () => {
    const settingsGet = vi.fn(async () => 5);
    const { handle, plugin } = searchModule(searchOptions(settingsGet));
    const observed: ({ mode: string; entryPoint: string } | 'no scope')[] = [];
    vi.spyOn(handle.reindexWorker, 'reindex').mockImplementation(async () => {
      // Read the scope's own tenant, not the ambient one: the suite's tenancy
      // setup establishes a system context around every test, so `mode` alone
      // would pass whether or not this entry point opened anything.
      const scope = getCurrentPlatformScope();
      observed.push(
        scope ? { mode: scope.tenant.mode, entryPoint: scope.entryPoint } : 'no scope',
      );
      // The ambient context has to agree with it — that is what the ORM filters
      // read, and a scope whose tenancy did not propagate would still report a
      // clean `entryPoint`.
      expect(getTenantContext()?.mode).toBe('system');
      return { channelsReindexed: 1, documentCount: 7 };
    });

    await plugin(Fastify());
    await runLastTick(scheduled);

    expect(observed, 'the sweep did not run').toHaveLength(1);
    expect(observed[0], 'the sweep ran with no tenant context of its own').toEqual({
      mode: 'system',
      entryPoint: 'interval',
    });
    expect(scheduled.length, 'the scoped tick did not re-arm the loop').toBeGreaterThan(1);
  });
});

/** Run the most recently armed callback and let its async body settle. */
async function runLastTick(scheduled: readonly ScheduledTimer[]): Promise<void> {
  const last = scheduled[scheduled.length - 1];
  if (!last) throw new Error('nothing was scheduled — there is no tick to run');
  last.callback();
  // The callback returns `void`, so there is nothing to await: give its promise
  // chain a few event-loop turns. Every collaborator here is a stub, so the
  // chain is microtasks only.
  for (let turn = 0; turn < 5; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * The module with every collaborator stubbed. None of them is called on the path
 * under test while the module is off, which is exactly what is asserted; the
 * reindex worker is the one real object, so it can be spied on.
 */
function searchOptions(settingsGet: () => Promise<number>): SearchModuleOptions {
  const notCalled = (name: string) => () => {
    throw new Error(`unexpected call to ${name}`);
  };
  return {
    emFactory: notCalled('emFactory'),
    catalogAttributeRead: {} as SearchModuleOptions['catalogAttributeRead'],
    listingPrices: {
      resolveListingPrices: notCalled('resolveListingPrices'),
    } as unknown as SearchModuleOptions['listingPrices'],
    settingsService: { get: settingsGet } as unknown as SearchModuleOptions['settingsService'],
    credentials: {} as SearchModuleOptions['credentials'],
    settingsAdminService: {} as SearchModuleOptions['settingsAdminService'],
    requireAdmin: () => async () => undefined,
    resolveAdminAuditContext: notCalled(
      'resolveAdminAuditContext',
    ) as unknown as SearchModuleOptions['resolveAdminAuditContext'],
    enrichSuggestionPricing: notCalled(
      'enrichSuggestionPricing',
    ) as unknown as SearchModuleOptions['enrichSuggestionPricing'],
    enableReindexScheduler: true,
  };
}
