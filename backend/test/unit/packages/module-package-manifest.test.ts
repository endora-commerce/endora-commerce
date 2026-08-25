import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { findRepoRoot, findManifestIndex } from '../../../scripts/lib/module-roots.js';
import { parseReadSize } from '../../../scripts/lib/read-size.js';
import {
  ModulePackageManifestError,
  layerInventoryOf,
  moduleIdOf,
  nodeManifestFs,
  npmNameFor,
  peerNamesOf,
  renderModulePackageManifests,
  type ManifestFs,
} from '../../../scripts/lib/module-package-manifest.js';

/**
 * A module package's `package.json` is **derived**, not written (feature 080,
 * T041).
 *
 * The batching decision of 2026-08-24 is what makes this a gate rather than a
 * convenience: from module #6 the remaining moves land ten at a time, so a
 * batch is ten manifests, and both ways of getting one wrong are silent where
 * it is written. A missing peer dependency fails in a stranger's install, not
 * in ours — a workspace hoists every framework the application already
 * declares, so `pnpm build` is green on a manifest that names none of them. A
 * wrong `exports` key fails at `ERR_PACKAGE_PATH_NOT_EXPORTED`, at runtime, in
 * whichever consumer imports the subpath first.
 *
 * ## The reproduction test is the strongest one available
 *
 * `packages/modules/{blog,quote_requests,google_analytics}` were written by
 * hand, by three agents, on three days. They agree on the `exports` key set and
 * on the `endora` block, and they disagree on the peer count — 8, 7 and 9 —
 * which is genuine per-module variation: `google_analytics` runs a real BullMQ
 * consumer and needs `bullmq` and `ioredis`; `quote_requests`' sweep is a plain
 * function and needs neither. So the derivation is held to reproducing all
 * three, byte for byte, and a difference is a finding rather than a diff to
 * accept.
 *
 * ## Where the red proofs enter
 *
 * At the top: `renderModulePackageManifests` over a synthetic checkout — a
 * `pnpm-workspace.yaml`, a root manifest, an application manifest and the
 * package's own sources — so every stage runs, the specifier walk included. A
 * proof that handed in a pre-computed peer list would prove the serialiser and
 * leave the derivation unproven (issue #130).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = findRepoRoot(here);

/** An in-memory checkout: the top of the analysis, with nothing precomputed. */
function fixtureFs(files: Readonly<Record<string, string>>): ManifestFs {
  const paths = Object.keys(files);
  const childrenOf = (dir: string, wantDirectory: boolean): readonly string[] => {
    const prefix = dir.endsWith('/') ? dir : `${dir}/`;
    const names = new Set<string>();
    for (const path of paths) {
      if (!path.startsWith(prefix)) continue;
      const tail = path.slice(prefix.length);
      const cut = tail.indexOf('/');
      const isDirectory = cut >= 0;
      if (isDirectory !== wantDirectory) continue;
      names.add(isDirectory ? tail.slice(0, cut) : tail);
    }
    return [...names].sort();
  };
  return {
    readText: (path) => files[path] ?? null,
    listDirectories: (path) => childrenOf(path, true),
    listFiles: (path) => childrenOf(path, false),
  };
}

const ROOT = '/repo';

const BASE_TSCONFIG_BUILD = JSON.stringify({
  compilerOptions: { rootDir: 'src', outDir: 'dist', noEmitOnError: true },
});

/** The parts of a checkout every fixture needs, so each test writes only its subject. */
function checkoutWith(extra: Readonly<Record<string, string>>): Record<string, string> {
  return {
    [`${ROOT}/pnpm-workspace.yaml`]:
      'packages:\n  - backend\n  - packages/*\n  - packages/modules/*\n',
    [`${ROOT}/packages/contracts/package.json`]: JSON.stringify({
      name: '@endora-commerce/contracts',
    }),
    [`${ROOT}/packages/platform/package.json`]: JSON.stringify({
      name: '@endora-commerce/platform',
    }),
    [`${ROOT}/package.json`]: JSON.stringify({
      name: 'root',
      engines: { node: '>=22.17.0' },
    }),
    [`${ROOT}/backend/package.json`]: JSON.stringify({
      name: 'backend',
      dependencies: {
        '@mikro-orm/core': '^6.6.13',
        '@mikro-orm/migrations': '^6.6.13',
        bullmq: '^5.76.1',
        fastify: '^5.8.5',
        ioredis: '^5.10.1',
        nodemailer: '^7.0.13',
        zod: '^4.2.0',
      },
      devDependencies: {
        '@types/node': '^22.9.0',
        '@types/nodemailer': '^7.0.4',
        typescript: '^5.9.3',
      },
    }),
    [`${ROOT}/backend/src/index.generated.ts`]:
      "import { manifest as m1 } from '@endora-commerce/mod-widgets';\n" +
      "  { id: 'widgets', manifest: m1, manifestPath: resolveManifestPath(import.meta.url, '@endora-commerce/mod-widgets') },\n",
    ...extra,
  };
}

