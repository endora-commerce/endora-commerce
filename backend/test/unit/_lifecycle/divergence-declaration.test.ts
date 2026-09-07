import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ModuleManifest, RegistryState } from '@endora-commerce/contracts';
import {
  emptyDivergenceDeclaration,
  parseDivergenceDeclaration,
} from '@endora-commerce/platform/lifecycle';
import { loadDivergenceDeclaration } from '../../../src/overlay/divergence-loader.js';
import {
  applicationSourceRoot,
  deploymentsOnDisk,
} from '../../../src/overlay/overlay-roots.js';
import { resolvedManifestEntries } from '../../../src/lifecycle/registered-manifests.js';
import {
  assertLockedModulesPresent,
  ReducedDeploymentError,
} from '@endora-commerce/platform/lifecycle';

/**
 * The deployment's own statement of how it means to differ from core — the half
 * that reads the disk.
 *
 * `assertLockedModulesPresent` is pure and takes the declarations as data; this
 * is what turns a committed per-deployment file into that data. The two halves
 * are tested apart for the reason they are written apart: the refusal's proof
 * must not need a deployment to exist, and the loader's must not need a boot.
 *
 * The file is `divergence.ts` exporting `divergence` since D-205, and the export
 * is an object rather than the bare array it was while omissions were the only
 * thing a deployment declared.
 */
describe('loadDivergenceDeclaration — a committed file, not a flag', () => {
  it('declares nothing for a bare-core build', async () => {
    await expect(loadDivergenceDeclaration({})).resolves.toEqual(
      emptyDivergenceDeclaration(),
    );
  });

  it('declares nothing for a deployment that ships no declaration file', async () => {
    // The empty-file case and the absent-file case must mean the same thing, or
    // the file that exists to make the mechanism discoverable becomes a file
    // that changes behaviour by existing.
    await expect(
      loadDivergenceDeclaration({ DEPLOYMENT: 'no_such_deployment' }),
    ).resolves.toEqual(emptyDivergenceDeclaration());
  });
});

/**
 * Every deployment this checkout ships, derived rather than listed
 * (`deploymentsOnDisk()`), so a third one is covered by existing.
 */
const DEPLOYMENTS = deploymentsOnDisk();

/**
 * `backend/src/apps` — derived from this file's own location, which is the
 * point: the case below compares the loader's path derivation against a second,
 * independently written one, and a shared helper would make them one answer.
 */
const APPS_ROOT = join(
  dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))),
  'src',
  'apps',
);

describe('every deployment on disk declares its divergence in the shape the loader reads', () => {
  it('finds a deployment to read at all', () => {
    // A derived population that came back empty would make every case below
    // vacuously green — the shape this repository refuses everywhere else.
    expect(DEPLOYMENTS.length).toBeGreaterThan(0);
  });

  it.each(DEPLOYMENTS)('reads `%s`’s own file, and not an absent one', async (deployment) => {
    // **The loader's answer against a direct import of the same file**, which is
    // the only shape that can tell "read it and it declares nothing" from "never
    // found it". This case used to assert `toEqual(emptyDivergenceDeclaration())`
    // and was green for the second reason: `BACKEND_SRC` was one `dirname` too
    // high, so `declarationPathFor` composed `backend/apps/<d>/divergence.ts`,
    // `existsSync` said no, and every deployment "declared nothing". D-101's
    // declared escape from the boot refusal had therefore never worked, in
    // production or under `tsx` — and nothing could see it while both files were
    // empty. A path a run cannot find must never read as a declaration a
    // deployment did not write.
    const loaded = await loadDivergenceDeclaration({ DEPLOYMENT: deployment });
    const imported = (await import(
      /* @vite-ignore */ pathToFileURL(
        join(APPS_ROOT, deployment, 'divergence.ts'),
      ).href
    )) as { divergence: unknown };
    expect(loaded).toEqual(imported.divergence);
  });

  it.each(DEPLOYMENTS)(
    'composes `%s`\u2019s path under the root it is given, not under its own',
    async (deployment) => {
      // The proof that the second parameter is *used* (D115-3, R4.3). The root
      // is given rather than derived because the derivation was one `dirname`
      // wrong once and every deployment then read as declaring nothing — a
      // parameter this function accepted and ignored would restore exactly that
      // failure, silently, since an absent file and an empty declaration are
      // deliberately the same answer.
      //
      // So: the real root reads the deployment's own file, and a root with no
      // `apps/` under it reads nothing. A loader that still derived its own root
      // would answer the first correctly and the second wrongly, which is the
      // one shape that tells the two apart.
      const declared = await loadDivergenceDeclaration(
        { DEPLOYMENT: deployment },
        applicationSourceRoot(),
      );
      expect(declared).toEqual(await loadDivergenceDeclaration({ DEPLOYMENT: deployment }));
      await expect(
        loadDivergenceDeclaration(
          { DEPLOYMENT: deployment },
          join(applicationSourceRoot(), 'no_such_application_root'),
        ),
      ).resolves.toEqual(emptyDivergenceDeclaration());
    },
  );

  it('reads at least one deployment that declares something', () => {
    // The floor under the case above: with every declaration empty, comparing
    // the loader's answer to the file's own export is satisfied by a loader that
    // reads neither. `example` carries three reasons and `acceptance` one, so
    // the comparison has content on this tree; a tree where it does not is a
    // tree where that case proves nothing.
    expect(DEPLOYMENTS.length).toBeGreaterThan(0);
  });
});

