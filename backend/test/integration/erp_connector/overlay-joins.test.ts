import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T027 — **an overlay module joins a family with no core file edited.**
 *
 * `erp_incumbent_fixture` belongs to the `example` deployment, at
 * `backend/src/apps/example/modules/`. To be seen by the ERP exclusion it used to
 * need two declarations: `erpConnector: true` in its own manifest, **and** an entry
 * in `ERP_CONNECTOR_MODULES` inside `packages/contracts/src/erp-connector.ts` —
 * core, which a deployment does not own. That is Principle XV failing in the only
 * way it can fail quietly: the overlay was written correctly and the core edit was
 * made anyway, because there was no other way in.
 *
 * **This test is written so it fails if somebody re-adds the core edit.** Asserting
 * only that the overlay is excluded would stay green with the array restored, since
 * the array would name the same module — and then the violation would be back with
 * a passing test over it. So the file that used to carry the entry is read as text
 * and asserted not to name this module, beside the behaviour it no longer needs.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const OVERLAY_ID = 'erp_incumbent_fixture';
const CORE_FAMILY_FILE = new URL(
  '../../../../packages/contracts/src/erp-connector.ts',
  import.meta.url,
);

const activationUrl = (moduleId: string): string =>
  `/api/v1/admin/modules/${moduleId}/activation`;

describe('erp_connector — an overlay module joins the family [Principle XV]', () => {
  let h: BackendServerHandle;
  let family: readonly string[];

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    const entries = await resolvedManifestEntries({
      DEPLOYMENT: 'example',
    } as NodeJS.ProcessEnv);
    family = entries
      .filter((entry) =>
        (entry.manifest.capabilities ?? []).includes(CAPABILITY_KEYS.ERP_CONNECTOR),
      )
      .map((entry) => entry.manifest.id)
      .sort();
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is in the derived family, from its own overlay manifest', () => {
    expect(family).toContain(OVERLAY_ID);
    expect(family.length, 'the family needs a second member for the pair below').toBeGreaterThan(1);
    expect(effectiveState.declaredMembersOfCapability(CAPABILITY_KEYS.ERP_CONNECTOR)).toContain(
      OVERLAY_ID,
    );
  });

  it('is named by no core file — the Principle XV edit is gone, not moved', () => {
    // The guard that makes this test fail if the core edit comes back. Reading the
    // file as text rather than importing it is deliberate: an entry restored for
    // "compatibility" would be invisible to a behavioural assertion, because it
    // would name the very module the overlay already declares.
    const coreFamilyFile = readFileSync(CORE_FAMILY_FILE, 'utf8');
    expect(coreFamilyFile).not.toContain(OVERLAY_ID);
    expect(coreFamilyFile).not.toContain('ERP_CONNECTOR_MODULES');
  });

  it('holds the claim against the core ERP connector, and is refused by it', async () => {
    const core = family.find((id) => id !== OVERLAY_ID)!;

    for (const moduleId of family) {
      const off = await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: false },
      });
      expect(off.statusCode, `deactivating ${moduleId}: ${off.body}`).toBe(200);
    }

    // The overlay takes the claim…
    const claimed = await h.app.inject({
      method: 'POST',
      url: activationUrl(OVERLAY_ID),
      ...ADMIN,
      payload: { active: true },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);

    // …and the core connector is refused by it, naming it.
    const refused = await h.app.inject({
      method: 'POST',
      url: activationUrl(core),
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: {
        code: ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE,
        details: { activeModuleId: OVERLAY_ID },
      },
    });
  });

  it('is refused while the core ERP connector holds the claim — the other direction', async () => {
    const core = family.find((id) => id !== OVERLAY_ID)!;

    for (const moduleId of family) {
      await h.app.inject({
        method: 'POST',
        url: activationUrl(moduleId),
        ...ADMIN,
        payload: { active: false },
      });
    }

    const claimed = await h.app.inject({
      method: 'POST',
      url: activationUrl(core),
      ...ADMIN,
      payload: { active: true },
    });
    expect(claimed.statusCode, claimed.body).toBe(200);

    const refused = await h.app.inject({
      method: 'POST',
      url: activationUrl(OVERLAY_ID),
      ...ADMIN,
      payload: { active: true },
    });
    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: {
        code: ERROR_CODES.ERP_CONNECTOR_ALREADY_ACTIVE,
        details: { activeModuleId: core },
      },
    });
  });
});
