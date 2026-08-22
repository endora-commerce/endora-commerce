import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleManifest, RegistryState } from '@b2b/contracts';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import {
  ModuleCompositionError,
  composeModules,
  type ModuleEntry,
} from '../../../src/kernel/compose.js';
import type { ModuleContext } from '../../../src/kernel/module-context.js';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import {
  ModulePresenceNotLoadedError,
  registryCache,
} from '../../../src/kernel/lifecycle/registry-cache.js';
import { loadModulePresence } from '../../../src/modules/_lifecycle/services/presence-load.js';
import { ModuleRegistration } from '../../../src/kernel/lifecycle/module-registration.entity.js';
import { Setting } from '../../../src/kernel/settings/setting.entity.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { coreModulesRoot } from '../../../src/overlay/overlay-roots.js';

/**
 * Module presence is a **composition input** (feature 072, D-38 / D-40).
 *
 * The defect this pins was structural, not data-dependent: the presence cache
 * was warmed inside `_lifecycle`'s Fastify plugin body — at `buildServer` time,
 * after `composeApp()` — while eleven boot hooks resolve a gated port. Every one
 * of them asked an empty cache, got "not installed", and `composeApp()` threw
 * `ModuleCompositionError` before the process could listen.
 *
 * Two properties are pinned here, and neither is a property of today's module
 * graph — which is what makes this the test that fails first when somebody
 * reintroduces the ordering:
 *
 *  1. A presence read before the load is a **wiring defect that says so**
 *     ({@link ModulePresenceNotLoadedError}), not an answer. Fail-open ("present
 *     until known") was rejected: `subscribeForModule` and `defineModuleWorker`
 *     read presence before any route exists, so it would run a switched-off
 *     module's work.
 *  2. After the load, presence answers **from the database** — both axes.
 *
 * No database: the load takes an `EntityManager` factory, so a stub answers the
 * two `find` calls it makes. The one composition that boots the production root
 * for real is `test/integration/kernel/production-boot.test.ts`.
 */

const HOST = 'fixture_presence_host';
const CONSUMER = 'fixture_presence_consumer';

interface GreetingPort {
  greet(): string;
}

interface FixtureCradle {
  readonly fixtureGreetingPort: GreetingPort;
}

function manifest(id: string, settingCode: string): ModuleManifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    dependencies: [],
    activation: { settingCode, default: true },
  };
}

/**
 * Core entries. `loadModulePresence` takes the resolved entries and reads each
 * one's origin off its `filePath`, so that only what this build ships is
 * converged by the first-boot reconciler (D-157.6(b)); a fixture that wants a
 * row written has to anchor where a core module anchors.
 */
function coreEntry(id: string): { manifest: ModuleManifest; filePath: string } {
  return {
    manifest: manifest(id, `${id}.enabled`),
    filePath: join(coreModulesRoot(), id, 'manifest.ts'),
  };
}

const ENTRIES = [coreEntry(HOST), coreEntry(CONSUMER)];

/**
 * The two reads the load makes, and nothing else: `module_registrations` for
 * the platform axis, `settings` for the operator axis.
 */
function stubEm(rows: {
  registrations: ReadonlyArray<{ moduleId: string; state: RegistryState }>;
  settings?: ReadonlyArray<{ code: string; globalValue: unknown }>;
}): () => EntityManager {
  const created: unknown[] = [];
  return () =>
    ({
      created,
      find: async (entity: unknown): Promise<unknown[]> => {
        if (entity === ModuleRegistration) return [...rows.registrations];
        if (entity === Setting) {
          return (rows.settings ?? []).map((s) => ({
            code: s.code,
            globalValue: s.globalValue,
            defaultValue: null,
          }));
        }
        return [];
      },
      create: (_entity: unknown, data: unknown): unknown => {
        created.push(data);
        return data;
      },
      flush: async (): Promise<void> => {},
    }) as unknown as EntityManager;
}

function entry(id: string, registerModule: (ctx: ModuleContext) => void): ModuleEntry {
  return { id, version: '1.0.0', registerModule };
}

