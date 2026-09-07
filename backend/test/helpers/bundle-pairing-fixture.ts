import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModuleUnderCheck } from '../../scripts/check-bundle-pairing.js';

/**
 * A module tree on disk for `check:bundle-pairing`, plus the records the
 * generated manifest index would produce over it.
 *
 * **The fixture is a tree and not a set of classifications**, and that is the
 * whole reason it exists rather than a literal array in each proof (issue #130).
 * The check's analysis is a directory probe, a per-language `statSync`, a
 * `JSON.parse` and a schema validation; a fixture that handed in "module `blog`
 * ships `en` and not `pl`" would prove the reporter and leave every one of those
 * unproven — including the probe, which is the part that decides whether a
 * module ships anything at all and therefore whether § 1's conditional binds it.
 *
 * The records returned are exactly what a real run derives: `directory` is
 * `dirname(manifestPath)`, the anchor the `_i18n` boot reconciler joins
 * `bundlesDir` to, and `bundlesDir` is the manifest's own declaration or `null`.
 * So a proof varies the tree and the index together, which is the pair a real
 * run reads.
 *
 * Shared by the companion test and `check-inventory.test.ts`' red proofs, in the
 * idiom `emitted-freshness-fixture.ts` established: two builders over one
 * population are two answers waiting to disagree.
 */

/** One module the fixture writes out. */
export interface FixtureModule {
  readonly id: string;
  /**
   * What the module's manifest declares as `i18n.bundlesDir`. `undefined` means
   * it declares the conventional directory; `null` means it declares none, which
   * is the `undeclared-bundle-dir` shape.
   */
  readonly bundlesDir?: string | null;
  /**
   * Bundle files written under {@link FixtureModule.onDisk}, by filename —
   * raw text, so a proof can write JSON this check must refuse.
   */
  readonly bundles?: Readonly<Record<string, string>>;
  /**
   * The directory the files are written to, when it differs from what the
   * manifest declares. Defaults to the declared directory, or to
   * {@link CONVENTIONAL_BUNDLES_DIR} for a module that declares none.
   */
  readonly onDisk?: string;
}

/**
 * The directory name the fixture writes to by default.
 *
 * It is a fixture's spelling, never the check's: the check derives its probe
 * names from the `bundlesDir` values the manifests declare, so a proof that
 * wants `undeclared-bundle-dir` to fire has to include a *second* module that
 * declares this name — which is the derivation working, and is asserted as such
 * in the companion test.
 */
export const CONVENTIONAL_BUNDLES_DIR = 'i18n';

/** A flat, valid, non-empty bundle — the shape everything else is measured against. */
export function validBundle(key = 'actions.open.label', text = 'Open'): string {
  return `${JSON.stringify({ [key]: text }, null, 2)}\n`;
}

export interface BundlePairingFixture {
  /** The temporary root every module directory sits under. */
  readonly root: string;
  /** What the generated index would hand the check over this tree. */
  readonly modules: readonly ModuleUnderCheck[];
  cleanup: () => void;
}

export function createBundlePairingFixture(
  declarations: readonly FixtureModule[],
): BundlePairingFixture {
  const root = mkdtempSync(join(tmpdir(), 'bundle-pairing-'));
  const modules: ModuleUnderCheck[] = [];

  for (const declaration of declarations) {
    const directory = join(root, declaration.id);
    mkdirSync(directory, { recursive: true });
    // Inert, and written anyway: a module directory with no manifest is not a
    // module directory any deployment could hold, and the record below claims
    // one is there.
    writeFileSync(join(directory, 'manifest.ts'), `export const manifest = {};\n`, 'utf8');

    const declared =
      declaration.bundlesDir === undefined ? CONVENTIONAL_BUNDLES_DIR : declaration.bundlesDir;
    const bundles = declaration.bundles ?? {};
    if (Object.keys(bundles).length > 0) {
      const target = join(directory, declaration.onDisk ?? declared ?? CONVENTIONAL_BUNDLES_DIR);
      mkdirSync(target, { recursive: true });
      for (const [filename, content] of Object.entries(bundles)) {
        writeFileSync(join(target, filename), content, 'utf8');
      }
    }

    modules.push({ moduleId: declaration.id, directory, bundlesDir: declared });
  }

  return {
    root,
    modules,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
