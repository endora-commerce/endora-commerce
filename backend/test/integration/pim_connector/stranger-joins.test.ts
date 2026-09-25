import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITY_KEYS, ERROR_CODES } from '@endora-commerce/contracts';
import { effectiveState } from '@endora-commerce/platform/kernel';
import { capabilityRegistryFrom, registryCache } from '@endora-commerce/platform/composition';
import { HttpError } from '@endora-commerce/platform/http';
import { packageModuleManifestsUnder } from '../../../src/packages/package-runtime.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import { deploymentFamilyOf } from '../../helpers/capability-families.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T024 / **SC-001 — the reason this feature exists.**
 *
 * A PIM connector that lives **outside this repository** joins the family by
 * declaring `capabilities: ['pim-connector']` in its own manifest, and is
 * excluded in both directions, with no file in this tree naming it.
 *
 * ## Why the fixture is a real installed package and not a core one
 *
 * A core fixture module would make this test pass for the wrong reason. The three
 * arrays this feature deletes could already reach a core module — you edit the
 * array — and the population they could *not* reach is exactly this one: an npm
 * package an operator installed, and a per-deployment overlay module, neither of
 * which can edit `packages/contracts`. D-244 keeps paid-module development in a
 * separate repository, so this is not a hypothetical population; it is the
 * product.
 *
 * So the stranger is written to disk as an instance holds one — a `node_modules`
 * tree, a `package.json` carrying `endora.type === 'module'`, an `exports` map and
 * a compiled manifest — and is discovered by `packageModuleManifestsUnder`, the
 * same enumeration, `exports` resolution and dynamic import the deployment path
 * runs (the seam its own header says is exported for exactly this). Nothing here
 * hands the platform a hand-written manifest object.
 *
 * It deliberately ships **no `./backend` export**. That is the honest minimum for
 * this claim and it is a real shape: an admin- or storefront-only module has a
 * manifest, an activation control and i18n bundles and composes no server half,
 * and `packageModuleManifestsUnder` keeps it for that reason. It also makes the
 * point sharper — the stranger contributes nothing but a declaration, and the
 * declaration alone is enough to join the family.
 *
 * ## The two directions are asked at two seams, deliberately
 *
 * *Stranger holds the claim* is asked through the **real HTTP route**, because
 * that is where an operator meets it: `POST /admin/modules/pim_akeneo/activation`
 * must come back 409 naming the stranger.
 *
 * *Stranger is refused* is asked on the **live port** — `assertCanActivate` is the
 * one call the owner's interceptor makes, and the harness composes no route for a
 * module it never composed. This is the split
 * `test/contract/invoice_ledger/mutex-activation.test.ts` already uses for its own
 * non-composed sibling, and it reaches the same function from the same container.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const STRANGER_ID = 'vendor_pim_stranger';
const STRANGER_NAME = '@vendor/mod-pim-stranger';
/**
 * Composed as the `example` deployment (feature 134, T113, `research.md` D13 §6): every
 * packaged PIM connector leaves this repository, and the deployment's overlay fixtures
 * are the shipped members the stranger is then excluded against.
 */
const DEPLOYMENT = 'example';
const OVERLAY_MEMBERS = (await deploymentFamilyOf(CAPABILITY_KEYS.PIM_CONNECTOR, DEPLOYMENT))
  .overlay;

/** The stranger, on disk, in the layout a real install has. */
function writeStrangerPackage(root: string): string {
  const dir = join(root, 'instance', 'node_modules', ...STRANGER_NAME.split('/'));
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: STRANGER_NAME,
        version: '2.3.0',
        type: 'module',
        endora: { type: 'module', id: STRANGER_ID, platform: '0.x' },
        exports: { '.': './dist/manifest.js', './package.json': './package.json' },
      },
      null,
      2,
    )}\n`,
  );
  // The declaration is the package's own, spelled as a string literal — it names
  // no package of `pim_connector`'s, which is R1.3 and is why this works at all.
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      id: STRANGER_ID,
      name: 'Stranger PIM connector',
      version: '2.3.0',
      dependencies: [],
      capabilities: ['pim-connector'],
      activation: { settingCode: `${STRANGER_ID}.activation`, default: false },
    })};\nexport default manifest;\n`,
  );
  return join(root, 'instance', 'node_modules');
}

