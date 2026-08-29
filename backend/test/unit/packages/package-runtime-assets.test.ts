import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import {
  auditCopiedAssets,
  collectRuntimeAssets,
  copyRuntimeAssets,
} from '../../../scripts/lib/runtime-assets.js';
import { readEmitLayout } from '../../../scripts/lib/module-packages.js';
import { nodeManifestFs } from '../../../scripts/lib/module-package-manifest.js';
import { findRepoRoot } from '../../../scripts/lib/module-roots.js';
import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';

/**
 * A module package ships the files `tsc` does not emit — feature 080,
 * criterion 8.
 *
 * ## The defect, reproduced rather than predicted
 *
 * `tsc` compiles `.ts` and copies nothing else. Measured directly on this
 * package: `rm -rf dist && tsc -p tsconfig.build.json` leaves
 * `@endora-commerce/mod-product-feeds`'s four bundled taxonomy files out of
 * `dist`, and reading the built artefact then answers
 *
 *     listBundledRevisions('google_merchant') -> []
 *     listBundledRevisions('meta')            -> []
 *
 * with no error, no warning and an exit code of 0 — the module's own doc block
 * says an installation with no bundled data *"boots perfectly well with an
 * empty taxonomy table"*, which is true and is exactly why nothing downstream
 * can tell the two apart. That is D-165's silence one layer down: the code that
 * would notice is the code that documents absence as legitimate.
 *
 * ## Where the guard fires, and why there
 *
 * **Build time**, in `scripts/copy-package-assets.mjs`, which audits its own
 * output; and **here**, over the built tree of every module package in this
 * checkout. Both sit where the two cases are still distinguishable: the source
 * tree has already said the asset exists.
 *
 * Neither *load* time nor *first read* is available for the same question. By
 * the time a package is loaded there is no source tree to compare against, so a
 * load-time guard would need the package to carry a list of its own assets —
 * a derived fact written into a published artefact (D-100), with a second drift
 * check of its own, bought to cover a tarball this repository's build cannot
 * produce: `files` names `dist`, so an asset that reached `dist` ships. And a
 * first-read guard would have to be written inside the module, where the
 * honest answer is the one the module already gives — an installation may
 * legitimately have no bundled revision.
 *
 * ## Why this file reads `dist` and does not skip when it is absent
 *
 * `pnpm run build:packages` is a precondition for running anything in this
 * repository (AGENTS.md), so an absent `dist` is a run that cannot answer the
 * question — and answering "fine" to a question you did not ask is the defect
 * this file exists for. It fails, naming the command.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(HERE);

/** Every workspace member that declares itself a module package. */
function modulePackages(): Array<{ name: string; dir: string }> {
  const fs = nodeWorkspaceFs();
  const found: Array<{ name: string; dir: string }> = [];
  for (const member of workspaceMembers(REPO_ROOT!, fs)) {
    const text = fs.readText(join(member.dir, 'package.json'));
    if (text === null) continue;
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const endora = manifest['endora'] as { type?: string } | undefined;
    if (endora?.type !== 'module') continue;
    found.push({ name: member.name, dir: member.dir });
  }
  return found;
}

const COPIER = join(REPO_ROOT ?? '', 'scripts', 'copy-package-assets.mjs');

const temporaryRoots: string[] = [];

function fixtureTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'package-assets-'));
  temporaryRoots.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
}

function runCopier(cwd: string, args: readonly string[]): { code: number; out: string } {
  const result = spawnSync(process.execPath, [COPIER, ...args], { cwd, encoding: 'utf8' });
  return {
    code: result.status ?? -1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  };
}

