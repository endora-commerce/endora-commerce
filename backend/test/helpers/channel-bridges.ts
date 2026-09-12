/**
 * The sales-channel bridges, declared for a harness that composes no platform
 * (feature 120, FR-015).
 *
 * `SalesChannelMembershipService` resolves `{ table, entityIdColumn }` through
 * the kernel's `ChannelBridgeRegistry`, which each owning module fills from its
 * own boot hook. A test that boots a **server** therefore needs nothing from
 * this file: the nine registrations arrive with the composition, exactly as
 * they do in production.
 *
 * `setupTestDb` is the other harness — a bare database with no container and no
 * module composed — and five integration suites construct the kernel's
 * membership service directly on top of it. With no composition there is no
 * contributor, so every membership call in them would meet FR-017's refusal.
 * That refusal is right: those suites are exercising a platform that, as
 * composed, can serve no member at all.
 *
 * **What this file is careful not to be is a tenth copy of the map.** It holds
 * no table name and no column name. Each descriptor is imported from the module
 * that owns the bridge and creates its table, so a module that renames a column
 * moves this harness with it, and a module that stops owning a bridge takes its
 * entry out of here by deleting its own export. That is the whole difference
 * between declaring the bridges and re-declaring them: the total map D-226
 * deleted was total *and* authored in a place that owns none of the nine.
 *
 * The registry is reached at the platform's build output, the way
 * `backend/src/<subpath>/` re-export shims reach it. It is not a new host reach
 * to ledger: `check:platform-surface`'s application half excludes
 * `backend/test/**` by design, and adding a shim under `backend/src` to serve a
 * test helper would create the entry rather than avoid it. It is deliberately
 * not published on the kernel barrel either — modules reach the registry by
 * container **name**, so nothing that ships needs an address for it, and
 * publishing one would enlarge the platform's surface to serve a harness.
 */
import { channelBridges } from '../../../packages/platform/dist/kernel/sales-channels/channel-bridge-registry.js';

/** The one registry a process holds, after every owner has declared its bridge. */
export type TestChannelBridgeRegistry = typeof channelBridges;

let declared: Promise<void> | undefined;

/**
 * Declare every core bridge into the process-level registry, once.
 *
 * The imports are dynamic and the promise is memoised so that a unit file which
 * merely mentions this module pays nothing: nine module backends are a large
 * graph, and the suites that need them are already paying for a real database.
 *
 * Registration is idempotent for an identical triple, so this is safe beside a
 * composed server in the same process — which is the ordinary case, since one
 * invocation runs many files and some of them boot a platform.
 */
export async function declareChannelBridgesForTests(): Promise<void> {
  declared ??= (async () => {
    const owners = await Promise.all([
      import('@endora-commerce/mod-catalog/backend'),
      import('@endora-commerce/mod-payment-methods/backend'),
      import('@endora-commerce/mod-delivery-methods/backend'),
      import('@endora-commerce/mod-organizations/backend'),
      import('@endora-commerce/mod-taxes/backend'),
      import('@endora-commerce/mod-customer-accounts/backend'),
      import('@endora-commerce/mod-promotions/backend'),
      import('@endora-commerce/mod-cms/backend'),
    ]);
    for (const owner of owners) {
      for (const bridge of owner.salesChannelBridges) channelBridges.register(bridge);
    }
  })();
  await declared;
}

/**
 * The populated registry, for a test that has to hand one to a service.
 *
 * Call it after `setupTestDb()` — which declares the bridges — or after a
 * server has composed. It answers the live registry rather than a copy, so a
 * suite reading it sees exactly what the platform under test would.
 */
export function testChannelBridges(): TestChannelBridgeRegistry {
  return channelBridges;
}
