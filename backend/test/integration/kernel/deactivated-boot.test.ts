import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * The backend still boots with a module switched off (feature 072, D-40).
 *
 * `production-boot.test.ts` proves the deployment root boots with everything
 * on. This file proves the other half of Constitution XVII: switching a module
 * off is a supported, reversible operator action, so it must not be able to
 * stop the next start. It could — `composeApp()` read four gated ports at its
 * top level, one per deactivatable module, and `providePort` gates a port on
 * its owner's effective state at **resolution**. Flipping a module off on
 * `/platform/modules` therefore left the running process untouched and killed
 * the one after it: `composeApp()` threw `ModuleDisabledError`, `index.ts` made
 * that `process.exit(1)`, and with the API down the operator could not reach
 * the screen to undo their own change.
 *
 * D-39 added the mirror image, and it is the worse half. The four sites above
 * are a module reading somebody else's port at boot; the one added with it is a
 * **host** whose contribution registry was a gated port, so switching the *host*
 * off made every contributor's boot hook throw. Same crash, and a failure
 * message naming a module the operator never touched.
 *
 * **One composition, five deactivations.** The sites are independent — each reads
 * a name owned by exactly one module — so deactivating all five at once exercises
 * all five, and the presence assertions below name each one so a regression says
 * which. That matters: `production-boot.test.ts` states the budget, one
 * composition per suite run, and this is the second. Five would be six, for
 * nothing. The cost of sharing the boot is attribution: composition stops at the
 * first offending read, so every case fails together and names the module that
 * threw — the one reached first, not necessarily the only one broken.
 *
 * **What this covers and what it does not.** It covers what composition and
 * `buildServer` do when `effectiveState` answers "absent" — boot hooks, root
 * wiring, plugin bodies, the health route. It does **not** cover how that
 * answer is reached from PostgreSQL: `loadModulePresence` still runs for real
 * here, and the operator's write is then applied through
 * `registryCache.__setEnabledForTesting`, the seam whose own note says it counts
 * as a load. The settings-row → activation-value path is feature 073's, and
 * `test/unit/_lifecycle/activation-resolver.test.ts` owns it.
 */

/**
 * The operator axis: modules an operator can switch off from `/platform/modules`.
 *
 * The last one is D-39's half of the same property, and it is a **host** of a
 * contribution registry rather than a consumer of a port: `cms` owns the
 * registry `megamenu` pushes a scanner into. It was a `providePort` name
 * resolved from `ctx.onBoot`, so switching it off made *another* module's boot
 * hook throw `MODULE_DISABLED` during composition — the operator broke the next
 * start by switching off a module they were entitled to switch off, and the
 * failure named a module they had not touched. It is `ctx.di.register` now: a
 * table of inert descriptors is not a gate, and the behavioural seams beside it
 * (the CMS services) still are.
 *
 * `transactional_emails` was the second host here, and the larger one — seven
 * modules push their email defaults into its registry. It left this list with
 * issue #88: the module declares itself non-deactivatable, so `effectiveState`
 * forces its operator axis on whatever a Setting says and the state this file
 * simulates is one no operator and no CLI can reach. `emailDefaultsPort` stays
 * an ungated `ctx.di.register` — the reason in `transactional_emails/backend.ts`
 * is about the shape of a contribution seam, not about who may switch the host
 * off — and `cms` keeps that shape covered here. What replaced the coverage is
 * per-email: an operator switches an individual email off instead, which is
 * `test/integration/transactional_emails/per-email-activation.test.ts`.
 */
const DEACTIVATED = [
  'comparisons',
  'invoices',
  'credit_limits',
  'admin_actions',
  'cms',
  // Issue #90: the twelve `ctx.routes` bodies that still destructured their own
  // gated port. Ten were the named `WIRING_RESOLUTIONS_TO_DRAIN` inventory; two
  // more were invisible to the check until it learned to follow a module-local
  // cradle alias. Every one of them stopped the next start before this list
  // named it.
  'admin_notifications',
  'credentials',
  'payments',
  'promotions',
  'shipments',
  'webhooks',
  // Feature 074 gave this module an activation control it never had, which
  // moves it from the platform list below onto this one. The read it covers is
  // unchanged; what changed is who can produce the state.
  'mfa',
] as const;