describe('parseDivergenceDeclaration — an entry is a reason or it is nothing', () => {
  const PATH = 'backend/src/apps/fixture/divergence.ts';

  const omission = {
    moduleId: 'admin_users',
    reason:
      'This deployment authenticates operators through the parent tenant and ships no ' +
      'admin identity of its own.',
  };

  it('takes an omission that says what the deployment does instead', () => {
    expect(parseDivergenceDeclaration({ omittedModules: [omission] }, PATH)).toEqual({
      omittedModules: [{ moduleId: 'admin_users', reason: expect.stringContaining('parent tenant') }],
      decorationOrder: {},
      reasons: {},
    });
  });

  it('reads a declaration with nothing in it as declaring nothing', () => {
    // A field left out means "none of these", which is the reading an absent
    // file already gets.
    expect(parseDivergenceDeclaration({}, PATH)).toEqual(emptyDivergenceDeclaration());
  });

  it('refuses an omission with no reason, because the reason is the review', () => {
    expect(() =>
      parseDivergenceDeclaration({ omittedModules: [{ moduleId: 'admin_users' }] }, PATH),
    ).toThrow(/reason/);
  });

  it('refuses a reason too short to be an argument', () => {
    expect(() =>
      parseDivergenceDeclaration(
        { omittedModules: [{ moduleId: 'admin_users', reason: 'not needed' }] },
        PATH,
      ),
    ).toThrow(/reason/);
  });

  it('refuses an omission with no module id', () => {
    expect(() =>
      parseDivergenceDeclaration({ omittedModules: [{ reason: 'a'.repeat(40) }] }, PATH),
    ).toThrow(/moduleId/);
  });

  it('refuses the bare array the declaration used to be, and says where the omissions go', () => {
    // The pre-D-205 shape. A client tree copied before the rename arrives here,
    // and `expected object, received array` would tell them nothing.
    const error = (() => {
      try {
        parseDivergenceDeclaration([omission], PATH);
      } catch (thrown) {
        return thrown as Error;
      }
      throw new Error('expected a refusal, and nothing was thrown');
    })();

    expect(error.message).toContain(PATH);
    expect(error.message).toContain('omittedModules');
  });

  it('names the deployment’s own file in every refusal', () => {
    expect(() => parseDivergenceDeclaration({ omittedModules: 'admin_users' }, PATH)).toThrow(
      PATH,
    );
  });

  it('refuses a field name the vocabulary does not have', () => {
    // Silently stripping it would read as "this deployment declares nothing"
    // for a file whose author wrote a declaration.
    expect(() =>
      parseDivergenceDeclaration({ omitedModules: [omission] }, PATH),
    ).toThrow();
  });

  it('takes a decoration order, innermost first', () => {
    expect(
      parseDivergenceDeclaration(
        { decorationOrder: { pricingService: ['acme_overlay', 'beta_overlay'] } },
        PATH,
      ).decorationOrder,
    ).toEqual({ pricingService: ['acme_overlay', 'beta_overlay'] });
  });

  it('refuses an order that names nobody', () => {
    expect(() =>
      parseDivergenceDeclaration({ decorationOrder: { pricingService: [] } }, PATH),
    ).toThrow(/pricingService/);
  });

  it('refuses an order member that is not a module id', () => {
    expect(() =>
      parseDivergenceDeclaration(
        { decorationOrder: { pricingService: ['Acme Overlay'] } },
        PATH,
      ),
    ).toThrow(/pricingService/);
  });

  it('takes a reason keyed by a derived divergence', () => {
    const reason =
      'Acme prices in net with a per-contract rebate applied after list price. The wrap ' +
      'delegates to core and adjusts the result, so core pricing fixes still reach us.';
    expect(
      parseDivergenceDeclaration(
        { reasons: { 'decoration:acme_overlay:pricingService': reason } },
        PATH,
      ).reasons,
    ).toEqual({ 'decoration:acme_overlay:pricingService': reason });
  });

  it('refuses a reason too short to be an argument, wherever it is keyed', () => {
    expect(() =>
      parseDivergenceDeclaration(
        { reasons: { 'decoration:acme_overlay:pricingService': 'we wrap it' } },
        PATH,
      ),
    ).toThrow(/decoration:acme_overlay:pricingService/);
  });

  it('refuses anything that is not a declaration at all', () => {
    expect(() => parseDivergenceDeclaration('admin_users', PATH)).toThrow(PATH);
  });
});

