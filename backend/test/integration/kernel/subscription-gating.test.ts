import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { InventoryThreshold } from '../../helpers/package-entities.js';
import { INVENTORY_SETTING_CODES } from '../../../../packages/modules/inventory/src/manifest.js';
import { pimErgonodeHandle } from '@endora-commerce/mod-pim-ergonode/test-support';

/**
 * Issue #107 — a module's EventBus subscriptions stop when the module does.
 *
 * Twenty-two subscriptions across nine modules were registered with a bare
 * `eventBus.on`, so they kept firing for a module an operator had switched off.
 * Fifteen of them wrote: an invoice issued and e-mailed, a quote request flipped
 * to Completed, a push message delivered to a device, a shopping list created, a
 * threshold row mirrored, Job Schedulers re-asserted in Redis. Each now goes
 * through `ctx.subscribe`, which wraps it in `subscribeForModule`.
 *
 * **One file rather than nine.** The shape of an off-state test is decided by
 * `setupBackendServer()`, which runs once per test *file* in a single fork and
 * whose measured baseline already reaches PostgreSQL's `max_connections` partway
 * through a full run (`test/helpers/off-state.ts` says the same thing at
 * length). Nine files would be nine servers to prove one property nine times; a
 * describe per module over one server proves it as thoroughly and costs one.
 *
 * The assertion is about the **handler**, not about its effect. Counting effects
 * would pass just as well if the handler had run and then dropped its result,
 * which is not absence — it is wasted work with the same output. Every handler
 * is replaced by a counter for the file's lifetime, so nothing here reaches
 * Meilisearch, Redis or a mailbox either.
 */

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

/**
 * The modules whose operator axis is closed by their own declaration (feature
 * 074). Derived rather than listed: a second copy of the core set here would
 * drift from the manifests, which is the defect the classification test exists
 * to prevent.
 */
const CORE_IDS = new Set(
  REGISTERED_MANIFESTS.filter(
    (entry) =>
      entry.manifest.activation !== undefined && 'nonDeactivatable' in entry.manifest.activation,
  ).map((entry) => entry.manifest.id),
);

interface Probe {
  /** The module whose subscription is under test. */
  readonly moduleId: string;
  /** A short description of what the handler does when it fires. */
  readonly what: string;
  readonly event: string;
  readonly payload: () => Record<string, unknown>;
  /** Installs the counter; returns the restore. */
  readonly spy: (h: BackendServerHandle, count: () => void) => () => void;
}

/** Replace one method with a counter and hand back the restore. */
function countCalls(owner: object, method: string, count: () => void): () => void {
  const target = owner as Record<string, (...args: unknown[]) => unknown>;
  const original = target[method];
  if (typeof original !== 'function') {
    throw new Error(`[subscription-gating] "${method}" is not a method on the resolved instance`);
  }
  target[method] = () => {
    count();
    return undefined;
  };
  return () => {
    target[method] = original;
  };
}

function cradleOf(h: BackendServerHandle): Record<string, unknown> {
  return h.container.cradle as unknown as Record<string, unknown>;
}

const PROBES: readonly Probe[] = [
  {
    moduleId: 'search',
    what: 'rewrites the product document in every channel index',
    event: 'product.updated.v1',
    payload: () => ({ productId: randomUUID(), changedFields: ['name'] }),
    spy: (h, count) => countCalls(h.search.subscriber, 'onProductUpserted', count),
  },
  {
    moduleId: 'product_feeds',
    what: 're-asserts the feed’s Job Scheduler and clears its next-run stamp',
    event: 'product_feeds.feed_changed',
    payload: () => ({ feedId: randomUUID() }),
    spy: (h, count) => countCalls(h.productFeeds.schedules, 'syncOne', count),
  },
  {
    moduleId: 'inventory',
    what: 'mails the low-stock alert',
    event: 'inventory.adjusted.v1',
    payload: () => ({
      productId: randomUUID(),
      warehouseId: randomUUID(),
      variantId: null,
      before: 5,
      after: 1,
    }),
    spy: (h, count) => {
      const inventory = cradleOf(h)['inventory'] as unknown as {
        handle: { lowStockAlertService: object };
      };
      return countCalls(inventory.handle.lowStockAlertService, 'handleAdjusted', count);
    },
  },
  {
    moduleId: 'pwa',
    what: 'writes a push_messages row and enqueues the delivery',
    event: 'order.status_changed.v1',
    payload: () => ({
      eventId: randomUUID(),
      orderId: randomUUID(),
      salesChannelId: randomUUID(),
      from: 'new',
      to: 'paid',
    }),
    spy: (h, count) => countCalls(h.pwa.pushEventHandlers, 'onOrderStatusChanged', count),
  },
  {
    moduleId: 'quote_requests',
    what: 'flips the originating quote request to Completed and notifies the customer',
    event: 'order.created.v1',
    payload: () => ({ eventId: randomUUID(), orderId: randomUUID(), organizationId: null }),
    spy: (h, count) => {
      const quoteRequests = cradleOf(h)['quoteRequests'] as unknown as {
        handle: () => { orderCompletionReactor: object };
      };
      return countCalls(quoteRequests.handle().orderCompletionReactor, 'onOrderCreated', count);
    },
  },
  {
    moduleId: 'invoices',
    what: 'issues a numbered invoice and e-mails the PDF',
    event: 'order.status_changed.v1',
    payload: () => ({
      eventId: randomUUID(),
      orderId: randomUUID(),
      salesChannelId: randomUUID(),
      from: 'new',
      to: 'paid',
    }),
    spy: (h, count) => {
      const invoices = cradleOf(h)['invoices'] as unknown as {
        handle: { autoIssueReactor: object };
      };
      return countCalls(invoices.handle.autoIssueReactor, 'onOrderStatusChanged', count);
    },
  },
  {
    moduleId: 'pim_ergonode',
    what: 'reinstates the import Job Scheduler that pulls the client’s PIM',
    event: 'pim_ergonode.connection_changed',
    payload: () => ({ eventId: randomUUID() }),
    spy: (h, count) => countCalls(pimErgonodeHandle(h.container).schedules, 'syncOne', count),
  },
  {
    moduleId: 'catalog',
    what: 'posts a cache-tag revalidation at the storefront',
    event: 'category.updated.v1',
    payload: () => ({ eventId: randomUUID(), categoryId: randomUUID() }),
    spy: (h, count) =>
      countCalls(cradleOf(h)['catalogCategoryRevalidator'] as object, 'revalidate', count),
  },
  {
    moduleId: 'shopping_lists',
    what: 'creates the customer’s default shopping list',
    event: 'customer_account.created.v1',
    payload: () => ({
      eventId: randomUUID(),
      customerAccountId: randomUUID(),
      organizationId: randomUUID(),
    }),
    spy: (h, count) =>
      countCalls(cradleOf(h)['shoppingListService'] as object, 'ensureDefault', count),
  },
];

