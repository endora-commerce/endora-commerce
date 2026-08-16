import Fastify from 'fastify';
import { asValue } from 'awilix';
import { serializerCompiler, validatorCompiler } from '@fastify/type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
  type ModuleContext,
  type ModuleRegistrationSink,
} from '../../../src/kernel/index.js';
import { EventBus } from '../../../src/events/bus.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { registerModule } from '../../../src/modules/_i18n/backend.js';

/**
 * Feature 072 wave 1 (T089) — `_i18n` reconciles on plugin attach, not on boot.
 *
 * This is the one thing about this conversion that is not interchangeable with
 * the other seventeen, and it is worth stating plainly because the natural move
 * is wrong.
 *
 * Everything below is about a move that was never made. `_i18n` has always
 * reconciled from its `ctx.routes` callback and registers no boot hook at all,
 * so its reconcile has never been affected by where a composition root runs its
 * boot phase. Read the next paragraph as the argument against moving it, not as
 * the record of an outage.
 *
 * Every other converted module puts its boot-time work in `ctx.onBoot`. Doing
 * that here would have broken the platform silently. `_i18n` walks the lifecycle
 * manifest registry to refresh every module's `translation_bundles` rows, and it
 * reaches that registry through a **lazy accessor** because `_lifecycle`'s
 * orchestrator is built late in a root, after the modules compose. Under the
 * two-pass shape a root ran its boot hooks once per pass, both of them before
 * that point, so a reconcile in `onBoot` would have found no registry — and the
 * reconciler's contract for that case is to return `{installed: 0, skipped: 0, failed: 0}`
 * and carry on: every module's translation bundles quietly stop being refreshed
 * at boot, no exception is raised, no log line says anything is wrong, and the
 * first symptom is a screen rendering raw i18n keys after somebody edits a JSON
 * bundle.
 *
 * D-45 retired that hazard rather than this test: there is one boot phase now
 * and it runs at the very bottom of `composeApp()`, after the orchestrator
 * exists, so `onBoot` would find the registry today. Nothing observable moved —
 * `production-boot` logs the same `installed=42 skipped=23 failed=0` either side
 * of the collapse.
 *
 * The reconcile stays in the `ctx.routes` callback all the same, and this test
 * keeps pinning it there. Not because the old hazard survives, but because
 * moving it buys nothing and would need its own evidence: the two placements are
 * not equivalent in general (a root that composes without building a server runs
 * one and not the other), and the current one is what every deployment has been
 * running. `BACKEND_ROLE=worker` is **not** the distinguishing case — `worker.ts`
 * calls `buildServer` too, precisely to register module plugins — so anyone
 * arguing for the move has to find the case that is.
 *
 * The harness cannot catch this: `test-server.ts` passes no registry at all, so
 * `reconcileBundles` has always been a no-op under `setupBackendServer`. Hence
 * a unit test over a hand-built context, asserting the *timing* directly —
 * nothing during registration, nothing during boot, exactly one pass when the
 * plugins are attached.
 */

const MODULE_ID = '_i18n';

interface Harness {
  ctx: ModuleContext;
  sink: ModuleRegistrationSink;
  reconciles: () => number;
}

function build(): Harness {
  const container = createRootContainer();
  const sink = createModuleRegistrationSink();
  let reconciles = 0;

  // `asValue`, matching `registerOrm`: a transient here would make Awilix
  // refuse the singleton service that depends on it, which is a property of
  // this stub rather than of the module.
  container.register({
    emFactory: asValue(() => {
      throw new Error('the reconcile stand-in never touches the database');
    }),
  });

  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  // Stand in for the lifecycle registry accessor the root supplies. Counting
  // the *reads* is the checkable form of "the reconcile ran": the module only
  // resolves this to walk the manifests.
  container.register({
    lifecycleManifestRegistry: asValue(() => {
      reconciles += 1;
      return { modules: new Map() };
    }),
    // The route registrar reads these; neither is exercised by a reconcile.
    adminUserService: asValue({} as never),
    requireAdmin: asValue(() => async () => undefined),
    adminContextResolver: asValue(() => ({ adminUserId: 'test-admin' })),
  });

  return { ctx, sink, reconciles: () => reconciles };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('_i18n — the reconcile runs on plugin attach, never on boot', () => {
  it('does not reconcile while the module is registering', () => {
    const h = build();
    registerModule(h.ctx);
    expect(h.reconciles()).toBe(0);
  });

  it('does not reconcile from a boot hook', async () => {
    const h = build();
    registerModule(h.ctx);
    for (const hook of h.sink.bootHooks) await hook();
    // The module registers no boot hook at all — the reconcile lives in the
    // `ctx.routes` callback — so draining `sink.bootHooks` reconciles nothing.
    // That is the property this file pins; the header says why it stays.
    expect(h.reconciles()).toBe(0);
  });

  it('reconciles exactly once when the plugin is attached', async () => {
    const h = build();
    registryCache.__setEnabledForTesting([MODULE_ID]);
    registerModule(h.ctx);

    const app = Fastify();
    // The module's routes carry Zod schemas; a bare app has no compiler for
    // them. Matches `buildServer`.
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    for (const plugin of h.sink.plugins) await app.register(plugin);
    await app.ready();

    expect(h.reconciles()).toBe(1);
    await app.close();
  });
});