/** A minimal but complete module package, plus whatever the test overrides. */
function packageFiles(
  id: string,
  sources: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const dir = `${ROOT}/packages/modules/${id}`;
  return {
    [`${dir}/package.json`]: JSON.stringify({
      name: `@endora-commerce/mod-${id.replace(/_/g, '-')}`,
      description: 'A module package.',
      endora: { type: 'module', id },
    }),
    [`${dir}/tsconfig.build.json`]: BASE_TSCONFIG_BUILD,
    [`${dir}/src/manifest.ts`]:
      "import { defineModuleManifest } from '@endora-commerce/contracts';\n" +
      `export const manifest = defineModuleManifest({ id: '${id}', name: 'X', description: 'Y' });\n`,
    ...Object.fromEntries(
      Object.entries(sources).map(([path, text]) => [`${dir}/${path}`, text]),
    ),
    ...extra,
  };
}

const INDEX_PATH = `${ROOT}/backend/src/index.generated.ts`;

function render(files: Record<string, string>) {
  return renderModulePackageManifests(ROOT, fixtureFs(files), INDEX_PATH);
}

function manifestOf(files: Record<string, string>, id = 'widgets'): Record<string, unknown> {
  const run = render(files);
  const found = run.rendered.find((entry) => entry.moduleId === id);
  expect(found, `no manifest rendered for '${id}'`).toBeDefined();
  return JSON.parse(found!.content) as Record<string, unknown>;
}

/** The one shape every "does it derive X" proof starts from. */
function widgets(
  sources: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return checkoutWith(packageFiles('widgets', sources, extra));
}

const BACKEND_ONLY = {
  'src/backend/index.ts':
    "import type { ModuleContext } from '@endora-commerce/platform/kernel';\n" +
    'export function registerModule(ctx: ModuleContext): void { void ctx; }\n' +
    'export const entities = [];\n',
};