describe('module subscriptions are gated by the module’s effective state [integration]', () => {
  let h: BackendServerHandle;
  const calls = new Map<string, number>();
  const restores: Array<() => void> = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    for (const probe of PROBES) {
      calls.set(probe.moduleId, 0);
      restores.push(
        probe.spy(h, () => calls.set(probe.moduleId, (calls.get(probe.moduleId) ?? 0) + 1)),
      );
    }
  }, 60_000);

  afterAll(async () => {
    for (const restore of restores) restore();
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  async function emit(probe: Probe): Promise<number> {
    const before = calls.get(probe.moduleId) ?? 0;
    h.eventBus.emit(
      probe.event as never,
      probe.payload() as unknown as Parameters<typeof h.eventBus.emit>[1],
    );
    // The bus dispatches asynchronously; give the handler a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 50));
    return (calls.get(probe.moduleId) ?? 0) - before;
  }

  for (const probe of PROBES) {
    describe(`${probe.moduleId} — ${probe.event} ${probe.what}`, () => {
      it('runs the handler while the module is on', async () => {
        registryCache.__setEnabledForTesting(ALL_IDS);
        expect(await emit(probe)).toBeGreaterThan(0);
      });

      if (CORE_IDS.has(probe.moduleId)) {
        // Feature 074 made this module core, so no operator can reach the state
        // the sibling case below drives — and `effectiveState` forces a core
        // module's operator axis to `true` whatever the activation map holds,
        // so seeding a deactivation here would have asserted nothing while
        // reading as though it asserted the gate. The seam is still exercised,
        // by the axis that can still close it, and the closed door is asserted
        // rather than assumed.
        it('cannot have its operator axis closed at all', async () => {
          registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: [probe.moduleId] });
          expect(effectiveState.isPresent(probe.moduleId)).toBe(true);
          expect(await emit(probe)).toBeGreaterThan(0);
        });
      } else {
        it('does not run it while the operator has deactivated the module', async () => {
          registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: [probe.moduleId] });
          expect(await emit(probe)).toBe(0);
        });
      }

      it('does not run it while the platform axis has the module removed', async () => {
        registryCache.__setEnabledForTesting(ALL_IDS.filter((id) => id !== probe.moduleId));
        expect(await emit(probe)).toBe(0);
      });

      it('runs it again once the module is present again', async () => {
        registryCache.__setEnabledForTesting(ALL_IDS);
        expect(await emit(probe)).toBeGreaterThan(0);
      });
    });
  }
});

/**
 * D-45's ordering trap, asserted rather than assumed.
 *
 * `EventBus.dispatch` awaits handlers in registration order. The settings-cache
 * invalidator is attached by `composeSettingsKernel`, which runs before any
 * module registers, so a module's `settings.value_changed` subscriber is
 * dispatched **after** the invalidator has dropped the code. Moving the
 * threshold mirror from a bare `eventBus.on` (registered when the module's
 * plugin body ran, later still) into `ctx.subscribe` keeps it on the correct
 * side of that boundary — and the property that proves it is the one the mirror
 * exists for: it re-reads the setting it was told about, so it can only write
 * the new value if the cache was already invalidated.
 */
describe('inventory’s threshold mirror reads a settings value the invalidator has dropped [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting(ALL_IDS);
    await teardownBackendServer(h);
  });

  it('mirrors the value that was just written, not the cached one', async () => {
    const write = async (value: number): Promise<void> => {
      await h.settings.adminService.setValueForAllChannels(
        INVENTORY_SETTING_CODES.GLOBAL_THRESHOLD_HIGH,
        value,
        null,
        { actorAdminUserId: null },
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    // Twice, with different values: a single write could agree with a stale read
    // by coincidence if the seeded default happened to match.
    for (const value of [321, 654]) {
      await write(value);
      const row = await h
        .em()
        .fork()
        .findOne(InventoryThreshold, { scopeKind: 'global', scopeId: null });
      expect(row?.thresholdHigh).toBe(value);
    }
  }, 30_000);
});
