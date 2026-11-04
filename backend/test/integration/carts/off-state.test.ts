import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { expectModuleAbsent } from '../../helpers/off-state.js';
import { seedCartOrganization } from '../../helpers/cart-approval-roles.js';

/**
 * `carts` off-state — Constitution XVII item 6, for the module feature 091's
 * Phase 4 batch four moved into its own package.
 *
 * There was no off-state test for this module before, and batch two says why:
 * it declares `activation.nonDeactivatable`, and both previous batches read
 * that as *"the off-state test item 6 requires has no off state to drive"*.
 * `plan.md`'s Ruling 2 measures that as wrong. `specs/deferred-defects.md`'s
 * off-state-coverage entry scopes item 6 to the modules that declare an
 * `activation.settingCode` **without** `nonDeactivatable`, so a locked module
 * is outside that population by the owner's own measurement rather than by an
 * exception this batch grants itself — and what a locked module still has is
 * the platform axis, which a deployment that never installs it reaches, plus a
 * closed operator axis that is worth **asserting closed** rather than skipping.
 *
 * Both are driven, and neither is a flag this file passes:
 *
 *  * `expectModuleAbsent` reads `nonDeactivatable` off the manifest itself and
 *    switches shape — it seeds a deactivation, requires the module to stay
 *    **present** under it, and then drives the platform axis. A caller cannot
 *    ask for the wrong one (issue #141);
 *  * the last assertion below says the same thing in the module's own words, so
 *    the closed axis is a stated fact about `carts` and not an absence a reader
 *    has to infer from a test that is shorter than its neighbours'.
 *
 * The **route** is the surface that moved, nav-less at the time, so
 * `plan.md`'s Ruling 1 put the admin-side proof over the route —
 * `admin/test/modules/carts.module-owned-surface.test.tsx`, which since issue
 * #510 drives the sidebar entry too. What is asserted here is the half no admin
 * test can see: the API refusing, the presence projection reporting it absent,
 * the configuration not being editable, and the palette withdrawing the
 * `open-carts` action.
 */