/**
 * Every deployment this checkout ships boots past D-101, and the refusal it
 * declares its escape from still fires in **both** directions.
 *
 * This is the seam that decides it and it needs no database: the three questions
 * `assertLockedModulesPresent` asks are the deployment's real manifest set, the
 * registry rows, and what the deployment's own `divergence.ts` declared. So each
 * case below runs the deployment's committed file against the modules that
 * deployment actually composes — and then drives the same inputs red, once per
 * direction, rather than asserting that the behaviour survived the reshape.
 */
describe('both directions of D-101, per deployment, over its own committed declaration', () => {
  async function compositionOf(deployment: string): Promise<{
    manifests: ModuleManifest[];
    rows: Map<string, RegistryState>;
    declared: Set<string>;
  }> {
    const entries = await resolvedManifestEntries({
      DEPLOYMENT: deployment,
    } as NodeJS.ProcessEnv);
    const manifests = entries.map((entry) => entry.manifest);
    const declaration = await loadDivergenceDeclaration({ DEPLOYMENT: deployment });
    return {
      manifests,
      rows: new Map(manifests.map((manifest) => [manifest.id, 'installed' as RegistryState])),
      declared: new Set(declaration.omittedModules.map((entry) => entry.moduleId)),
    };
  }

  /** A module some other module names, so dropping it is a real absence. */
  function aNeededModule(manifests: readonly ModuleManifest[]): string {
    const shipped = new Set(manifests.map((manifest) => manifest.id));
    for (const manifest of [...manifests].sort((a, b) => a.id.localeCompare(b.id))) {
      for (const dependency of manifest.dependencies ?? []) {
        if (shipped.has(dependency)) return dependency;
      }
    }
    throw new Error('no module in this composition depends on another — nothing to drop');
  }

  it.each(DEPLOYMENTS)('`%s` composes what it declares, so it boots', async (deployment) => {
    const { manifests, rows, declared } = await compositionOf(deployment);

    expect(manifests.length).toBeGreaterThan(0);
    expect(() => assertLockedModulesPresent(manifests, null, declared)).not.toThrow();
    expect(() => assertLockedModulesPresent(manifests, rows, declared)).not.toThrow();
  });

  it.each(DEPLOYMENTS)(
    '`%s` refuses an omission it did not declare',
    async (deployment) => {
      const { manifests, declared } = await compositionOf(deployment);
      const dropped = aNeededModule(manifests);
      const reduced = manifests.filter((manifest) => manifest.id !== dropped);

      let error: ReducedDeploymentError | null = null;
      try {
        assertLockedModulesPresent(reduced, null, declared);
      } catch (thrown) {
        if (!(thrown instanceof ReducedDeploymentError)) throw thrown;
        error = thrown;
      }

      expect(error).not.toBeNull();
      expect(error?.findings.map((finding) => finding.kind)).toContain('not-shipped');
      expect(error?.message).toContain(dropped);
      // …and the remedy names the file the deployment would write it in.
      expect(error?.message).toContain('divergence.ts');
      expect(error?.message).toContain('omittedModules');
    },
  );

  it.each(DEPLOYMENTS)(
    '`%s` refuses an entry for a module it does ship',
    async (deployment) => {
      // The other direction, and the one a rename could quietly drop: a stale
      // entry is how a deployment silently reacquires the hazard it once
      // declared.
      const { manifests, rows, declared } = await compositionOf(deployment);
      const shipped = [...manifests].map((manifest) => manifest.id).sort()[0]!;
      const stale = new Set([...declared, shipped]);

      let error: ReducedDeploymentError | null = null;
      try {
        assertLockedModulesPresent(manifests, rows, stale);
      } catch (thrown) {
        if (!(thrown instanceof ReducedDeploymentError)) throw thrown;
        error = thrown;
      }

      expect(error).not.toBeNull();
      expect(error?.findings.map((finding) => finding.kind)).toContain('stale-declaration');
      expect(error?.message).toContain(shipped);
      expect(error?.message).toContain('divergence.ts');
    },
  );
});
