import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { classifyDocEntry, permittedRoots } from '../../../scripts/check-overlay-determinism.js';
import {
  instancePopulation,
  renderAdminRegistry,
  renderDocsSidebar,
  renderModuleMap,
  renderTailwindRegistry,
  workspacePopulation,
} from '../../../scripts/generate-composer.js';
import {
  ModulePackageError,
  scanInstalledModulePackages,
} from '../../../scripts/lib/module-packages.js';

/**
 * The two artefacts a **client's instance** generates, rendered over the
 * modules that instance installed (`specs/110-instance-repository/` FR-005,
 * FR-006; `contracts/instance-repository.md` R3.2, R3.4, R3.5).
 *
 * ## What was measured before this existed
 *
 * Both generators walked **workspace members** and nothing else, so in a tree
 * with no `pnpm-workspace.yaml` of ours — which is every instance — they
 * rendered an admin registry naming no module and a navigation naming no page.
 * Neither failed: a client would have got a working build of an admin with no
 * screens and a documentation site describing nothing they had bought, with no
 * error anywhere. That is the shape this file refuses in both directions.
 *
 * ## Why a fixture `node_modules` rather than a mocked population
 *
 * The whole difference between the two populations is what a **published**
 * package looks like on disk: compiled JavaScript behind an `exports` map, no
 * `src/`, `docs/` at the package root, and a manifest that is a plain object
 * naming `defineModuleManifest` nowhere. A handed-in `ModulePackage[]` would
 * have skipped every one of those and asserted the part that already worked
 * (issue #130: the fixture enters at the top of the analysis).
 *
 * `backend/test/fixtures/installed-packages/mod-instance-surfaces` is that
 * package, committed, in the family `package-declarations.test.ts` already
 * installs the same way.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');
const FIXTURES = join(REPO_ROOT, 'backend', 'test', 'fixtures', 'installed-packages');

const PACKAGE_NAME = '@fixture/mod-instance-surfaces';
const MODULE_ID = 'fixture_instance_surfaces';
const PAGE_SLUG = 'fixture-instance-surfaces';

/**
 * An instance, in the shape `endora new instance` will write one: a workspace
 * with an admin project and a documentation site, and every module in
 * `node_modules`.
 *
 * It holds no module source, no `packages/` directory and no manifest of ours —
 * which is D-207 stated as a directory tree.
 */