describe('carts off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'carts', {
      routes: [
        // The two screens' own reads — the list the moved `CartsList` calls and
        // the detail `CartDetail` calls — plus the storefront cart, which is
        // the surface a shopper meets and the one an operator would be most
        // surprised to find still answering.
        { url: '/api/v1/admin/carts', cookies: admin },
        { url: '/api/v1/admin/carts/00000000-0000-4000-8000-0000000000c1', cookies: admin },
        { url: '/api/v1/cart', headers: { 'x-sales-channel': 'default' } },
      ],
      adminPresence: { cookies: admin },
      settingWrite: {
        // An ordinary setting this module owns, not its activation control:
        // `carts` declares itself non-deactivatable, so it has no activation
        // setting at all, and this is the abandonment threshold.
        code: 'carts.abandonment.inactivity_minutes',
        value: 4321,
        cookies: admin,
      },
    });
  });

  it('advertises its palette action while on, and none while off', async () => {
    // Principle XVII item 5's palette half, resolved by the server from the
    // manifests against the effective enabled-set — which is why it cannot be
    // asserted from the admin at all.
    //
    // `open-carts` arrived with issue #510 (Principle XVI). The expected ids are
    // read from the manifest, and the manifest is required to declare exactly
    // that one, so a later action fails here and asks for its own off-state.
    const manifest = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'carts')?.manifest;
    expect(manifest, 'carts is not a registered module').toBeDefined();
    expect((manifest?.actions ?? []).map((action) => action.id)).toEqual(['open-carts']);

    const advertised = async (): Promise<Map<string, string[]>> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/admin-actions?language=en',
        cookies: admin,
      });
      expect(res.statusCode, 'the palette registry must answer').toBe(200);
      const body = res.json() as { data: { data: { actionId: string; moduleId: string }[] } };
      const grouped = new Map<string, string[]>();
      for (const action of body.data.data) {
        grouped.set(action.moduleId, [...(grouped.get(action.moduleId) ?? []), action.actionId]);
      }
      return grouped;
    };

    // The positive control, and it is about another module on purpose: an empty
    // answer for `carts` proves nothing until the registry has been seen
    // answering somebody.
    const on = await advertised();
    expect(on.get('analytics'), 'the palette advertises nothing at all').toBeDefined();
    expect(on.get('carts') ?? []).toEqual(['open-carts']);

    const baseline = registryCache.enabledIds();
    try {
      registryCache.__setEnabledForTesting(baseline.filter((id) => id !== 'carts'));
      expect(effectiveState.isPresent('carts')).toBe(false);
      const off = await advertised();
      expect(off.get('carts') ?? []).toEqual([]);
      expect(off.get('analytics')).toBeDefined();
    } finally {
      registryCache.__setEnabledForTesting(baseline);
    }
    expect((await advertised()).get('carts') ?? []).toEqual(['open-carts']);
  });

  it('takes its three organization permissions out of the catalogue and every effective set while absent, keeping the grants', async () => {
    // `specs/170-organization-roles/` WP-04, T070 (FR-007, FR-025, SC-007).
    // Presence is read at call time, so the platform axis alone moves them.
    const CODES = ['carts.approve', 'carts.create', 'carts.order_without_approval'];
    const org = await seedCartOrganization(h, {
      label: 'WP-04 carts off-state',
      members: { ADMIN: 'administrator', HOLDER: { permissions: ['carts.create', 'carts.approve'] } },
    });
    try {
      const read = async (key: string, url: string) => {
        const res = await h.app.inject({
          method: 'GET',
          url,
          cookies: { b2b_session: org.actors[key]!.cookie },
          // The fixture Organization is bound to `pl_retail`, not to the default store.
          headers: { 'accept-language': 'en', 'x-sales-channel': 'pl_retail' },
        });
        expect(res.statusCode, `${url}: ${res.body}`).toBe(200);
        return res.json() as Record<string, unknown>;
      };
      const catalogueCodes = async (): Promise<string[]> => {
        const body = (await read('ADMIN', '/api/v1/organizations/mine/permission-catalogue')) as {
          data: { groups: Array<{ permissions: Array<{ code: string }> }> };
        };
        return body.data.groups.flatMap((group) => group.permissions.map((p) => p.code));
      };
      const ownCodes = async (key: string): Promise<string[]> => {
        const body = (await read(key, '/api/v1/organizations/mine/role')) as {
          data: { permissions: Array<{ code: string }> };
        };
        return body.data.permissions.map((p) => p.code);
      };
      const storedGrants = async (): Promise<string[]> => {
        const [row] = (await h
          .em()
          .getConnection()
          .execute(`select "permissions" from "organization_roles" where "id" = ?`, [
            org.actors['HOLDER']!.roleId,
          ])) as Array<{ permissions: string[] }>;
        return [...row!.permissions].sort();
      };

      expect(await catalogueCodes()).toEqual(expect.arrayContaining(CODES));
      expect(await ownCodes('ADMIN')).toEqual(expect.arrayContaining(CODES));
      expect((await ownCodes('HOLDER')).sort()).toEqual(['carts.approve', 'carts.create']);

      const baseline = registryCache.enabledIds();
      try {
        registryCache.__setEnabledForTesting(baseline.filter((id) => id !== 'carts'));
        expect(effectiveState.isPresent('carts')).toBe(false);
        const offCatalogue = await catalogueCodes();
        for (const code of CODES) expect(offCatalogue, code).not.toContain(code);
        const offAdmin = await ownCodes('ADMIN');
        for (const code of CODES) expect(offAdmin, code).not.toContain(code);
        expect(await ownCodes('HOLDER')).toEqual([]);
        // Off is non-destructive: the grant stays stored.
        expect(await storedGrants()).toEqual(['carts.approve', 'carts.create']);
      } finally {
        registryCache.__setEnabledForTesting(baseline);
      }

      expect(await catalogueCodes()).toEqual(expect.arrayContaining(CODES));
      expect((await ownCodes('HOLDER')).sort()).toEqual(['carts.approve', 'carts.create']);
    } finally {
      org.release();
    }
  });

  it('has no operator axis at all, and that is the module saying so', () => {
    // Ruling 2's *"the missing fourth is missing because the platform refuses to
    // have it, which is a fact about the module and is asserted as one"*. Read
    // from the manifest rather than written here, so a module that is later
    // unlocked makes this red and asks for the fourth case to be written.
    const activation = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'carts')?.manifest
      .activation;
    expect(activation).toBeDefined();
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
    // And the platform enforces it: `activationDeclaration` carries a `null`
    // setting code, which is what makes `withModuleOff(…, 'deactivated', …)`
    // refuse this module rather than seed a value nothing reads.
    expect(registryCache.activationDeclaration('carts')?.settingCode).toBeNull();
  });
});