/** One module provides a gated port; the other resolves it from `ctx.onBoot`. */
function composeFixture(): { runBootHooks: () => Promise<void>; greeted: string[] } {
  const greeted: string[] = [];
  const composed = composeModules(
    [
      entry(HOST, (ctx) => {
        ctx.di.providePort(
          'fixtureGreetingPort',
          ctx.asFunction((): GreetingPort => ({ greet: () => 'hello' })).singleton(),
        );
      }),
      entry(CONSUMER, (ctx) => {
        ctx.onBoot(() => {
          greeted.push(ctx.cradle<FixtureCradle>().fixtureGreetingPort.greet());
        });
      }),
    ],
    {
      container: createRootContainer(),
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
  );
  return { runBootHooks: () => composed.runBootHooks(), greeted };
}

describe('module presence is loaded before the first module registers', () => {
  beforeEach(() => {
    registryCache.__resetForTesting();
  });

  afterAll(() => {
    // The cache is a process singleton and the suite shares one fork: leave it
    // loaded, the way every other file finds it.
    registryCache.__setEnabledForTesting(REGISTERED_MANIFESTS.map((e) => e.manifest.id));
  });

  it('refuses to answer a presence read before the load, naming the defect', async () => {
    const { runBootHooks } = composeFixture();

    const thrown = await runBootHooks().catch((err: unknown) => err);

    expect(thrown).toBeInstanceOf(ModuleCompositionError);
    expect((thrown as ModuleCompositionError).cause).toBeInstanceOf(
      ModulePresenceNotLoadedError,
    );
    // The composer names the module; the error names the read and the fix.
    expect((thrown as Error).message).toContain(CONSUMER);
    expect((thrown as Error).message).toContain('before it was loaded');
  });

  it('answers from the database once loaded, and the boot hook resolves the port', async () => {
    await loadModulePresence({
      em: stubEm({ registrations: [{ moduleId: HOST, state: 'installed' }] }),
      entries: ENTRIES,
    });

    const { runBootHooks, greeted } = composeFixture();
    await runBootHooks();

    expect(greeted).toEqual(['hello']);
  });

  it('answers the operator axis from the database too — a deactivated host stays absent', async () => {
    await loadModulePresence({
      em: stubEm({
        registrations: [{ moduleId: HOST, state: 'installed' }],
        settings: [{ code: `${HOST}.enabled`, globalValue: false }],
      }),
      entries: ENTRIES,
    });

    const { runBootHooks } = composeFixture();
    const thrown = await runBootHooks().catch((err: unknown) => err);

    // Loaded and absent is a different answer from unloaded, and the caller
    // must be able to tell them apart: this one is the gate working.
    expect((thrown as ModuleCompositionError).cause).toBeInstanceOf(ModuleDisabledError);
  });

  /**
   * The other half of the sentence above, and the one nothing pinned until
   * issue #146: presence is loaded before composition, and `runBootHooks` still
   * does not consult it.
   *
   * Three documents said the kernel decides this centrally — "`runBootHooks`
   * catches, so that is one kernel decision rather than a guard per module".
   * It re-throws (`test/integration/kernel/boot-failure.test.ts` pins that), and
   * it skips nothing. Both facts are deliberate and this case is the second one:
   * a boot hook is where a module contributes an inert descriptor to another
   * module's registry, the host filters those by contributor at enumeration, and
   * a kernel that skipped an absent module's hook would make switching that
   * module back on require a restart. The consequence — a working boot hook must
   * probe its own presence, because nobody does it for it — is D-68's.
   */
  it("runs a deactivated module's own boot hook, because the kernel skips nothing", async () => {
    await loadModulePresence({
      em: stubEm({
        registrations: [{ moduleId: CONSUMER, state: 'installed' }],
        settings: [{ code: `${CONSUMER}.enabled`, globalValue: false }],
      }),
      entries: ENTRIES,
    });
    // Non-vacuity: without this the case would pass on a module that is simply
    // present, which is the assertion it is not making.
    expect(effectiveState.isPresent(CONSUMER)).toBe(false);

    const contributed: string[] = [];
    const composed = composeModules(
      [
        entry(CONSUMER, (ctx) => {
          ctx.onBoot(() => {
            contributed.push(CONSUMER);
          });
        }),
      ],
      {
        container: createRootContainer(),
        eventBus: new EventBus(),
        log: { info: () => {}, warn: () => {}, error: () => {} },
      },
    );
    await composed.runBootHooks();

    expect(contributed).toEqual([CONSUMER]);
  });

  it('registers a module the registry has never seen, so a new module boots enabled', async () => {
    const em = stubEm({ registrations: [{ moduleId: HOST, state: 'installed' }] });
    await loadModulePresence({ em, entries: ENTRIES });

    // First-boot reconcile: the row is written before the axes are read, so the
    // consumer is present in the same boot that discovered it.
    expect((em() as unknown as { created: unknown[] }).created).toContainEqual(
      expect.objectContaining({ moduleId: CONSUMER, state: 'installed' }),
    );
  });
});
