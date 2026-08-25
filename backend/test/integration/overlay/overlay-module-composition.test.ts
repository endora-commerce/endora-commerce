import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { resolvedManifestEntries } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';

/**
 * T-B / T-C — a deployment's overlay module, composed by the real harness.
 *
 * These are the tests the overlay path never had, and their absence is what
 * `!705` nearly shipped through: an owner-check on `ctx.di.decorate` that would
 * have passed the entire suite and broken the first client deployment to use
 * the path. Nothing below could exist before D-104 — a test of overlay
 * composition had to regenerate `composition.generated.ts` with `DEPLOYMENT`
 * set, that is, mutate a committed core artefact, before it could run.
 *
 * The module reaches the harness through the same `loadOverlayModuleEntries`
 * discovery production uses, appended to the same single `composeModules` call.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
/** The seeded admin whose role holds only `orders:read` (see `seed-admins.ts`). */
const RESTRICTED = { b2b_session: 'stub-restricted-admin-session' };
const PING = '/api/v1/admin/example-overlay/ping';

describe('T-B — the example deployment’s overlay module is composed and reachable [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers 200 to an admin holding the module’s permission', async () => {
    const res = await h.app.inject({ method: 'GET', url: PING, cookies: ADMIN });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['pong']).toBe(true);
    expect(body['module']).toBe('example_overlay');
    // Registered through `ctx.di.register` and resolved out of the container:
    // an overlay module owns registrations like any other module.
    expect(body['greeting']).toBe('example overlay');
  });

  it('carries the post-phase stamp of the interceptor the module registered', async () => {
    const res = await h.app.inject({ method: 'GET', url: PING, cookies: ADMIN });
    expect((res.json() as Record<string, unknown>)['stampedByOverlay']).toBe(true);
  });

  it('attributes that interceptor to the module, from module.id and not a string', async () => {
    const stamp = h.apiInterceptors.list().find((entry) => entry.id === 'stamp-ping');
    expect(stamp?.module).toBe('example_overlay');
  });

  it('answers 403 to an admin without the permission', async () => {
    const res = await h.app.inject({ method: 'GET', url: PING, cookies: RESTRICTED });
    expect(res.statusCode).toBe(403);
  });

  it('puts the module’s permission in the deployment’s grantable catalogue', async () => {
    const assignable = new Set(
      listAssignablePermissionCodes(await resolvedManifestEntries({
        DEPLOYMENT: 'example',
      } as NodeJS.ProcessEnv)),
    );
    expect(assignable.has('example_overlay:manage')).toBe(true);
  });

  it('decorates the core pricing registration for this deployment, exactly once', async () => {
    // The decoration is applied by `composeModules`, so what a consumer of
    // `pricingService` resolves in a real composition is the wrapper. Asserted
    // on the resolved object rather than on a price, because the pricing inputs
    // are `price_lists`' business and this is a composition question.
    const cradle = h.container.cradle as unknown as Record<string, unknown>;
    expect(cradle['pricingService']).toBeDefined();

    // **Exactly one**, and the count is the assertion. This deployment used to
    // override `pricingService` twice — once from `example_overlay` and once
    // from `apps/example/decorations/pricing-service.ts` — so a resolved line
    // price came back tagged `overlay:overlay:<id>` in production while the
    // harness, which composed only the first, produced one tag. There is one
    // mechanism now, both roots run it, and this is where a second one
    // reappearing would show up.
    const wraps = h.composedDecorations.filter((entry) => entry.name === 'pricingService');
    expect(wraps).toHaveLength(1);
    expect(wraps[0]?.moduleId).toBe('example_overlay');
  });
});

describe('T-C — switching the overlay module off [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /**
   * The checklist item-6 off-state test the overlay path has never had.
   *
   * It goes red against the pre-D-103 tree by construction: there, the route
   * was a bare `app.get` in a `plugin.ts` that `composition.ts` pushed into
   * `modules` unwrapped, so switching the module off left it answering 200 —
   * and the manifest declared no `activation` block at all, so there was
   * nothing to switch.
   */
  it('answers MODULE_DISABLED while deactivated, and is restored when switched back on', async () => {
    await withModuleOff('example_overlay', 'deactivated', async () => {
      const res = await h.app.inject({ method: 'GET', url: PING, cookies: ADMIN });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error?: { code?: string } }).error?.code).toBe('MODULE_DISABLED');
    });

    const restored = await h.app.inject({ method: 'GET', url: PING, cookies: ADMIN });
    expect(restored.statusCode).toBe(200);
  });

  /**
   * §4's T-C: `example_overlay:manage` must leave the grantable set while the
   * module is deactivated.
   *
   * This case was written the other way up. When !716 landed, it asserted that
   * the code **stayed** grantable and named the two reasons — the catalogue
   * filtered on `registryCache.enabledIds()`, which is the platform axis alone,
   * and `listAssignable()` memoised into a field nothing dropped on a state
   * flip — so that the platform-wide gap was pinned rather than hidden behind an
   * overlay-shaped assertion. Issue #213 closed it: the catalogue reads
   * `effectiveState.isPresent` and keeps no memo. What is kept from the original
   * is the shape that made it worth writing — the **core control** below, which
   * is what tells a defect in `admin_roles` apart from a defect in the overlay
   * path.
   */
  it('takes the permission out of the grantable set while deactivated', async () => {
    const codesWhileOff = await withModuleOff('example_overlay', 'deactivated', () =>
      h.permissionCatalogueService.listAssignable().map((entry) => entry.code),
    );
    expect(codesWhileOff).not.toContain('example_overlay:manage');

    // The same holds for a core module with an activation control, which is what
    // makes this a property of the catalogue rather than of the overlay path.
    // Without this half the case would read as an overlay fix.
    const blogCodesWhileOff = await withModuleOff('blog', 'deactivated', () =>
      h.permissionCatalogueService.listAssignable().map((entry) => entry.code),
    );
    expect(blogCodesWhileOff.some((code) => code.startsWith('blog.'))).toBe(false);
  });

  it('puts the permission back when the module is switched on again', async () => {
    // Off is non-destructive and reversible, and the catalogue is where that is
    // cheapest to get wrong: a memo dropped on the way off and never rebuilt
    // looks identical to a correct filter until somebody switches back on.
    const restored = h.permissionCatalogueService.listAssignable().map((e) => e.code);
    expect(restored).toContain('example_overlay:manage');
    expect(restored.some((code) => code.startsWith('blog.'))).toBe(true);
  });
});

describe('T-D — with no deployment selected, nothing of it leaks [integration]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('404s the overlay route on a bare-core composition', async () => {
    const res = await h.app.inject({ method: 'GET', url: PING, cookies: ADMIN });
    expect(res.statusCode).toBe(404);
  });

  it('leaves the module out of the bare-core resolved registry and its catalogue', async () => {
    const bareCore = await resolvedManifestEntries({} as NodeJS.ProcessEnv);
    expect(bareCore.map((e) => e.manifest.id)).not.toContain('example_overlay');
    expect(new Set(listAssignablePermissionCodes(bareCore)).has('example_overlay:manage')).toBe(
      false,
    );
  });

  it('does not register the module in the enabled set', () => {
    expect(registryCache.enabledIds()).not.toContain('example_overlay');
  });
});
