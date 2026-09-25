import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { deploymentFamilyOf } from '../../helpers/capability-families.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T025 / R2.5 — **two different keys never exclude each other.**
 *
 * A deployment may run one ERP connector, one PIM connector and one
 * invoice-ledger vendor at the same time. That is unchanged behaviour and it is
 * asserted here because **nothing stated it** — the three families were three
 * arrays read by three services, and "these two do not interact" was true by
 * nobody's decision. One mechanism over a keyed family makes the statement
 * checkable: a member is excluded by the members of *its* keys and by nothing
 * else.
 *
 * Both families are derived from the members' own declarations, on both sides, so
 * a connector that joins either one is covered without editing this file.
 *
 * **Composed as the `example` deployment** (feature 134, T113, `research.md` D13 §6).
 * Every PIM connector and one of the two ERP connectors is a paid module leaving this
 * repository; the deployment's overlay fixtures are the members that stay, so without
 * them the coverage guard below goes red at the last PIM departure — on `master`,
 * because no merge-request pipeline runs this tree (D-198).
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEPLOYMENT = 'example';
const RESOLVED_MANIFESTS = await resolvedManifestEntries({ ...process.env, DEPLOYMENT });
const PIM_OVERLAY_MEMBERS = (await deploymentFamilyOf(CAPABILITY_KEYS.PIM_CONNECTOR, DEPLOYMENT))
  .overlay;

function familyOf(key: string): readonly string[] {
  return RESOLVED_MANIFESTS.filter((entry) => (entry.manifest.capabilities ?? []).includes(key))
    .map((entry) => entry.manifest.id)
    .sort();
}

const PIM_FAMILY = familyOf(CAPABILITY_KEYS.PIM_CONNECTOR);
const ERP_FAMILY = familyOf(CAPABILITY_KEYS.ERP_CONNECTOR);
const LEDGER_FAMILY = familyOf(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR);

const activationUrl = (moduleId: string): string =>
  `/api/v1/admin/modules/${moduleId}/activation`;

describe('capability families do not exclude each other across keys [R2.5]', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer({ deployment: DEPLOYMENT });
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function setActivation(moduleId: string, active: boolean): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: activationUrl(moduleId),
      ...ADMIN,
      payload: { active },
    });
    expect(res.statusCode, `${active ? 'activating' : 'deactivating'} ${moduleId}: ${res.body}`).toBe(
      200,
    );
  }

  /** The coverage guard — three empty families would make every case below vacuous. */
  it('derived a non-empty member set for each of the three keys', () => {
    expect(PIM_FAMILY.length, 'pim-connector').toBeGreaterThan(0);
    expect(ERP_FAMILY.length, 'erp-connector').toBeGreaterThan(0);
    expect(LEDGER_FAMILY.length, 'invoice-ledger-vendor').toBeGreaterThan(0);
  });

  it('keeps a PIM member that is no packaged connector — the family survives their departure', () => {
    // W6: `pim_connector` stays free and every packaged member leaves. What stays is
    // what the deployment declares itself, and it must be enough for the guard above.
    expect(PIM_OVERLAY_MEMBERS.length, PIM_FAMILY.join(', ')).toBeGreaterThan(0);
  });

  it('keeps the three families disjoint — no module is a member of two of them', () => {
    // Not a rule the schema enforces (a module *may* declare two keys, R4.4 only
    // refuses owning and belonging to the same one), so it is a fact about this
    // tree worth pinning: a connector in two families would be excluded by both.
    const all = [...PIM_FAMILY, ...ERP_FAMILY, ...LEDGER_FAMILY];
    expect(new Set(all).size).toBe(all.length);
  });

  it('runs one PIM connector and one ERP connector at the same time', async () => {
    for (const moduleId of [...PIM_FAMILY, ...ERP_FAMILY]) {
      await setActivation(moduleId, false);
    }

    const pim = PIM_FAMILY[0]!;
    const erp = ERP_FAMILY[0]!;

    // Either order, because neither may refuse the other.
    await setActivation(pim, true);
    await setActivation(erp, true);

    expect(effectiveState.isPresent(pim)).toBe(true);
    expect(effectiveState.isPresent(erp)).toBe(true);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([pim]);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.ERP_CONNECTOR)).toEqual([erp]);
  });

  it('runs the ERP connector first and the PIM connector second, with the same result', async () => {
    for (const moduleId of [...PIM_FAMILY, ...ERP_FAMILY]) {
      await setActivation(moduleId, false);
    }

    const pim = PIM_FAMILY[PIM_FAMILY.length - 1]!;
    const erp = ERP_FAMILY[0]!;

    await setActivation(erp, true);
    await setActivation(pim, true);

    expect(effectiveState.isPresent(pim)).toBe(true);
    expect(effectiveState.isPresent(erp)).toBe(true);
  });

  it('adds an invoice-ledger vendor to the pair — three keys, three claims', async () => {
    for (const moduleId of [...PIM_FAMILY, ...ERP_FAMILY, ...LEDGER_FAMILY]) {
      await setActivation(moduleId, false);
    }

    const pim = PIM_FAMILY[0]!;
    const erp = ERP_FAMILY[0]!;
    const ledger = LEDGER_FAMILY[0]!;

    await setActivation(pim, true);
    await setActivation(erp, true);
    await setActivation(ledger, true);

    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([pim]);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.ERP_CONNECTOR)).toEqual([erp]);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.INVOICE_LEDGER_VENDOR)).toEqual([
      ledger,
    ]);
  });
});