function buildInstance(root: string): void {
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - admin\n  - docs\n',
    'utf8',
  );
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'acme-instance',
        private: true,
        dependencies: { [PACKAGE_NAME]: '^1.0.0' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // The admin project: `index.html`, `main.tsx`, the configuration and the
  // generated registry — R2.1's list, of which only the alias matters here.
  mkdirSync(join(root, 'admin', 'src'), { recursive: true });
  writeFileSync(
    join(root, 'admin', 'package.json'),
    `${JSON.stringify({ name: 'acme-admin', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(root, 'admin', 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }, null, 2)}\n`,
    'utf8',
  );

  // The documentation site.
  mkdirSync(join(root, 'docs', 'docs', 'modules'), { recursive: true });
  writeFileSync(
    join(root, 'docs', 'package.json'),
    `${JSON.stringify({ name: 'acme-docs', private: true }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    join(root, 'docs', 'docusaurus.config.js'),
    "module.exports = { title: 'Acme', presets: [['classic', { docs: { path: 'docs' } }]] };\n",
    'utf8',
  );

  mkdirSync(join(root, 'node_modules', '@fixture'), { recursive: true });
  cpSync(
    join(FIXTURES, 'mod-instance-surfaces'),
    join(root, 'node_modules', PACKAGE_NAME),
    { recursive: true },
  );
}

describe("the artefacts an instance generates are rendered over the modules it installed", () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'endora-instance-population-'));
    buildInstance(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names the installed package by the bare specifier its own exports map declares', () => {
    // FR-005 / R3.5. The package ships `lib/admin/index.js` and no `src/`, so
    // the source-entry predicate that answers for a workspace member finds
    // nothing — which is exactly how an instance's admin came to bundle no
    // screens at all.
    const { content, outputPath } = renderAdminRegistry(instancePopulation(root));
    expect(content).toContain(
      `import { contributions as contributions0 } from '${PACKAGE_NAME}/admin';`,
    );
    expect(content).toContain(`{ moduleId: '${MODULE_ID}', contributions: contributions0 },`);
    // And it lands in the client's own admin project, derived from their alias.
    expect(outputPath).toBe(join(root, 'admin', 'src', 'modules.generated.ts'));
  });

  it("imports the installed package's own source declaration by name", () => {
    // FR-023 / R2.1. This is the artefact that replaces
    // `@source "../../packages/**"` — a path that does not exist in this tree,
    // and did not exist in any client's, while Tailwind reported nothing about
    // it (M12). The specifier is the package's own subpath, so a package that
    // is not installed is `Can't resolve` and one whose tarball omits the file
    // is `ERR_PACKAGE_PATH_NOT_EXPORTED`: both loud, which is the property the
    // mechanism was chosen for.
    const { content, outputPath } = renderTailwindRegistry(instancePopulation(root));
    expect(content).toContain(`@import "${PACKAGE_NAME}/tailwind.css";`);
    expect(outputPath).toBe(join(root, 'admin', 'src', 'tailwind.generated.css'));
    // Nothing in the artefact names a directory inside the package: where its
    // sources are is the package's own statement, in its own stylesheet (§4(b)).
    expect(content).not.toContain('lib/');
    expect(content).not.toContain('dist');
  });

  it('refuses an installed package that contributes a screen and declares no sources', () => {
    // R2.2's superset relation, asserted rather than assumed. It is the one
    // state in which this mechanism fails in the direction it exists to
    // prevent: the screen is registered, the bundle builds, and every class
    // only that module declares is dropped with no error anywhere.
    const manifestPath = join(root, 'node_modules', PACKAGE_NAME, 'package.json');
    const original = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(original) as { exports: Record<string, unknown> };
    delete manifest.exports['./tailwind.css'];
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    try {
      expect(() => renderTailwindRegistry(instancePopulation(root))).toThrow(ModulePackageError);
    } finally {
      writeFileSync(manifestPath, original, 'utf8');
    }
  });

  it("leaves this repository's own admin registry byte-identical", () => {
    // The population is a parameter and nothing else moved. The committed
    // artefact is the independent author here: `overlay:check` renders and
    // compares it in CI, and this is the same comparison one call earlier.
    const { outputPath, content } = renderAdminRegistry(workspacePopulation());
    expect(content).toBe(readFileSync(outputPath, 'utf8'));
  });

  it("leaves this repository's own generated stylesheet byte-identical", () => {
    // R2.5, which is `plan.md` R7.6: a shape we cannot adopt ourselves is one
    // we may not ask a client for. The same renderer over the same population
    // parameter answers for both trees, and the committed artefact is the
    // independent author — `overlay:check` makes this comparison in CI.
    const { outputPath, content } = renderTailwindRegistry(workspacePopulation());
    expect(content).toBe(readFileSync(outputPath, 'utf8'));
  });

  it("builds a navigation naming the installed module's page", () => {
    // FR-006. The page is at the package root beside `lib/`, exactly where a
    // real module ships one, and the module's docs declaration is read out of
    // the manifest the `exports` map publishes — there is no `manifest.ts`.
    const sidebar = renderDocsSidebar(instancePopulation(root));
    expect(sidebar.content).toContain(`modules/${PAGE_SLUG}`);
    expect(sidebar.outputPath).toBe(join(root, 'docs', 'sidebars.modules.generated.js'));

    const map = renderModuleMap(instancePopulation(root));
    expect(map.content).toContain(`./${PAGE_SLUG}.md`);
    expect(map.content).toContain(PACKAGE_NAME);
  });

  it('does not consult `foreign`, and the same entry would be refused by it', () => {
    // R3.4, and it is stated as a **measurement** rather than as an absence.
    // Containment is a property of a *committed* artefact: in this repository a
    // sidebar entry whose page really lives under `node_modules` is an
    // installed package baked into a committed file, which is what `foreign`
    // exists to refuse. In an instance that entry is the client's own module's
    // documentation, and refusing it would be refusing what they installed.
    //
    // So the proof is two-sided: the render above produced the entry, and the
    // verdict — applied to the very same entry, in the very same tree — says
    // `foreign`. Dropping the verdict here and importing it there are the two
    // ways to get this wrong, and each looks like consistency.
    const { entrySources, entryRoot } = renderDocsSidebar(instancePopulation(root));
    expect(entrySources, 'the render must say where each page really lives').toBeDefined();

    const site = classifyDocEntry(
      join(root, 'docs', 'sidebars.modules.generated.js'),
      `modules/${PAGE_SLUG}`,
      entryRoot!,
      permittedRoots(root),
      entrySources!,
    );
    expect(site.verdict).toBe('foreign');
  });

  it('excludes a linked package, and says which one it excluded', () => {
    // T104. `installed-packages.ts` says in its own header that runtime
    // discovery does not find a linked directory, and the artefact generators
    // must agree with it: a registry naming a module the platform will not
    // compose is an admin nav entry that 404s. Reported rather than silent,
    // because a client developing a module inside their instance needs to be
    // told why their screen is missing.
    const linked = mkdtempSync(join(tmpdir(), 'endora-linked-module-'));
    try {
      cpSync(join(FIXTURES, 'mod-widgets'), join(linked, 'mod-widgets'), { recursive: true });
      symlinkSync(
        join(linked, 'mod-widgets'),
        join(root, 'node_modules', '@fixture', 'mod-widgets'),
        'dir',
      );

      const scan = scanInstalledModulePackages(root);
      expect(scan.packages.map((pkg) => pkg.moduleId)).toEqual([MODULE_ID]);
      expect(scan.skipped).toEqual([
        expect.objectContaining({ kind: 'links-out-of-node-modules', name: '@fixture/mod-widgets' }),
      ]);

      // And nothing it owns reaches either artefact.
      expect(renderAdminRegistry(instancePopulation(root)).content).not.toContain('mod-widgets');
      expect(renderDocsSidebar(instancePopulation(root)).content).not.toContain('widgets');
    } finally {
      rmSync(join(root, 'node_modules', '@fixture', 'mod-widgets'), { force: true });
      rmSync(linked, { recursive: true, force: true });
    }
  });

  it('judges a package that ships sources by its sources, stale build output and all', () => {
    // The order is not a fallback. `tsc` does not delete what it no longer
    // emits, so a workspace member whose admin layer was removed keeps a
    // `dist/admin/` until somebody cleans it — and reading that as a
    // contribution would put a screen in the bundle whose source is gone.
    const member = join(root, 'node_modules', '@fixture', 'mod-stale-build');
    mkdirSync(join(member, 'src'), { recursive: true });
    mkdirSync(join(member, 'dist', 'admin'), { recursive: true });
    writeFileSync(join(member, 'dist', 'admin', 'index.js'), 'export const contributions = {};\n');
    writeFileSync(
      join(member, 'package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/mod-stale-build',
          version: '1.0.0',
          endora: { type: 'module', id: 'fixture_stale_build' },
          exports: { '.': './dist/manifest.js', './admin': './dist/admin/index.js' },
        },
        null,
        2,
      )}\n`,
    );
    try {
      expect(renderAdminRegistry(instancePopulation(root)).content).not.toContain(
        'mod-stale-build',
      );
    } finally {
      rmSync(member, { recursive: true, force: true });
    }
  });

  it('refuses a published admin subpath whose file is not in the package', () => {
    // R4's rule, one population over: a skip is how a client loses a screen
    // they installed. Here it would fail at bundle time instead, with a
    // resolution error naming a package rather than the artefact that wrote it.
    const broken = join(root, 'node_modules', '@fixture', 'mod-missing-layer');
    mkdirSync(broken, { recursive: true });
    writeFileSync(
      join(broken, 'package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/mod-missing-layer',
          version: '1.0.0',
          endora: { type: 'module', id: 'fixture_missing_layer' },
          exports: { '.': './lib/manifest.js', './admin': './lib/admin/index.js' },
        },
        null,
        2,
      )}\n`,
    );
    try {
      expect(() => renderAdminRegistry(instancePopulation(root))).toThrow(
        /exports '.\/admin' as .\/lib\/admin\/index.js, and that file is not in the package/,
      );
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });

  it('refuses a published package that declares no root export', () => {
    // The `.` subpath is where a published package states its own entry point.
    // Without it there is nothing an artefact can name it by, and guessing
    // `./dist/manifest.js` would be this repository's layout asserted over a
    // stranger's package.
    const rootless = join(root, 'node_modules', '@fixture', 'mod-no-root-export');
    mkdirSync(join(rootless, 'docs'), { recursive: true });
    writeFileSync(join(rootless, 'docs', 'fixture-no-root-export.md'), '# page\n');
    writeFileSync(
      join(rootless, 'package.json'),
      `${JSON.stringify(
        {
          name: '@fixture/mod-no-root-export',
          version: '1.0.0',
          endora: { type: 'module', id: 'fixture_no_root_export' },
          exports: { './backend': './lib/backend/index.js' },
        },
        null,
        2,
      )}\n`,
    );
    try {
      expect(() => renderDocsSidebar(instancePopulation(root))).toThrow(
        /exports map declares no '\.' subpath/,
      );
    } finally {
      rmSync(rootless, { recursive: true, force: true });
    }
  });

  it('reads an instance with nothing installed as nothing to read', () => {
    // Issue #113 one layer in: "no `node_modules` at all" and "a `node_modules`
    // holding no module" are different states, and a generator that ran before
    // `pnpm install` must not be able to report the second.
    const empty = mkdtempSync(join(tmpdir(), 'endora-instance-empty-'));
    try {
      expect(scanInstalledModulePackages(empty).root).toBeNull();
      mkdirSync(join(empty, 'node_modules'));
      expect(scanInstalledModulePackages(empty).root).not.toBeNull();
      expect(scanInstalledModulePackages(empty).packages).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
