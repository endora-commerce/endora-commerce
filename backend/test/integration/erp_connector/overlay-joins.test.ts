import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { deploymentFamilyOf } from '../../helpers/capability-families.js';
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
 *
 * **The pair partner is any other member, not a packaged connector** (feature 134,
 * T115, `research.md` D13 §6). The one packaged ERP connector leaves this repository,
 * so the `example` deployment declares a second overlay member,
 * `erp_challenger_fixture`, and this file asserts that the overlay members alone form
 * a pair. Without it, that departure leaves a family of one and the two exclusion
 * cases below have nobody to be refused by — on `master`, after the merge, since no
 * merge-request pipeline runs the integration tree (D-198).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const OVERLAY_ID = 'erp_incumbent_fixture';
/** Every source file of the package the core edit used to live in. */
const CORE_CONTRACTS_SRC = fileURLToPath(
  new URL('../../../../packages/contracts/src/', import.meta.url),
);

const activationUrl = (moduleId: string): string =>
  `/api/v1/admin/modules/${moduleId}/activation`;

describe('erp_connector — an overlay module joins the family [Principle XV]', () => {
  let h: BackendServerHandle;
  let family: readonly string[];
  let overlayMembers: readonly string[];
  /** The member the overlay is paired with: another overlay member, so the pair outlives every packaged connector. */
  let sibling: string;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: 'example' });
    ({ members: family, overlay: overlayMembers } = await deploymentFamilyOf(
      CAPABILITY_KEYS.ERP_CONNECTOR,
      'example',
    ));
    sibling = overlayMembers.find((id) => id !== OVERLAY_ID) ?? family.find((id) => id !== OVERLAY_ID)!;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('is in the derived family, from its own overlay manifest', () => {
    expect(family).toContain(OVERLAY_ID);
    expect(family.length, 'the family needs a second member for the pair below').toBeGreaterThan(1);
    // W6 — the pair must survive every packaged ERP connector's departure, so the
    // deployment's own overlay members have to make it on their own.
    expect(overlayMembers, family.join(', ')).toContain(OVERLAY_ID);
    expect(overlayMembers.length, family.join(', ')).toBeGreaterThan(1);
    expect(effectiveState.declaredMembersOfCapability(CAPABILITY_KEYS.ERP_CONNECTOR)).toContain(
      OVERLAY_ID,
    );
  });

  it('is named by no core file — the Principle XV edit is gone, not moved', () => {
    // The guard that makes this test fail if the core edit comes back. Reading the
    // sources as text rather than importing them is deliberate: an entry restored
    // for "compatibility" would be invisible to a behavioural assertion, because it
    // would name the very module the overlay already declares, and every case above
    // would stay green.
    //
    // The population is the **whole** package, not the one file the entry used to
    // sit in: re-adding it to a different core file is the same violation, and a
    // guard aimed at one path would miss it.
    //
    // The subject is the **module id**, not the deleted symbol's spelling. The old
    // array's name still appears in this tree — in the doc comments that record its
    // deletion, which is how a reader finds out what happened — and a guard that
    // forbade the string would forbid the explanation. What Principle XV forbids is
    // core **naming a deployment's module**, so that is what is asserted, beside the
    // array not being re-declared under its own name.
    const offenders: string[] = [];
    for (const name of readdirSync(CORE_CONTRACTS_SRC)) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
      const text = readFileSync(`${CORE_CONTRACTS_SRC}${name}`, 'utf8');
      if (text.includes(OVERLAY_ID)) offenders.push(name);
      if (/export const ERP_CONNECTOR_MODULES\b/.test(text)) offenders.push(`${name} (array)`);
    }
    expect(offenders, 'no core contracts file may name a deployment-owned module').toEqual([]);
  });

  it('holds the claim against a sibling ERP connector, and is refused by it', async () => {

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

    // …and the sibling is refused by it, naming it.
    const refused = await h.app.inject({
      method: 'POST',
      url: activationUrl(sibling),
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

  it('is refused while a sibling ERP connector holds the claim — the other direction', async () => {

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
      url: activationUrl(sibling),
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
        details: { activeModuleId: sibling },
      },
    });
  });
});
