import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/modules/_lifecycle/services/effective-state.js';
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
 * are a module reading somebody else's port at boot; the two added with it are a
 * **host** whose contribution registry was a gated port, so switching the *host*
 * off made every contributor's boot hook throw. `transactional_emails` has seven
 * of them. Same crash, and a failure message naming a module the operator never
 * touched.
 *
 * **One composition, six deactivations.** The sites are independent — each reads
 * a name owned by exactly one module — so deactivating all six at once exercises
 * all six, and the presence assertions below name each one so a regression says
 * which. That matters: `production-boot.test.ts` states the budget, one
 * composition per suite run, and this is the second. Six would be seven, for
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
 * The last two are D-39's half of the same property, and they are **hosts** of a
 * contribution registry rather than consumers of a port. `cms` owns the registry
 * `megamenu` pushes a scanner into; `transactional_emails` owns the one seven
 * modules push their email defaults into. Both were `providePort` names resolved
 * from `ctx.onBoot`, so switching either off made *other* modules' boot hooks
 * throw `MODULE_DISABLED` during composition — the operator broke the next start
 * by switching off a module they were entitled to switch off, and the failure
 * named a module they had not touched. They are `ctx.di.register` now: a table of
 * inert descriptors is not a gate, and the behavioural seams beside them
 * (`templateEmailPort`, the CMS services) still are.
 */
const DEACTIVATED = [
  'comparisons',
  'invoices',
  'credit_limits',
  'admin_actions',
  'cms',
  'transactional_emails',
  // Issue #90: the twelve `ctx.routes` bodies that still destructured their own
  // gated port. Ten were the named `WIRING_RESOLUTIONS_TO_DRAIN` inventory; the
  // `carts` and `settings` ones were invisible to the check until it learned to
  // follow a module-local cradle alias, and `settings` is the one an operator
  // is most likely to reach for — D-36 made it deactivatable on purpose. Every
  // one of them is a module an operator may switch off, and every one of them
  // stopped the next start before this list named it.
  'admin_notifications',
  'carts',
  'credentials',
  'payments',
  'promotions',
  'sales_channels',
  'settings',
  'shipments',
  'taxes',
  'webhooks',
] as const;

/**
 * The platform axis, in the same boot: `mfa` declares no activation control, so
 * only a deployment operator can take it away — with `module:disable mfa`, which
 * used to be just as fatal to the next start, at the same kind of read.
 */
const PLATFORM_UNAVAILABLE = 'mfa';

const ALL_MODULE_IDS = REGISTERED_MANIFESTS.map((e) => e.manifest.id);

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
    await importOriginal<typeof import('../../../src/modules/_lifecycle/services/presence-load.js')>();
  return {
    ...actual,
    loadModulePresence: async (
      opts: Parameters<typeof actual.loadModulePresence>[0],
    ): Promise<void> => {
      await actual.loadModulePresence(opts);
      const { registryCache: cache } = await import(
        '../../../src/kernel/lifecycle/registry-cache.js'
      );
      cache.__setEnabledForTesting(
        ALL_MODULE_IDS.filter((id) => id !== PLATFORM_UNAVAILABLE),
        { deactivated: [...DEACTIVATED] },
      );
    },
  };
});

describe('the production composition root boots with modules switched off', () => {
  let composition: Awaited<ReturnType<typeof import('../../../src/composition.js').composeApp>> | undefined;
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
    // `mfa` declares no activation control, so with its registry row gone it is
    // unknown to both axes — the tri-state's "not a module this deployment has",
    // which is a different answer from "installed and switched off" above.
    expect(effectiveState.isPresent(PLATFORM_UNAVAILABLE)).toBe(false);
    expect(effectiveState.presence(PLATFORM_UNAVAILABLE)).toBeUndefined();
  });

  for (const moduleId of DEACTIVATED) {
    it(`composes with \`${moduleId}\` deactivated`, () => {
      expect(compositionError, describeFailure(moduleId, compositionError)).toBeUndefined();
      expect(composition?.modules.length).toBeGreaterThan(0);
    });
  }

  it(`composes with \`${PLATFORM_UNAVAILABLE}\` platform-unavailable`, () => {
    expect(compositionError, describeFailure(PLATFORM_UNAVAILABLE, compositionError)).toBeUndefined();
  });

  it('builds the server, so every module plugin body ran with them off', () => {
    expect(app).toBeDefined();
  });

  it('answers a request, which is what "the backend started" means', async () => {
    const health = await app!.inject({ method: 'GET', url: '/api/v1/_health' });

    expect(health.statusCode).toBe(200);
  });
});

function describeFailure(moduleId: string, err: unknown): string {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return (
    `switching \`${moduleId}\` off must not stop the next start — ` +
    `composeApp()/buildServer() threw, which index.ts turns into process.exit(1): ${message}`
  );
}
