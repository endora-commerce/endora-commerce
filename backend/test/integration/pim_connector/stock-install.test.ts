import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS } from '@endora-commerce/contracts';
import { effectiveState, Setting } from '@endora-commerce/platform/kernel';
import { registryCache } from '@endora-commerce/platform/composition';
import { deploymentFamilyOf } from '../../helpers/capability-families.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T033 / SC-005 — **on a stock install, no PIM connector is activated, and activating
 * any one of them succeeds.**
 *
 * This is the inverse of the defect measured at T001, and it is worth stating what that
 * defect was, because this file is the only place the repaired state is asserted end to
 * end. Three of the four connectors shipped `activation.default: true`. The exclusion is
 * a `pre` interceptor on the activation route, so it guards the **transition** and not
 * the existing state: all three were effectively present from the first boot, no
 * transition was ever refused, and nothing reported it. The one connector that did call
 * the registry was then refused activation out of the box, with a 409 naming a connector
 * nobody had configured.
 *
 * ## What "a stock install" means here, precisely
 *
 * Two things, and the second is the one a reader should check.
 *
 * The **schema** is stock: the suite leases its own database per invocation, migrated
 * from the registry. The **operator choice** is made stock by this file: the suite shares
 * that database across test files, so an earlier file may have written an activation row,
 * and those rows are nulled below. `global_value = NULL` is exactly "no operator has
 * chosen" — the state a fresh install is in — and what remains is `default_value`, which
 * the manifest reconciler wrote from each module's own settings declaration. That is the
 * value `resolveActivation` reads, and reading it from the row rather than from
 * `activation.default` is why FR-017's flip had to move **both** (a manifest-only flip
 * leaves the connector on for every database the reconciler has touched).
 *
 * The presence refresh is then the real one: `__refreshActivationForTesting` re-resolves
 * the operator axis from that database over the real manifest-derived declarations. The
 * harness otherwise seeds every module activated, which would make this file assert the
 * harness rather than the manifests.
 *
 * **Composed as the `example` deployment** (feature 134, T113, `research.md` D13 §6):
 * its two overlay PIM fixtures are the members that stay once every packaged connector
 * has left this repository, and "the second one is still refused" needs two.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEPLOYMENT = 'example';
const { members: FAMILY, overlay: OVERLAY_MEMBERS } = await deploymentFamilyOf(
  CAPABILITY_KEYS.PIM_CONNECTOR,
  DEPLOYMENT,
);

describe('pim_connector — the stock install activates no connector [SC-005]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: DEPLOYMENT });
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Return the family to "no operator has chosen", and re-resolve from the database. */
  async function asStockInstall(): Promise<void> {
    const codes = FAMILY.map((id) => effectiveState.activationSettingCode(id)).filter(
      (code): code is string => code !== null,
    );
    expect(codes, 'every member must declare an activation control (R4.1)').toHaveLength(
      FAMILY.length,
    );
    await h.em().nativeUpdate(Setting, { code: { $in: codes } }, { globalValue: null });
    await registryCache.__refreshActivationForTesting(h.em);
  }

  it('derived a family to judge', () => {
    expect(FAMILY.length).toBeGreaterThan(1);
    // W6 — two members that are no packaged connector, so the family still has a
    // "second one" to refuse once every packaged connector has left.
    expect(OVERLAY_MEMBERS.length, FAMILY.join(', ')).toBeGreaterThan(1);
  });

  it('activates none of them, and every one reports both axes honestly', async () => {
    await asStockInstall();

    const state = FAMILY.map((id) => {
      const presence = effectiveState.presence(id);
      return {
        id,
        operatorActivated: presence?.operatorActivated,
        platformAvailable: presence?.platformAvailable,
        isPresent: effectiveState.isPresent(id),
      };
    });

    // The platform axis stays on — the deployment ships them, which is the point of
    // Principle XVII's two axes being orthogonal. It is the operator axis that is off.
    for (const entry of state) {
      expect(entry.platformAvailable, `${entry.id} platform axis`).toBe(true);
      expect(entry.operatorActivated, `${entry.id} operator axis`).toBe(false);
      expect(entry.isPresent, `${entry.id} effective presence`).toBe(false);
    }

    // And therefore nobody holds the claim, which is the state the 409 came out of.
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([]);
  });

  it.each(FAMILY)(
    'activates %s out of the box, with no other connector to switch off first',
    async (moduleId) => {
      await asStockInstall();

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/modules/${moduleId}/activation`,
        ...ADMIN,
        payload: { active: true },
      });

      // The whole defect, from the operator's side: this was a 409 naming a connector
      // they had not configured, for three of the four members.
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        module: { id: moduleId, activated: true, present: true },
      });
    },
    60_000,
  );

  it('and the second one is still refused — the exclusion is intact, not removed', async () => {
    // The repair must not have been "stop excluding". Two members, arranged from the
    // stock state: the first succeeds, the second is refused naming the first.
    await asStockInstall();

    const [first, second] = FAMILY;
    const claimed = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${first!}/activation`,
      ...ADMIN,
      payload: { active: true },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);

    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${second!}/activation`,
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: { details: { activeModuleId: first } },
    });
  });
});