describe('pim_connector — a stranger package joins the family [SC-001]', () => {
  let h: BackendServerHandle;
  let fixtureRoot: string;
  let shippedFamily: readonly string[];
  let realManifests: readonly import('@endora-commerce/contracts').ModuleManifest[];

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(join(tmpdir(), 'endora-132-stranger-'));
    const nodeModulesRoot = writeStrangerPackage(fixtureRoot);

    h = await setupBackendServer({ deployment: DEPLOYMENT });

    const entries = await resolvedManifestEntries({ ...process.env, DEPLOYMENT });
    realManifests = entries.map((entry) => entry.manifest);
    shippedFamily = realManifests
      .filter((manifest) => (manifest.capabilities ?? []).includes(CAPABILITY_KEYS.PIM_CONNECTOR))
      .map((manifest) => manifest.id);

    // Discovery, over the fixture instance. The manifest the platform is about to
    // reason about is the one this walk imported out of the package.
    const discovered = await packageModuleManifestsUnder([nodeModulesRoot]);
    expect(
      discovered.map((entry) => entry.manifest.id),
      'the fixture instance must yield exactly the stranger',
    ).toEqual([STRANGER_ID]);
    expect(discovered[0]?.manifest.capabilities).toEqual([CAPABILITY_KEYS.PIM_CONNECTOR]);

    // The deployment this platform is now running: core plus one installed
    // package. Derived by the same function `loadModulePresence` calls.
    registryCache.setCapabilityDeclarations(
      capabilityRegistryFrom([...realManifests, ...discovered.map((entry) => entry.manifest)]),
    );
  }, 120_000);

  afterAll(async () => {
    // The registry cache is a process singleton and this file widened it. Put the
    // real deployment back before the next file composes against it.
    registryCache.setCapabilityDeclarations(capabilityRegistryFrom([...realManifests]));
    await teardownBackendServer(h);
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it('is in the derived family, from its own declaration and no list in this tree', () => {
    expect(effectiveState.declaredMembersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toContain(
      STRANGER_ID,
    );
    expect(shippedFamily.length, 'the shipped family must be non-empty for the pair to mean anything')
      .toBeGreaterThan(0);
    expect(shippedFamily).not.toContain(STRANGER_ID);
    // W6 — a shipped member that is no packaged connector, so the pair survives every
    // packaged connector's departure.
    expect(OVERLAY_MEMBERS.length, shippedFamily.join(', ')).toBeGreaterThan(0);
  });

  it('holds the claim against a shipped connector — refused through the activation route', async () => {
    // The stranger present, the whole shipped family off.
    registryCache.__setEnabledForTesting(
      [...effectiveState.all().map((p) => p.moduleId), STRANGER_ID],
      { deactivated: [...shippedFamily] },
    );
    expect(effectiveState.isPresent(STRANGER_ID)).toBe(true);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([
      STRANGER_ID,
    ]);

    const victim = shippedFamily[0]!;
    const refused = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/modules/${victim}/activation`,
      ...ADMIN,
      payload: { active: true },
    });

    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json()).toMatchObject({
      error: {
        code: ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE,
        details: { activeModuleId: STRANGER_ID },
      },
    });
  });

  it('is itself refused while a shipped connector holds the claim — the live port', async () => {
    const incumbent = shippedFamily[0]!;
    // The shipped connector present, the stranger off.
    registryCache.__setEnabledForTesting(
      [...effectiveState.all().map((p) => p.moduleId), STRANGER_ID],
      { deactivated: [...shippedFamily.filter((id) => id !== incumbent), STRANGER_ID] },
    );
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([incumbent]);

    await expect(h.pimConnectorRegistry.assertCanActivate(STRANGER_ID)).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(HttpError);
        const httpError = error as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.code).toBe(ERROR_CODES.PIM_CONNECTOR_ALREADY_ACTIVE);
        expect(httpError.details).toEqual({ activeModuleId: incumbent });
        return true;
      },
    );
  });

  it('holds no claim once the deployment stops shipping it', async () => {
    // Principle XVII from the other side: a stranger whose platform axis is off
    // contributes nothing to any refusal and appears in no error detail (FR-009).
    registryCache.__setEnabledForTesting([...shippedFamily], { deactivated: [...shippedFamily] });
    expect(effectiveState.isPresent(STRANGER_ID)).toBe(false);
    expect(effectiveState.membersOfCapability(CAPABILITY_KEYS.PIM_CONNECTOR)).toEqual([]);
    await expect(
      h.pimConnectorRegistry.assertCanActivate(shippedFamily[0]!),
    ).resolves.toBeUndefined();
  });

  it('is named by no file in this repository', () => {
    // R1.5 / SC-003 at the level this test can hold it: the id the platform just
    // excluded on exists only in the fixture the test wrote.
    expect(STRANGER_ID).not.toMatch(/^pim_/);
    expect(shippedFamily.every((id) => id !== STRANGER_ID)).toBe(true);
  });
});
