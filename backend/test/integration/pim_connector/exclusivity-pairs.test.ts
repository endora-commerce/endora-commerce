import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T016 / SC-002 — **every ordered pair** of the PIM connector family, through the
 * one seam the exclusion has (`capability-exclusivity.md` R1.1, R2.1).
 *
 * **The family is derived, and that is the test.** `PIM_CONNECTOR_MODULES` listed
 * two of the four shipped connectors, so exclusivity covered a sixth of its
 * pairs and nobody could see it: a test written against the array is green over
 * exactly the pairs the array knows. Here the population is re-read from the
 * resolved manifest index on every run, so a fifth connector adds eight covered
 * pairs and edits no test — and a connector that stops declaring membership
 * takes its pairs out of the count instead of leaving a passing assertion behind.
 *
 * The **resolved** index rather than the generated core one, for the reason the
 * feature exists: an installed package and a per-deployment overlay module
 * declare on identical terms to a core module (R2.1), so all three belong in the
 * population a pair sweep enumerates.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const RESOLVED_MANIFESTS = await resolvedManifestEntries();

/** The family, from the members' own declarations. Sorted so the pair order is stable. */
const FAMILY: readonly string[] = RESOLVED_MANIFESTS.filter((entry) =>
  (entry.manifest.capabilities ?? []).includes(CAPABILITY_KEYS.PIM_CONNECTOR),
)
  .map((entry) => entry.manifest.id)
  .sort();

/** Every ordered pair (acting, incumbent). `n` members give `n * (n - 1)` of them. */
const PAIRS: readonly { acting: string; incumbent: string }[] = FAMILY.flatMap((acting) =>
  FAMILY.filter((incumbent) => incumbent !== acting).map((incumbent) => ({ acting, incumbent })),
);

const activationUrl = (moduleId: string): string =>
  `/api/v1/admin/modules/${moduleId}/activation`;

describe('pim_connector — exclusivity over every ordered pair of the derived family', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  /** Put the whole family off. Deactivation is never refused by this seam (R2.4). */
  async function switchWholeFamilyOff(): Promise<void> {
    for (const moduleId of FAMILY) {
      const res = await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: false },
      });
      expect(res.statusCode, `deactivating ${moduleId}: ${res.body}`).toBe(200);
    }
  }

  /**
   * The coverage guard. Every case below is parametrised over `PAIRS`, and
   * `describe.each([])` runs nothing at all — so an empty family would make this
   * file a green that enumerated no pair. It is the same guard
   * `test/contract/kernel/capability-registry.test.ts` carries and for the same
   * reason: a population read out of the tree can go to zero without anything
   * saying so.
   */
  it('enumerated a family of at least two connectors, and every ordered pair of it', () => {
    expect(FAMILY.length).toBeGreaterThan(1);
    expect(PAIRS.length).toBe(FAMILY.length * (FAMILY.length - 1));
  });

  it.each(PAIRS)(
    'refuses activating $acting while $incumbent holds the claim',
    async ({ acting, incumbent }) => {
      await switchWholeFamilyOff();

      const claim = await h.app.inject({
        method: 'POST',
        url: activationUrl(incumbent),
        ...ADMIN,
        payload: { active: true },
      });
      expect(claim.statusCode, `activating the incumbent ${incumbent}: ${claim.body}`).toBe(200);

      const refused = await h.app.inject({
        method: 'POST',
        url: activationUrl(acting),
        ...ADMIN,
        payload: { active: true },
      });

      expect(refused.statusCode, refused.body).toBe(409);
      expect(refused.json()).toMatchObject({
        error: {
          code: ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE,
          details: { activeModuleId: incumbent },
        },
      });
    },
    60_000,
  );

  it.each(FAMILY)(
    'activates %s when the whole family is off — the seam refuses nothing else',
    async (moduleId) => {
      await switchWholeFamilyOff();

      const res = await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: true },
      });
      expect(res.statusCode, res.body).toBe(200);
    },
    60_000,
  );

  it.each(FAMILY)(
    'never refuses deactivating %s, even while it holds the claim (R2.4)',
    async (moduleId) => {
      await switchWholeFamilyOff();
      const on = await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: true },
      });
      expect(on.statusCode, on.body).toBe(200);

      const off = await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: false },
      });
      expect(off.statusCode, off.body).toBe(200);
    },
    60_000,
  );
});
