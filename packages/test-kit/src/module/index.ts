/**
 * `./module` — compose **one** module over supplied values, with no server and
 * no database (issue #1072).
 *
 * A module package's own unit test often needs the module's composition and
 * nothing else: resolve a name the module registered over ports the test
 * fakes, or drive a subscription through the bus the module subscribed to.
 * `./server`'s `composeTestServer` boots a whole platform, which is the wrong
 * size for that, so these tests built the composition by hand out of
 * `@endora-commerce/platform/composition` — a host-internal subpath no module
 * may name, which `check:platform-surface` ledgered as the `TEST_KIT_GAP`.
 *
 * This is the published spelling of that composition. It deliberately does not
 * re-export the platform primitives it is built from (`createRootContainer`,
 * `registerValues`, `createModuleContext`, `createModuleRegistrationSink`,
 * `registryCache`): those are `./composition`'s, and re-exporting them would
 * freeze that subpath's internals as this package's published API. What the
 * caller gets is the result — the container, the context, the collected
 * registrations, the bus, a presence switch — behind types this file owns.
 */

import { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
  registerValues,
  registryCache as platformRegistryCache,
  type KernelContainer,
  type ModuleRegistrationSink,
} from '@endora-commerce/platform/composition';

/** The module under test: its manifest id and its `registerModule`. */
export interface ModuleUnderTest {
  /** The manifest id the module is composed under. */
  readonly id: string;
  /** The manifest version; `1.0.0` when the test has no reason to name one. */
  readonly version?: string;
  /** The module's own composition function — `registerModule` from its `./backend`. */
  readonly registerModule: (ctx: ModuleContext) => void;
}

export interface ComposeModuleForTestOptions {
  readonly module: ModuleUnderTest;
  /**
   * Root registrations the module resolves — the ports and kernel services the
   * test fakes, keyed by registration name. Registered before the module runs.
   * `eventBus` is registered as the handle's bus unless this supplies one.
   */
  readonly values?: Readonly<Record<string, unknown>>;
}

/**
 * Which modules the platform reads as present, for a test.
 *
 * The module's subscriptions, ports and routes are gated on presence exactly as
 * in a composed platform (Constitution XVII), so a test that drives one sets it
 * here — `setEnabled([id])` for on, `setEnabled([])` for off.
 */
export interface TestModulePresence {
  /** Seed the enabled set: every id listed is installed and active, every other id absent. */
  setEnabled(ids: readonly string[]): void;
  /** Whether `id` is in the enabled set the last `setEnabled` seeded. */
  isEnabled(id: string): boolean;
}

/** What {@link composeModuleForTest} composed. */
export interface ComposedModule {
  /** The root container, holding the supplied values and the module's registrations. */
  readonly container: KernelContainer;
  /** The context the module's `registerModule` ran against. */
  readonly context: ModuleContext;
  /** What the module contributed beyond the container: plugins, workers, subscriptions, boot hooks. */
  readonly registrations: ModuleRegistrationSink;
  /** The bus the module subscribed to; emit here to drive a subscription. */
  readonly eventBus: EventBus;
  /** The presence switch the module is gated on. */
  readonly registryCache: TestModulePresence;
  /**
   * Release what the composition holds: the module's subscriptions are
   * unsubscribed and, when this handle seeded presence, nothing is left
   * enabled — the state the next test's `setEnabled` starts from.
   */
  dispose(): void;
}

const SILENT_LOG = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Compose one module the way a composition root does — a root container, the
 * supplied values registered on it, the module's `registerModule` run against a
 * fresh context and registration sink — and nothing more.
 */
export function composeModuleForTest(options: ComposeModuleForTestOptions): ComposedModule {
  const { module, values = {} } = options;
  const eventBus = new EventBus();
  const container = createRootContainer();
  registerValues(container, { eventBus, ...values });
  const registrations = createModuleRegistrationSink();
  const context = createModuleContext({
    module: { id: module.id, version: module.version ?? '1.0.0' },
    container,
    eventBus,
    sink: registrations,
    log: SILENT_LOG,
  });
  module.registerModule(context);

  let seeded = false;
  let enabled = new Set<string>();
  const presence: TestModulePresence = {
    setEnabled(ids) {
      seeded = true;
      enabled = new Set(ids);
      platformRegistryCache.__setEnabledForTesting([...ids]);
    },
    isEnabled(id) {
      return enabled.has(id);
    },
  };

  return {
    container,
    context,
    registrations,
    eventBus,
    registryCache: presence,
    dispose() {
      for (const unsubscribe of registrations.unsubscribes.splice(0)) unsubscribe();
      if (seeded) presence.setEnabled([]);
    },
  };
}
