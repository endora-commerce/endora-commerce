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

/**
 * `audit_logs` off-state — Constitution XVII item 6, for the module feature
 * 091's Phase 4 batch four moved into its own package.
 *
 * **This is the module batch one rejected by name**, and the rejection was
 * right for batch one: the pilot's job was to prove the four instruments go red
 * when they should, and for that it needed a real off state to drive.
 * `plan.md`'s Ruling 2 says it cannot be a rule about which modules may move at
 * all — `specs/deferred-defects.md` scopes item 6 to the modules that declare
 * an `activation.settingCode` without `nonDeactivatable`, so a locked module is
 * outside that population by the owner's own measurement.
 *
 * What is asserted is therefore the axis this module has. `expectModuleAbsent`
 * reads the lock off the manifest and switches shape by itself: a seeded
 * deactivation must leave the module **present** (the door is proved shut), and
 * the platform axis — which a deployment that never installs it reaches — is
 * then driven for real. The last assertion states the closed axis in the
 * module's own words, so the missing case is a fact about `audit_logs` rather
 * than an absence a reader has to infer.
 *
 * The **palette action** is this batch's addition and is asserted here because
 * the Actions group is resolved by the server, from the manifests, against the
 * effective enabled-set — no admin-side test can see it. Until this merge
 * request there was no action to assert: `audit_logs` is one of the fifteen
 * modules `specs/deferred-defects.md` still lists as having an admin screen and
 * no ⌘K entry, and Phase 2 item 6's off-state obligation is exactly what makes
 * that debt payable.
 *
 * The **route and the sidebar entry** are withdrawn at render by the admin's
 * own `isSurfaceVisible`, and are proved in
 * `admin/test/modules/audit-logs.module-owned-surface.test.tsx`.
 */
describe('audit_logs off-state, from a package (Constitution XVII)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is absent from every surface while off, and restored after', async () => {
    await expectModuleAbsent(h, 'audit_logs', {
      routes: [
        // The moved viewer's own read, and the dashboard's recent-activity feed
        // — the module's two admin surfaces, the second of which is rendered
        // inside a screen `home` owns and would otherwise keep answering.
        { url: '/api/v1/admin/audit-log', cookies: admin },
        { url: '/api/v1/admin/audit-log/recent-activity', cookies: admin },
      ],
      adminPresence: { cookies: admin },
      // No `settingWrite`: this module declares a settings **group** and no
      // setting at all — the group is kept as a reservation, its one member
      // having gone with the activation control it backed (feature 074). There
      // is no ordinary configuration surface to prove non-editable.
    });
  });

  it('advertises its palette action while on and none while off', async () => {
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

    // The positive control first: an absence proves nothing until the presence
    // has been seen, and this module's entry did not exist before this batch.
    expect((await advertised()).get('audit_logs')).toEqual(['open-audit-log']);

    const baseline = registryCache.enabledIds();
    try {
      registryCache.__setEnabledForTesting(baseline.filter((id) => id !== 'audit_logs'));
      expect(effectiveState.isPresent('audit_logs')).toBe(false);
      const off = await advertised();
      expect(off.get('audit_logs') ?? []).toEqual([]);
      // Still a live registry, so the empty answer is about this module rather
      // than about the endpoint.
      expect(off.get('analytics')).toBeDefined();
    } finally {
      registryCache.__setEnabledForTesting(baseline);
    }

    expect((await advertised()).get('audit_logs')).toEqual(['open-audit-log']);
  });

  it('has no operator axis at all, and that is the module saying so', () => {
    const activation = REGISTERED_MANIFESTS.find((e) => e.manifest.id === 'audit_logs')?.manifest
      .activation;
    expect(activation).toBeDefined();
    expect(activation && 'nonDeactivatable' in activation).toBe(true);
    expect(registryCache.activationDeclaration('audit_logs')?.settingCode).toBeNull();
  });
});