afterAll(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

describe('a module package ships its runtime assets (feature 080, criterion 8)', () => {
  describe('the built tree of every module package in this checkout', () => {
    it('holds every runtime asset its sources ship, at the mirrored path', () => {
      expect(REPO_ROOT).not.toBeNull();
      const packages = modulePackages();
      // Not vacuous: the rule has a subject.
      expect(packages.length).toBeGreaterThan(0);

      const fs = nodeManifestFs();
      let assetsSeen = 0;
      let packagesWithAssets = 0;

      for (const pkg of packages) {
        const emit = readEmitLayout(pkg.dir, pkg.name, fs);
        expect(emit, `${pkg.name}: no tsconfig.build.json`).not.toBeNull();
        const srcRoot = join(pkg.dir, emit!.rootDir);
        const outRoot = join(pkg.dir, emit!.outDir);

        const { assets, unclassified } = collectRuntimeAssets(srcRoot);
        expect(unclassified, `${pkg.name} ships a file kind nobody ruled on`).toEqual([]);
        if (assets.length === 0) continue;
        packagesWithAssets += 1;
        assetsSeen += assets.length;

        expect(
          existsSync(outRoot),
          `${pkg.name} ships ${assets.length} runtime asset(s) and has no ${emit!.outDir}/. ` +
            'Run `pnpm run build:packages` — it is a precondition for running anything in ' +
            'this repository, and a skip here would answer a question this run cannot ask.',
        ).toBe(true);

        expect(
          auditCopiedAssets(outRoot, assets).map((path) => `${pkg.name}:${path}`),
          `${pkg.name}: assets missing from the built tree. Nothing downstream reports this — ` +
            'the readers treat an absent directory as a module with nothing to ship.',
        ).toEqual([]);
      }

      // The population this assertion actually covered, so a run that stopped
      // finding assets is a finding rather than a cheerful green (issue #244).
      expect(packagesWithAssets, 'no module package ships a runtime asset').toBeGreaterThan(0);
      expect(assetsSeen).toBeGreaterThan(0);
    });

    it('names the copier in its build script exactly when it ships one', () => {
      const fs = nodeManifestFs();
      for (const pkg of modulePackages()) {
        const emit = readEmitLayout(pkg.dir, pkg.name, fs)!;
        const { assets } = collectRuntimeAssets(join(pkg.dir, emit.rootDir));
        const manifest = JSON.parse(
          readFileSync(join(pkg.dir, 'package.json'), 'utf8'),
        ) as { scripts: Record<string, string> };
        // A step nothing runs is a step that is not there, and a step that runs
        // over an empty population is the vacuous pass the copier exits 2 on.
        expect(
          manifest.scripts['build']?.includes('copy-package-assets.mjs') ?? false,
          `${pkg.name} ships ${assets.length} asset(s); its build script is ` +
            `'${manifest.scripts['build']}'. Run ` +
            '`pnpm --filter backend run manifests:generate`.',
        ).toBe(assets.length > 0);
      }
    });
  });

  describe('the copier itself, over trees this test builds', () => {
    it('copies an asset into the emitted tree and says what it read', () => {
      const root = fixtureTree({
        'src/backend/index.ts': 'export {};\n',
        'src/backend/data/en.txt': 'a > b\n',
        'dist/backend/index.js': 'export {};\n',
      });
      const { code, out } = runCopier(root, ['--src', 'src', '--out', 'dist']);
      expect(out).toContain('read: files=2 assets=1 copied=1');
      expect(code).toBe(0);
      expect(readFileSync(join(root, 'dist/backend/data/en.txt'), 'utf8')).toBe('a > b\n');
    });

    it('refuses an extension nobody has ruled on', () => {
      const root = fixtureTree({
        'src/backend/index.ts': 'export {};\n',
        'src/backend/templates/invoice.hbs': '{{x}}\n',
        'dist/backend/index.js': 'export {};\n',
      });
      const { code, out } = runCopier(root, ['--src', 'src', '--out', 'dist']);
      expect(code).toBe(1);
      expect(out).toContain('src/backend/templates/invoice.hbs');
      expect(out).toContain('no ruling for');
    });

    it('exits 2 on a tree that holds no asset at all', () => {
      // The step is only rendered into a build when the generator saw one, so
      // finding none is a walk reading a tree it does not think it is reading.
      const root = fixtureTree({
        'src/backend/index.ts': 'export {};\n',
        'dist/backend/index.js': 'export {};\n',
      });
      const { code, out } = runCopier(root, ['--src', 'src', '--out', 'dist']);
      expect(code).toBe(2);
      expect(out).toContain('no runtime asset found');
    });

    it('exits 2 when the compile has not run', () => {
      const root = fixtureTree({ 'src/backend/data/en.txt': 'a\n' });
      const { code, out } = runCopier(root, ['--src', 'src', '--out', 'dist']);
      expect(code).toBe(2);
      expect(out).toContain('does not exist');
    });

    it('exits 2 when there is no source root to copy from', () => {
      const root = fixtureTree({ 'dist/backend/index.js': 'export {};\n' });
      const { code } = runCopier(root, ['--src', 'src', '--out', 'dist']);
      expect(code).toBe(2);
    });

    it('exits 2 rather than guessing the emit layout', () => {
      const root = fixtureTree({
        'src/backend/data/en.txt': 'a\n',
        'dist/backend/index.js': 'export {};\n',
      });
      expect(runCopier(root, []).code).toBe(2);
      expect(runCopier(root, ['--src', 'src']).code).toBe(2);
      expect(runCopier(root, ['--src', '--out', 'dist']).code).toBe(2);
    });
  });

  describe('the audit is what makes the copy worth anything', () => {
    it('names an asset that is not in the built tree', () => {
      const source = fixtureTree({ 'src/data/en.txt': 'a\n', 'src/data/pl.txt': 'b\n' });
      const built = fixtureTree({});
      const { assets } = collectRuntimeAssets(join(source, 'src'));
      expect(assets).toEqual(['data/en.txt', 'data/pl.txt']);

      copyRuntimeAssets(join(source, 'src'), built, ['data/en.txt']);
      expect(auditCopiedAssets(built, assets)).toEqual(['data/pl.txt']);

      copyRuntimeAssets(join(source, 'src'), built, assets);
      expect(auditCopiedAssets(built, assets)).toEqual([]);
    });
  });

  describe('the one module that needs this today', () => {
    it('reads its bundled taxonomies out of the package’s own emitted tree', async () => {
      // The proof D-165 asks for: not that the build succeeded, but that the
      // running module finds its data through its own `import.meta.url` anchor
      // inside `dist`. `..` from `dist/backend/services/` is `dist/backend/`,
      // which is where the copier mirrored `src/backend/data/`.
      const pkg = modulePackages().find(
        (entry) => entry.name === '@endora-commerce/mod-product-feeds',
      );
      expect(pkg, 'product_feeds is not a module package in this checkout').toBeDefined();

      const emit = readEmitLayout(pkg!.dir, pkg!.name, nodeManifestFs())!;
      const built = join(pkg!.dir, emit.outDir, 'backend/services/taxonomy-reconciler.service.js');
      expect(
        existsSync(built),
        `${relative(REPO_ROOT!, built)} is not built — run \`pnpm run build:packages\`.`,
      ).toBe(true);

      const module = (await import(built)) as {
        TaxonomyReconcilerService: new (options: {
          emFactory: () => never;
        }) => { listBundledRevisions(provider: string): string[] };
      };
      const service = new module.TaxonomyReconcilerService({
        emFactory: () => {
          throw new Error('this assertion opens no database');
        },
      });
      expect(service.listBundledRevisions('google_merchant')).toEqual(['2021-09-21']);
      expect(service.listBundledRevisions('meta')).toEqual(['2026-08-02']);
    });
  });
});