/**
 * The platform axis, in the same boot — modules this deployment does not offer.
 *
 * Four of them arrive here from the operator list (feature 074): `carts`,
 * `sales_channels`, `settings` and `taxes` are core now, and
 * `effectiveState` forces a core module's operator axis on whatever a Setting
 * says, so seeding them as deactivated would have simulated a state no operator
 * and no CLI can reach — and the boot cases under them would have passed
 * without the modules ever being absent. Absence is still reachable for every
 * one of them, by the axis that was always the deployment's: a build that never
 * installs the module. That is the same absence at the same reads, which is
 * what these cases are about, so the coverage of issue #90's `carts` and
 * `settings` sites is preserved rather than dropped.
 *
 * `health_checks` is here for a second reason as well: it is the one module
 * that declares no activation block at all, so with its registry row gone it is
 * unknown to *both* axes — the tri-state's "not a module this deployment has",
 * which is a different answer from "installed and absent". Its probes answer
 * regardless, because `ctx.ungatedRoutes` exempts them, and the health-route
 * case at the bottom of this file is what shows it.
 */
const PLATFORM_UNAVAILABLE = [
  'carts',
  'sales_channels',
  'settings',
  'taxes',
  'health_checks',
] as const;

/** The only one of those with no activation declaration, hence no presence row. */
const UNDECLARED = 'health_checks';

const ALL_MODULE_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

/**
 * Whether the mock below is simulating the absences yet.
 *
 * `false` for the warm-up boot in `beforeAll` — see the note there — and `true`
 * for the composition every case in this file is about.
 */
let simulatingAbsence = false;

/**
 * The operator's write, without a database.
 *
 * `composeApp()` loads presence from PostgreSQL before the first module
 * registers, so a state seeded before the call would simply be overwritten. The
 * real load still runs; this re-applies the two axes on top of it, exactly as
 * an operator who had flipped four activation Settings and disabled one module
 * would have left them.
 */
vi.mock('../../../src/modules/_lifecycle/services/presence-load.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../src/modules/_lifecycle/services/presence-load.js')
    >();
  return {
    ...actual,
    loadModulePresence: async (
      opts: Parameters<typeof actual.loadModulePresence>[0],
    ): Promise<void> => {
      await actual.loadModulePresence(opts);
      if (!simulatingAbsence) return;
      const { registryCache: cache } =
        await import('../../../src/kernel/lifecycle/registry-cache.js');
      cache.__setEnabledForTesting(
        ALL_MODULE_IDS.filter((id) => !(PLATFORM_UNAVAILABLE as readonly string[]).includes(id)),
        { deactivated: [...DEACTIVATED] },
      );
    },
  };
});