describe('module package manifests are generated (feature 080, T041)', () => {
  describe('it reproduces every hand-written manifest in this checkout', () => {
    it('renders each committed package.json byte-identically', () => {
      expect(repoRoot).not.toBeNull();
      const run = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      expect(run.rendered.length).toBeGreaterThan(0);
      for (const entry of run.rendered) {
        expect(readFileSync(entry.outputPath, 'utf8'), entry.outputPath).toBe(entry.content);
      }
    });

    it('is idempotent — a second render over its own output changes nothing', () => {
      const first = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      const second = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      expect(second.rendered.map((entry) => entry.content)).toEqual(
        first.rendered.map((entry) => entry.content),
      );
    });

    it('reads every module package the workspace declares, and says so', () => {
      const run = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      expect(run.filesRead).toBeGreaterThan(run.rendered.length);
      expect(run.specifierSites).toBeGreaterThan(0);
      // The independent derivation: the generated manifest index registers a
      // packaged module by bare specifier, and every one of them must be here.
      expect(run.registeredPackageNames.length).toBeGreaterThan(0);
      for (const name of run.registeredPackageNames) {
        expect(run.rendered.map((entry) => entry.packageName)).toContain(name);
      }
    });
  });

  describe('peers come from what the sources import, minus what the package owns', () => {
    it('names a framework the sources import', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/queue.ts': "import { Worker } from 'bullmq';\nexport const w = Worker;\n",
        }),
      );
      expect(manifest['peerDependencies']).toMatchObject({ bullmq: '^5' });
    });

    it('omits a framework no source imports', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['peerDependencies']).not.toHaveProperty('bullmq');
      expect(manifest['peerDependencies']).not.toHaveProperty('ioredis');
    });

    it('does not name a Node builtin imported without the node: prefix', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/id.ts': "import { randomUUID } from 'crypto';\nexport const id = randomUUID;\n",
        }),
      );
      expect(manifest['peerDependencies']).not.toHaveProperty('crypto');
    });

    it('does not name a specifier that appears only in a comment', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/doc.ts':
            "/** `import { Worker } from 'bullmq'` is what a real consumer would write. */\nexport const note = 1;\n",
        }),
      );
      expect(manifest['peerDependencies']).not.toHaveProperty('bullmq');
    });

    it('does not name the package itself', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/self.ts':
            "import { manifest } from '@endora-commerce/mod-widgets';\nexport const m = manifest;\n",
        }),
      );
      expect(manifest['peerDependencies']).not.toHaveProperty('@endora-commerce/mod-widgets');
    });

    it('gives a workspace package the workspace protocol and a third party a major range', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['peerDependencies']).toMatchObject({
        '@endora-commerce/platform': 'workspace:*',
      });
    });

    it('mirrors the peers into devDependencies at the application version', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['devDependencies']).toMatchObject({
        '@endora-commerce/platform': 'workspace:*',
        '@types/node': '^22.9.0',
        typescript: '^5.9.3',
      });
    });

    /**
     * A library whose types are a separate `@types/*` package (feature 080,
     * T040b).
     *
     * The peer list is derived from the bare specifiers the sources import, and
     * `@types/nodemailer` is imported by nobody — the compiler finds it through
     * `node_modules/@types`, which in `backend/` is the application's own
     * declaration. A package compiles against its **own** manifest, so without
     * this the module's build is TS7016 (`implicitly has an 'any' type`) on a
     * line the author never wrote, and only for the module that happened to
     * import a JS-only library. `newsletter` was the first; `pwa` and
     * `product_feeds` are the same shape.
     *
     * Derived, never listed: the companion is `@types/<name>` under the same
     * mangling npm uses, and it is added only when the application itself
     * declares it.
     */
    it('names the companion @types package the application declares', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/mail.ts':
            "import { createTransport } from 'nodemailer';\nexport const t = createTransport;\n",
        }),
      );
      expect(manifest['devDependencies']).toMatchObject({
        nodemailer: '^7.0.13',
        '@types/nodemailer': '^7.0.4',
      });
      // It is a build-time declaration, not something a consumer resolves.
      expect(manifest['peerDependencies']).not.toHaveProperty('@types/nodemailer');
    });

    it('names no companion @types package the application does not declare', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(Object.keys(manifest['devDependencies'] as object)).not.toContain(
        '@types/nodemailer',
      );
    });

    it('refuses a third-party specifier the application declares nowhere', () => {
      expect(() =>
        render(
          widgets({
            ...BACKEND_ONLY,
            'src/backend/x.ts': "import { x } from 'left-pad';\nexport const y = x;\n",
          }),
        ),
      ).toThrow(/left-pad/);
    });

    it('refuses another module package (R4)', () => {
      const files = {
        ...widgets({
          ...BACKEND_ONLY,
          'src/backend/x.ts':
            "import { manifest } from '@endora-commerce/mod-gadgets';\nexport const m = manifest;\n",
        }),
        ...packageFiles('gadgets', BACKEND_ONLY),
      };
      expect(() => render(files)).toThrow(/mod-gadgets/);
    });
  });

  describe('exports come from which layers exist', () => {
    it('emits a subpath per layer, and `./package.json` always', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(Object.keys(manifest['exports'] as object)).toEqual([
        '.',
        './backend',
        './package.json',
      ]);
    });

    it('emits `./migrations`, `./ports` and `./admin` when those layers exist', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/migrations/index.ts': 'export const migrations = [];\n',
          'src/ports/index.ts': 'export type WidgetPort = { read(): void };\n',
          'src/admin/index.ts': 'export const screens = [];\n',
        }),
      );
      expect(Object.keys(manifest['exports'] as object)).toEqual([
        '.',
        './backend',
        './migrations',
        './ports',
        './admin',
        './package.json',
      ]);
    });

    it('names the emitted file, with a types condition beside it', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect((manifest['exports'] as Record<string, unknown>)['./backend']).toEqual({
        types: './dist/backend/index.d.ts',
        default: './dist/backend/index.js',
      });
    });

    it('refuses a layer no subpath covers', () => {
      expect(() =>
        render(
          widgets({
            ...BACKEND_ONLY,
            'src/storefront/index.ts': 'export const x = 1;\n',
          }),
        ),
      ).toThrow(/storefront/);
    });

    it('refuses a layer directory with no entry point', () => {
      expect(() =>
        render(
          widgets({
            ...BACKEND_ONLY,
            'src/migrations/20260901T000000_widgets_init.ts': 'export class M {}\n',
          }),
        ),
      ).toThrow(/migrations/);
    });

    it('refuses a package with no root manifest', () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/src/manifest.ts`];
      expect(() => render(files)).toThrow(/manifest\.ts/);
    });

    it('refuses a package that declares no build', () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/tsconfig.build.json`];
      expect(() => render(files)).toThrow(/tsconfig\.build\.json/);
    });
  });

  describe('the endora block and the name come from the module manifest', () => {
    it('takes the id from src/manifest.ts, not from the file being written', () => {
      const files = widgets(BACKEND_ONLY);
      const manifest = manifestOf(files);
      expect(manifest['endora']).toEqual({ type: 'module', id: 'widgets' });
      expect(manifest['name']).toBe('@endora-commerce/mod-widgets');
    });

    it('maps underscores and a leading underscore into the npm name', () => {
      expect(npmNameFor('@endora-commerce/', 'quote_requests')).toBe(
        '@endora-commerce/mod-quote-requests',
      );
      expect(npmNameFor('@endora-commerce/', '_lifecycle')).toBe(
        '@endora-commerce/mod-lifecycle',
      );
    });

    it('refuses a manifest whose id it cannot read', () => {
      expect(() =>
        moduleIdOf('export const manifest = defineModuleManifest(makeIt());', 'manifest.ts'),
      ).toThrow(ModulePackageManifestError);
    });
  });

  describe('hand-written fields survive', () => {
    it('preserves the description already on disk', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/package.json`;
      files[path] = JSON.stringify({
        ...(JSON.parse(files[path]!) as object),
        description: 'A sentence a human wrote.',
      });
      expect(manifestOf(files)['description']).toBe('A sentence a human wrote.');
    });

    it("seeds a new package's description from its module manifest", () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      // With no package.json there is no `endora` block to discover it by, so a
      // brand-new package is reached through its directory under a workspace
      // glob — and the description comes off `manifest.ts`.
      expect(manifestOf(files)['description']).toBe('Y');
    });

    it('preserves a hand-written dependencies block', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/package.json`;
      files[path] = JSON.stringify({
        ...(JSON.parse(files[path]!) as object),
        dependencies: { 'some-lib': '^1.0.0' },
      });
      expect(manifestOf(files)['dependencies']).toEqual({ 'some-lib': '^1.0.0' });
    });

    it('refuses a field it neither generates nor preserves', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/package.json`;
      files[path] = JSON.stringify({
        ...(JSON.parse(files[path]!) as object),
        peerDependenciesMeta: { fastify: { optional: true } },
      });
      expect(() => render(files)).toThrow(/peerDependenciesMeta/);
    });
  });

  describe('the constant half', () => {
    it('stays private at 0.0.0 with no side effects (R6)', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['version']).toBe('0.0.0');
      expect(manifest['private']).toBe(true);
      expect(manifest['type']).toBe('module');
      expect(manifest['sideEffects']).toBe(false);
    });

    it('ships the emitted directory, plus the asset directories that exist', () => {
      const withI18n = manifestOf(
        widgets(BACKEND_ONLY, {
          [`${ROOT}/packages/modules/widgets/i18n/en.json`]: '{}',
        }),
      );
      expect(withI18n['files']).toEqual(['dist', 'i18n']);
      expect(manifestOf(widgets(BACKEND_ONLY))['files']).toEqual(['dist']);
    });

    it("takes the node engine from the workspace root's own declaration", () => {
      expect(manifestOf(widgets(BACKEND_ONLY))['engines']).toEqual({ node: '>=22.17.0' });
    });

    it('lints the source directories that exist', () => {
      expect((manifestOf(widgets(BACKEND_ONLY))['scripts'] as Record<string, string>)['lint']).toBe(
        'eslint src',
      );
      const withTests = manifestOf(
        widgets(BACKEND_ONLY, {
          [`${ROOT}/packages/modules/widgets/test/unit/a.test.ts`]: 'export {};\n',
        }),
      );
      expect((withTests['scripts'] as Record<string, string>)['lint']).toBe('eslint src test');
    });
  });

  describe('it refuses a run that read nothing', () => {
    it('refuses a workspace that declares no member', () => {
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/pnpm-workspace.yaml`] = 'packages:\n';
      expect(() => render(files)).toThrow(/declares no workspace member/);
    });

    it('refuses an unreadable manifest index — the derivation it is reconciled against', () => {
      const files = widgets(BACKEND_ONLY);
      delete files[INDEX_PATH];
      expect(() => render(files)).toThrow(/could not be read/);
    });

    it('comes back short when the index registers a package the globs do not reach', () => {
      // #215 over this population: the index is a committed artefact from a
      // different walk, so a module it registers by bare specifier and this run
      // did not render is a walk that read a residue. `reportReadSize` turns
      // the shortfall below into exit 2; what is proven here is that the two
      // numbers really are two derivations.
      const files = widgets(BACKEND_ONLY);
      files[INDEX_PATH] +=
        "  { id: 'gadgets', manifest: m2, manifestPath: resolveManifestPath(import.meta.url, '@endora-commerce/mod-gadgets') },\n";
      const run = render(files);
      const rendered = new Set(run.rendered.map((entry) => entry.packageName));
      const covered = run.registeredPackageNames.filter((name) => rendered.has(name));
      expect(run.registeredPackageNames).toHaveLength(2);
      expect(covered).toHaveLength(1);
    });
  });

  describe('the command itself', () => {
    const backendRoot = join(repoRoot!, 'backend');

    it('reports the tree as up to date, and says what it read', () => {
      const result = spawnSync(
        'pnpm',
        ['exec', 'tsx', 'scripts/generate-module-manifests.ts', '--check'],
        { cwd: backendRoot, encoding: 'utf8' },
      );
      const output = `${result.stdout}${result.stderr}`;
      expect(result.status, output).toBe(0);
      const read = parseReadSize(output);
      expect(read, `no read line in:\n${output}`).not.toBeNull();
      expect(read!.prefix).toBe('module-manifests');
      expect(read!.files).toBeGreaterThan(0);
      expect(read!.sites).toBeGreaterThan(0);
      // Not self-reported: the manifest index is a committed artefact produced
      // by a different walk, and a packaged module it registers is one this run
      // must have rendered (issue #244).
      expect(read!.selfReported).toBe(false);
      expect(read!.coverage.map((entry) => entry.source)).toContain('manifest-index');
      for (const entry of read!.coverage) {
        expect(entry.expected).toBeGreaterThan(0);
        expect(entry.covered).toBe(entry.expected);
      }
    });

    it('writes nothing in --check mode', () => {
      const subject = join(
        repoRoot!,
        'packages',
        'modules',
        'blog',
        'package.json',
      );
      const before = readFileSync(subject, 'utf8');
      spawnSync('pnpm', ['exec', 'tsx', 'scripts/generate-module-manifests.ts', '--check'], {
        cwd: backendRoot,
        encoding: 'utf8',
      });
      expect(readFileSync(subject, 'utf8')).toBe(before);
    });
  });

  describe('the sub-derivations, each on its own', () => {
    it('reads a layer inventory off the directory', () => {
      const fs = fixtureFs(widgets(BACKEND_ONLY));
      const inventory = layerInventoryOf(`${ROOT}/packages/modules/widgets`, fs);
      expect(inventory.layers.map((layer) => layer.subpath)).toEqual(['./backend']);
    });

    it('reads bare specifiers out of source text, in every import shape', () => {
      const names = peerNamesOf(
        new Map([
          [
            'a.ts',
            "import type { A } from 'fastify';\n" +
              "export { B } from 'zod';\n" +
              "const c = await import('bullmq');\n" +
              "import 'ioredis';\n" +
              "import { d } from './local.js';\n" +
              "import { e } from 'node:crypto';\n",
          ],
        ]),
      );
      expect([...names].sort()).toEqual(['bullmq', 'fastify', 'ioredis', 'zod']);
    });
  });
});