describe('the production composition root boots with modules switched off', () => {
  let composition:
    | Awaited<ReturnType<typeof import('../../../src/composition.js').composeApp>>
    | undefined;
  let app: FastifyInstance | undefined;
  let compositionError: unknown;
  const originalRole = process.env['BACKEND_ROLE'];

  beforeAll(async () => {
    // Asserted, not trusted — same reason as `production-boot.test.ts`: a
    // production boot pointed at the dev database would reconcile registry
    // rows, settings and i18n bundles into it.
    const url = process.env['DATABASE_URL'];
    expect(url, 'DATABASE_URL must be set by test/global-setup.ts').toBeTruthy();
    expect(new URL(url as string).pathname.replace(/^\//, '')).toMatch(/(^|_)test(_|$)/);

    // HTTP only, so this boot starts no queue consumers on the shared Redis.
    process.env['BACKEND_ROLE'] = 'api';

    const { composeApp } = await import('../../../src/composition.js');
    const { buildServer } = await import('../../../src/http/server.js');

    // A **third** composition, against the budget `production-boot.test.ts`
    // states, and it buys a stated premise rather than another case.
    //
    // This file's subject is a platform that has run before and is now being
    // started with modules switched off. It used to get that for free: every
    // invocation shared one `b2b_test`, so by the time this file ran, some
    // other file had booted the platform and every module's one-time boot write
    // was already done. Since issue #189 a run starts from a freshly migrated
    // clone, and the premise has to be established rather than inherited —
    // otherwise this file passes or fails on which files ran before it, which
    // is the property that issue is about. Run alone against a fresh database
    // on the pre-#189 harness, it failed 19 of its 22 cases.
    //
    // It also names a hazard this file exists to prevent, now standing again:
    // `invoices` grandfathers its numbering pattern from a `ctx.onBoot` hook
    // (feature 078, D-95.3), the write goes through `settings`' port, and the
    // service rethrows `ModuleDisabledError` deliberately — "the write is the
    // whole point of the hook". So a **first** boot of a deployment that does
    // not install `settings` still dies in composition, exactly the D-40 shape
    // described at the top of this file. The warm-up makes that write happen
    // once, with everything present, which is what a real upgrade does; it does
    // not repair the first-boot case, and nothing here claims it does.
    simulatingAbsence = false;
    const warmup = await composeApp();
    await warmup.dispose();

    simulatingAbsence = true;
    try {
      composition = await composeApp();
      app = await buildServer({
        sessionCookieSecret: 'deactivated-boot-test-secret',
        openApi: {
          title: 'B2B Platform API',
          version: '0.0.0',
          serverUrl: 'http://localhost:3001',
        },
        modules: composition.modules,
        errorEnvelope: composition.errorEnvelope,
        apiInterceptors: composition.apiInterceptors,
      });
    } catch (err) {
      // Captured rather than thrown, so the failure reads as "the backend does
      // not start with `comparisons` off" instead of as a `beforeAll` crash
      // that reports every case as an error.
      compositionError = err;
    }
  });

  afterAll(async () => {
    registryCache.stopFallbackRefresh();
    if (app) await app.close();
    if (composition) await composition.dispose();
    registryCache.__setEnabledForTesting(ALL_MODULE_IDS);
    if (originalRole === undefined) delete process.env['BACKEND_ROLE'];
    else process.env['BACKEND_ROLE'] = originalRole;
  });

  it('has every deactivated module genuinely absent, each for its own reason', () => {
    for (const moduleId of DEACTIVATED) {
      const presence = effectiveState.presence(moduleId);
      expect(presence?.platformAvailable, `${moduleId} platform axis`).toBe(true);
      expect(presence?.operatorActivated, `${moduleId} operator axis`).toBe(false);
      expect(effectiveState.isPresent(moduleId), `${moduleId} effective presence`).toBe(false);
    }
  });

  it('has every platform-unavailable module absent on the other axis', () => {
    for (const moduleId of PLATFORM_UNAVAILABLE) {
      if (moduleId === UNDECLARED) continue;
      const presence = effectiveState.presence(moduleId);
      expect(presence?.platformAvailable, `${moduleId} platform axis`).toBe(false);
      // Core, so the operator axis reads `true` whatever is stored — and the
      // conjunction is still absent. That is the two axes staying orthogonal,
      // which is the property that makes this list a valid substitute for the
      // deactivation it replaced.
      expect(presence?.operatorActivated, `${moduleId} operator axis`).toBe(true);
      expect(effectiveState.isPresent(moduleId), `${moduleId} effective presence`).toBe(false);
    }
  });

  it('has the one module with no activation declaration unknown to both axes', () => {
    expect(effectiveState.isPresent(UNDECLARED)).toBe(false);
    expect(effectiveState.presence(UNDECLARED)).toBeUndefined();
  });

  for (const moduleId of DEACTIVATED) {
    it(`composes with \`${moduleId}\` deactivated`, () => {
      expect(compositionError, describeFailure(moduleId, compositionError)).toBeUndefined();
      expect(composition?.modules.length).toBeGreaterThan(0);
    });
  }

  for (const moduleId of PLATFORM_UNAVAILABLE) {
    it(`composes with \`${moduleId}\` platform-unavailable`, () => {
      expect(compositionError, describeFailure(moduleId, compositionError)).toBeUndefined();
    });
  }

  it('builds the server, so every module plugin body ran with them off', () => {
    expect(app).toBeDefined();
  });

  it('answers a request, which is what "the backend started" means', async () => {
    // And it answers it from `health_checks`, which this boot did not install:
    // the probes are exempt from gating through `ctx.ungatedRoutes`, which is
    // the whole reason that module declares no activation control (feature 074,
    // FR-013). If gating ever reached them, a deployment could lose its own
    // liveness endpoint by withdrawing a module — and this case would say so.
    const health = await app!.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(health.statusCode).toBe(200);
  });
});

function describeFailure(moduleId: string, err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return (
    `\`${moduleId}\` being absent must not stop the next start — ` +
    `composeApp()/buildServer() threw, which index.ts turns into process.exit(1): ${message}`
  );
}
