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
import { UnreadableSubpathError } from '../../../scripts/lib/module-package-subpaths.js';

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

/**
 * The number the fixture checkout's release process has already set, on the
 * platform and on every package in it.
 *
 * It is one number rather than a per-package one because that is the state
 * D-210 created and the state a module package is born into: the seed a
 * package with no manifest yet receives is the platform's, so a fixture whose
 * platform and packages disagreed would leave "which of the two did it read?"
 * unanswered for every test that does not ask it directly. The tests that
 * *are* about that question write their own disagreeing pair.
 */
const PLATFORM_VERSION = '0.7.0';

/** The parts of a checkout every fixture needs, so each test writes only its subject. */
function checkoutWith(extra: Readonly<Record<string, string>>): Record<string, string> {
  return {
    [`${ROOT}/pnpm-workspace.yaml`]:
      'packages:\n  - backend\n  - admin\n  - packages/*\n  - packages/modules/*\n',
    // The admin application. Two things need it since feature 091 and both are
    // derivations rather than paths: `applicationVersions` reads the range of
    // every framework a module's **admin** layer can peer on out of it (`react`
    // and `lucide-react` are declared by no other member), and
    // `renderAdminApplicationManifest` reconciles its dependency on the module
    // packages whose `./admin` layer the generated registry imports. It is
    // found by the `"@/*"` tsconfig alias, the same live declaration every
    // admin instrument resolves through.
    [`${ROOT}/admin/package.json`]: JSON.stringify({
      name: 'admin',
      dependencies: {
        '@endora-commerce/contracts': 'workspace:*',
        'lucide-react': '^1.11.0',
        react: '^19.2.5',
      },
    }),
    [`${ROOT}/admin/tsconfig.json`]: JSON.stringify({
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
    }),
    [`${ROOT}/packages/contracts/package.json`]: JSON.stringify({
      name: '@endora-commerce/contracts',
    }),
    // The host. It is also where a module package with no manifest yet gets
    // its first `version` from (D-210), and it is found by the `endora` block
    // it declares about itself — the same one `lib/platform-root.ts` locates
    // the platform's sources by — rather than by its directory or its name.
    [`${ROOT}/packages/platform/package.json`]: JSON.stringify({
      name: '@endora-commerce/platform',
      version: PLATFORM_VERSION,
      endora: { type: 'platform' },
    }),
    // The workspace root declares the two facts every module package's
    // manifest is derived from and neither of which is a property of the
    // package: the Node engine floor, and — since D-208 published all 79 — the
    // `repository.url` a consumer follows back to the code. One home each.
    [`${ROOT}/package.json`]: JSON.stringify({
      name: 'root',
      repository: { type: 'git', url: 'git+https://example.invalid/fx.git' },
      engines: { node: '>=22.17.0' },
      // And the estate's licence default (the owner's ruling of 2026-09-06).
      // One home, for the reason above it: a package inherits it, and a module
      // that is assigned to the paid tier overrides it from its own
      // `src/manifest.ts` rather than from here.
      license: 'MIT',
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
        '@types/react': '^19.2.14',
        react: '^19.2.5',
        typescript: '^5.9.3',
        // The real application declares it, and a fixture that ships a test
        // file has to: the specifier walk reads the test's own `import … from
        // 'vitest'` and the peer range is the major of what the application
        // runs, so without this a realistic test fixture is refused for a
        // reason that has nothing to do with what it is proving.
        vitest: '^2.1.4',
      },
    }),
    // The installed `@types/*` packages D-181's split reads, in the two shapes it
    // distinguishes. `@types/nodemailer` declares only modules — a consumer has no other
    // way to obtain those types, so a package whose declarations need them declares it.
    // `@types/react` ships a global-scope declaration file, so it exists once in a
    // consumer's program by construction and forcing ours is a conflict the application
    // author cannot fix; those types are theirs to supply. Real files, so the predicate
    // enters at the top rather than being handed a verdict (issue #130).
    [`${ROOT}/backend/node_modules/@types/nodemailer/package.json`]: JSON.stringify({
      name: '@types/nodemailer',
    }),
    [`${ROOT}/backend/node_modules/@types/nodemailer/index.d.ts`]:
      'export declare function createTransport(): unknown;\n',
    [`${ROOT}/backend/node_modules/@types/react/package.json`]: JSON.stringify({
      name: '@types/react',
    }),
    [`${ROOT}/backend/node_modules/@types/react/index.d.ts`]:
      'export declare function createElement(): unknown;\n',
    [`${ROOT}/backend/node_modules/@types/react/global.d.ts`]:
      'declare namespace JSX { interface Element {} }\n',
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
      // Every package in a real checkout carries the number its last release
      // gave it, so the fixture does too: the default path through this
      // generator is the one that **preserves** a version, not the one that
      // seeds it.
      version: PLATFORM_VERSION,
      description: 'A module package.',
      endora: { type: 'module', id },
    }),
    [`${dir}/tsconfig.build.json`]: BASE_TSCONFIG_BUILD,
    // What the build emitted, which is the population D-181's question is asked of: does
    // this specifier survive into the package's own `.d.ts`? A package with none answers
    // by the generator's fail-closed guess instead, so every fixture ships one and the
    // proofs that are *about* survival write their own.
    [`${dir}/dist/manifest.d.ts`]: 'export declare const manifest: unknown;\n',
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

    it('renders every committed tailwind.css byte-identically', () => {
      // The declaration and the file it names are two halves of one statement
      // (`admin-stylesheet-composition.md` R1.4), so the drift gate covers
      // both: a run that wrote one and not the other publishes a subpath over
      // a file that is not there — `ERR_PACKAGE_PATH_NOT_EXPORTED` at the first
      // consumer, or a stylesheet nothing imports.
      const run = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      expect(run.stylesheets.length).toBeGreaterThan(0);
      for (const entry of run.stylesheets) {
        expect(readFileSync(entry.outputPath, 'utf8'), entry.outputPath).toBe(entry.content);
      }
      // And the library family's two reconciled keys, on the same terms: the
      // shell and the kit family ship the admin's own screens and are module
      // packages of nothing, so nothing else in this run would name them.
      expect(run.familyRendered.length).toBeGreaterThan(0);
      for (const entry of run.familyRendered) {
        expect(readFileSync(entry.outputPath, 'utf8'), entry.outputPath).toBe(entry.content);
      }
    });

    it('declares the subpath for exactly the packages whose stylesheet it renders', () => {
      // R1.1's two halves, reconciled against each other over the real tree.
      // A package with a stylesheet and no subpath publishes a file no
      // consumer can name; a package with a subpath and no stylesheet is M9.
      const run = renderModulePackageManifests(
        repoRoot!,
        nodeManifestFs(),
        findManifestIndex(repoRoot!),
      );
      const withStylesheet = new Set(run.stylesheets.map((entry) => entry.packageName));
      for (const entry of [...run.rendered, ...run.familyRendered]) {
        const manifest = JSON.parse(entry.content) as { exports: Record<string, unknown> };
        expect(
          manifest.exports['./tailwind.css'] !== undefined,
          `${entry.packageName} declares ./tailwind.css`,
        ).toBe(withStylesheet.has(entry.packageName));
      }
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
      // A build-time declaration and nothing more, because `nodemailer` appears nowhere in
      // what this package publishes: the emitted declarations name it, or they do not, and
      // here they do not. That is the live split in this repository — `email` and
      // `newsletter` import `nodemailer` inside function bodies, `invoices` and
      // `comparisons` put `pdfmake/interfaces.js` in an exported signature.
      expect(manifest['peerDependencies']).not.toHaveProperty('@types/nodemailer');
    });

    /**
     * D-181, the `@types/*` half: a companion whose types reach a consumer.
     *
     * `tsc` copies the import into the emitted `.d.ts`, so a consumer type-checking this
     * package resolves `nodemailer` — and its *types* come from a package nobody imports
     * by name. A `devDependency` is not installed for a consumer, so those types are
     * simply absent and every signature through them becomes `any`, with no diagnostic at
     * all under the `skipLibCheck: true` that `tsc --init` writes.
     */
    it('declares the companion for real when its library reaches the published declarations', () => {
      const manifest = manifestOf(
        widgets(
          {
            ...BACKEND_ONLY,
            'src/backend/mail.ts':
              "import type { Transport } from 'nodemailer';\nexport type T = Transport;\n",
          },
          {
            [`${ROOT}/packages/modules/widgets/dist/backend/index.d.ts`]:
              "import type { Transport } from 'nodemailer';\nexport declare const t: Transport;\n",
          },
        ),
      );
      expect(manifest['peerDependencies']).toMatchObject({ '@types/nodemailer': '^7' });
      expect(manifest['devDependencies']).toMatchObject({ '@types/nodemailer': '^7.0.4' });
    });

    /**
     * The other side of D-181's split, and the reason it is a question rather than a list.
     *
     * `@types/react` ships a global-scope declaration file, so it exists exactly once in a
     * consumer's program: forcing our copy on an application that already has its own is a
     * duplicate-identifier error its author cannot fix by any import. Those types are the
     * consumer's to supply, and the discriminator is read off the types package itself —
     * so the fifth such package is answered without anybody adding it anywhere.
     */
    it('leaves a globally-declaring companion to the consumer, reached or not', () => {
      const manifest = manifestOf(
        widgets(
          {
            ...BACKEND_ONLY,
            'src/backend/ui.ts':
              "import type { ReactNode } from 'react';\nexport type N = ReactNode;\n",
          },
          {
            [`${ROOT}/packages/modules/widgets/dist/backend/index.d.ts`]:
              "import type { ReactNode } from 'react';\nexport declare const n: ReactNode;\n",
          },
        ),
      );
      expect(manifest['peerDependencies']).toMatchObject({ react: '^19' });
      expect(manifest['peerDependencies']).not.toHaveProperty('@types/react');
      expect(manifest['devDependencies']).toMatchObject({ '@types/react': '^19.2.14' });
    });

    it('refuses a companion it cannot read rather than guessing which side it is', () => {
      // A types package this cannot open must never become an answer in either direction
      // (issue #113): it would silently be treated as consumer-supplied, which is the
      // fail-open of the two.
      const files = widgets(
        {
          ...BACKEND_ONLY,
          'src/backend/mail.ts':
            "import type { Transport } from 'nodemailer';\nexport type T = Transport;\n",
        },
        {
          [`${ROOT}/packages/modules/widgets/dist/backend/index.d.ts`]:
            "import type { Transport } from 'nodemailer';\nexport declare const t: Transport;\n",
        },
      );
      delete files[`${ROOT}/backend/node_modules/@types/nodemailer/package.json`];
      expect(() => render(files)).toThrow(/@types\/nodemailer/);
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

  /**
   * R4, narrowed to what its reason actually reaches (D-171).
   *
   * D-11 rule 3's own words are *"must not list any `@endora-commerce/mod-*` in
   * **`dependencies`**"*, and the "Why" beneath it names the type-only case by
   * name — *"Type-only imports of another module's contracts are the mirror
   * false positive"*. The generator widened that from a field to every import,
   * because when it was written `./ports` did not exist. It does now, and
   * D-171 already ruled that a reach into it is not cross-module coupling.
   *
   * So: **every** reach into another module package must be a type-only import
   * at a subpath whose emitted module exports no runtime binding, and then the
   * name is rendered into `devDependencies` alone. Everything else keeps R4's
   * refusal and R4's message.
   *
   * ## Where these proofs enter
   *
   * At the top, like every other proof in this file: a synthetic checkout in
   * which the owner package carries a **real `exports` map** and a **real
   * emitted module**, so the surfaces predicate parses the same artefact a real
   * run parses. A proof that handed in a pre-classified `SubpathSurface` would
   * prove the branch and leave the predicate unproven (issue #130) — and the
   * predicate is the whole ruling.
   */
  describe('a peer is what a consumer owes, and which layer wrote it decides (FR-022)', () => {
    /**
     * A `peerDependencies` entry is an **install-time** requirement — npm and
     * pnpm provide a missing one automatically — so before this every name in
     * that map was something an instance installed whether or not it used the
     * layer that needed it. Measured on `master` over 70 module packages: 56
     * required `vitest`, 55 `@endora-commerce/admin-kit` and 54 `react`, and
     * not one package declared a `peerDependenciesMeta`. A backend-only
     * instance installed a test runner, React, a router and a charting library.
     *
     * The derivation needs no dataflow, which is why the header's old rejection
     * of the field missed it: a specifier is already carried with the file it
     * was written in, so *which layer wrote the reach* is one field away.
     */
    const UI_AND_BACKEND = {
      ...BACKEND_ONLY,
      'src/admin/index.ts':
        "import { createElement } from 'react';\n" +
        'export const contributions = { routes: [createElement] };\n',
    };

    it('marks a peer only a UI layer reaches as optional', () => {
      const manifest = manifestOf(widgets(UI_AND_BACKEND));
      expect(manifest['peerDependencies']).toMatchObject({ react: '^19' });
      expect(manifest['peerDependenciesMeta']).toMatchObject({ react: { optional: true } });
    });

    /**
     * `./backend`, `./migrations`, `./ports` and the root manifest are on the
     * path of every consumer that composes the module at all — there is no
     * instance that resolves the module and not those — so a name they reach is
     * owed outright.
     */
    it('leaves a peer a runtime layer reaches required', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/queue.ts': "import { Worker } from 'bullmq';\nexport const w = Worker;\n",
        }),
      );
      expect(manifest['peerDependencies']).toMatchObject({ bullmq: '^5' });
      expect(manifest).not.toHaveProperty('peerDependenciesMeta');
    });

    /**
     * Optionality is a property of the **whole set** of reaches rather than of
     * any one of them: one runtime import is enough to make the peer owed, and
     * a per-reach answer would mark a name optional on the strength of the
     * admin screen that also happens to use it.
     */
    it('does not mark a peer optional when a runtime layer reaches it too', () => {
      const manifest = manifestOf(
        widgets({
          ...UI_AND_BACKEND,
          'src/backend/render.ts': "import { createElement } from 'react';\nexport const e = createElement;\n",
        }),
      );
      expect(manifest['peerDependencies']).toMatchObject({ react: '^19' });
      expect(manifest['peerDependenciesMeta'] ?? {}).not.toHaveProperty('react');
    });

    /**
     * And the headline: a name **only a test file** reaches is not a peer at
     * all. A module package's `tsconfig.json` excludes the test spellings from
     * the program its `tsconfig.build.json` emits, so nothing a test imports
     * survives into anything published — not the JavaScript, not the
     * declarations — and a consumer owes it nothing. It stays a devDependency,
     * because the package still has to run its own tests.
     */
    it('does not make a peer of a name only a co-located test imports', () => {
      const manifest = manifestOf(
        widgets(
          {
            ...BACKEND_ONLY,
            'src/backend/thing.test.ts':
              "import { it } from 'vitest';\nimport fastify from 'fastify';\nit('x', () => { void fastify; });\n",
          },
          { [`${ROOT}/packages/modules/widgets/vitest.config.ts`]: 'export default {};\n' },
        ),
      );
      expect(manifest['peerDependencies']).not.toHaveProperty('vitest');
      expect(manifest['peerDependencies']).not.toHaveProperty('fastify');
      expect(manifest['devDependencies']).toMatchObject({
        vitest: '^2.1.4',
        fastify: '^5.8.5',
      });
    });

    /**
     * Emitted only when there is one, because an empty object is the same fact
     * as an absent one and npm reads neither — and a manifest carrying an empty
     * block would put a key in 15 of the 70 packages that says nothing.
     */
    it('emits no meta block for a package with no optional peer', () => {
      expect(manifestOf(widgets(BACKEND_ONLY))).not.toHaveProperty('peerDependenciesMeta');
    });
  });

  describe('the licence: one declared default, one override per module', () => {
    /**
     * The owner's ruling of 2026-09-06 splits **by package** — the open core is
     * `MIT`, a paid package carries `SEE LICENSE IN LICENSE.md` — and this
     * generator builds the mechanism and never the values. Which modules are
     * paid is a product decision nobody has taken, and rendering a guess into
     * 70 manifests would be a licence grant no owner authorised, in the one
     * direction that cannot be withdrawn from whoever already installed it.
     */
    it('renders the workspace root default', () => {
      expect(manifestOf(widgets(BACKEND_ONLY))['license']).toBe('MIT');
    });

    /**
     * One field in one file, and the generator does the rest — which is the
     * whole requirement: assigning a module to the paid tier later must not be
     * 70 hand-edits of a generated file.
     */
    it('takes a module\'s own override from its manifest.ts', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/src/manifest.ts`;
      files[path] = `${files[path]!}export const packageLicense = 'SEE LICENSE IN LICENSE.md';\n`;
      expect(manifestOf(files)['license']).toBe('SEE LICENSE IN LICENSE.md');
    });

    /**
     * A licence this derivation cannot read must not fall through to the
     * default, because the default is the **permissive** one: the silent answer
     * would be a grant nobody wrote (issue #113, in the one direction where it
     * is irreversible).
     */
    it('refuses a computed override rather than falling back to the default', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/src/manifest.ts`;
      files[path] = `${files[path]!}export const packageLicense = process.env.LICENCE ?? 'MIT';\n`;
      expect(() => render(files)).toThrow(/packageLicense/);
    });

    /**
     * And the root refusal, for the same reason one layer up: a workspace with
     * no declared default has no licence for a package to inherit, and a
     * constant in the generator would be the estate's licence recorded a
     * seventy-first time (D-100).
     */
    it('refuses a workspace root that declares no default', () => {
      const files = widgets(BACKEND_ONLY);
      const root = JSON.parse(files[`${ROOT}/package.json`]!) as Record<string, unknown>;
      delete root['license'];
      files[`${ROOT}/package.json`] = JSON.stringify(root);
      expect(() => render(files)).toThrow(/license/);
    });
  });

  describe('a type-only reach into contract surface is a devDependency (R4 narrowed, D-171)', () => {
    /** An owner package that really declares a subpath and really emits it. */
    function ownerFiles(
      id: string,
      options: {
        readonly subpath: string;
        /** The emitted module's text; `undefined` leaves the file absent. */
        readonly emitted?: string;
        /** Declare the subpath in the `exports` map at all? */
        readonly declared?: boolean;
      },
    ): Record<string, string> {
      const dir = `${ROOT}/packages/modules/${id}`;
      const name = `@endora-commerce/mod-${id.replace(/_/g, '-')}`;
      const files: Record<string, string> = {
        ...packageFiles(id, {
          ...BACKEND_ONLY,
          [`src/${options.subpath}/index.ts`]:
            'export interface GadgetPort { read(): void }\n',
        }),
        [`${dir}/package.json`]: JSON.stringify({
          name,
          description: 'A module package.',
          endora: { type: 'module', id },
          exports: {
            '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' },
            './backend': {
              types: './dist/backend/index.d.ts',
              default: './dist/backend/index.js',
            },
            ...(options.declared === false
              ? {}
              : {
                  [`./${options.subpath}`]: {
                    types: `./dist/${options.subpath}/index.d.ts`,
                    default: `./dist/${options.subpath}/index.js`,
                  },
                }),
            './package.json': './package.json',
          },
        }),
        // `./backend` is the runtime layer every module package publishes, and
        // it is emitted here so the `./backend` proof measures a real module
        // rather than an unreadable one.
        [`${dir}/dist/backend/index.js`]:
          'export function registerModule(ctx) { void ctx; }\nexport const entities = [];\n',
      };
      if (options.emitted !== undefined) {
        files[`${dir}/dist/${options.subpath}/index.js`] = options.emitted;
      }
      return files;
    }

    /** A consumer whose single foreign specifier is the subject of the proof. */
    function consumerReaching(line: string): Record<string, string> {
      return widgets({ ...BACKEND_ONLY, 'src/backend/reach.ts': `${line}\n` });
    }

    const TYPE_ONLY_PORTS =
      "import type { GadgetPort } from '@endora-commerce/mod-gadgets/ports';\n" +
      'export type P = GadgetPort;';

    it('renders it into devDependencies alone when the emitted module exports nothing', () => {
      const manifest = manifestOf({
        ...consumerReaching(TYPE_ONLY_PORTS),
        ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
      });
      expect(manifest['devDependencies']).toMatchObject({
        '@endora-commerce/mod-gadgets': 'workspace:*',
      });
      // The two fields an installer resolves. `devDependencies` of a dependency
      // are never installed, so this creates no edge in any consumer's install
      // graph and imposes no range on anybody — which is the whole reason it is
      // the field D-171's exemption may use.
      expect(manifest['peerDependencies']).not.toHaveProperty(
        '@endora-commerce/mod-gadgets',
      );
      expect(manifest).not.toHaveProperty('dependencies');
    });

    /**
     * D-181 — the same reach, once it survives into what this package publishes.
     *
     * D-171 reasoned that an `import type` is erased and so *"npm need not know about
     * it"*. That is true of the emitted **JavaScript** and false of the emitted
     * **declarations**: `tsc` copies the import into the `.d.ts` verbatim whenever the
     * type appears in an exported signature, and a consumer type-checking the package must
     * resolve it. Measured on the real tree with `mod-custom-fields` not installed:
     * `mod-catalog`'s exported `CatalogCradle.customFieldDefinitionService` became `any`,
     * with no diagnostic at all under `skipLibCheck: true`.
     *
     * So the peer, and deliberately not an *optional* peer — that documents the defect
     * rather than removing it — and deliberately not `dependencies`, which is R4's own
     * word and the field a package author owns.
     */
    it('declares it for real once the reach survives into the declarations (D-181)', () => {
      const manifest = manifestOf({
        ...widgets(
          { ...BACKEND_ONLY, 'src/backend/reach.ts': `${TYPE_ONLY_PORTS}\n` },
          {
            [`${ROOT}/packages/modules/widgets/dist/backend/index.d.ts`]:
              "import type { GadgetPort } from '@endora-commerce/mod-gadgets/ports';\n" +
              'export declare const p: GadgetPort;\n',
          },
        ),
        ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
      });
      expect(manifest['peerDependencies']).toMatchObject({
        '@endora-commerce/mod-gadgets': 'workspace:*',
      });
      expect(manifest['devDependencies']).toMatchObject({
        '@endora-commerce/mod-gadgets': 'workspace:*',
      });
      expect(manifest).not.toHaveProperty('dependencies');
    });

    it('fails closed for a package with no emitted declarations at all', () => {
      // The bootstrap state — a module directory just `git mv`d into place has no
      // `package.json`, so it cannot be built, so its manifest is rendered before its
      // `dist` exists. There is no artefact to ask, and the two ways of being wrong are
      // not equal: over-declaring costs a dependency nobody needed, under-declaring is
      // D-181's silent `any`. So every reach is taken to survive, and the run reports the
      // package so `--check` can refuse a verdict taken against the guess.
      const files = {
        ...widgets({ ...BACKEND_ONLY, 'src/backend/reach.ts': `${TYPE_ONLY_PORTS}\n` }),
        ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
      };
      delete files[`${ROOT}/packages/modules/widgets/dist/manifest.d.ts`];
      const run = render(files);
      expect(run.unbuiltPackages).toContain('@endora-commerce/mod-widgets');
      const manifest = JSON.parse(
        run.rendered.find((entry) => entry.moduleId === 'widgets')!.content,
      ) as Record<string, unknown>;
      expect(manifest['peerDependencies']).toHaveProperty('@endora-commerce/mod-gadgets');
    });

    it('reports a package it is rendering a first manifest for, apart from an unbuilt one', () => {
      // The bootstrap state again, one question further on. A module directory
      // just `git mv`d into place — or scaffolded by `endora new module` — has
      // no `package.json`, so it is not a workspace member, so nothing can build
      // it, so its `dist` is absent by construction and will stay absent until
      // this command has run once. `unbuiltPackages` alone cannot tell that
      // apart from a checkout that skipped `pnpm run build:packages`, and the
      // disclosure line's `emitted-declarations` floor refused the difference:
      // measured on this repository, `manifests:generate` wrote the new
      // manifest and then exited 2 on `emitted-declarations 66/67`, so the one
      // run that has to succeed was the one run that could not.
      //
      // The fixture enters at the file — the manifest is removed from the tree,
      // which is what a first render actually looks like — rather than at a
      // flag the derivation normally computes.
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      delete files[`${ROOT}/packages/modules/widgets/dist/manifest.d.ts`];

      const run = render(files);

      expect(run.newPackages).toEqual(['@endora-commerce/mod-widgets']);
      expect(run.unbuiltPackages).toEqual(['@endora-commerce/mod-widgets']);
    });

    it('reports no first render for a package that already has a manifest', () => {
      // The other direction, so the flag cannot be read as "unbuilt" wearing a
      // second name: this package has a `package.json` and no `dist`, which is
      // the checkout that skipped the build and must stay a short walk.
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/dist/manifest.d.ts`];

      const run = render(files);

      expect(run.newPackages).toEqual([]);
      expect(run.unbuiltPackages).toEqual(['@endora-commerce/mod-widgets']);
    });

    it('refuses it when the subpath emits a const — the exemption fails closed', () => {
      // D-171 in terms: *"put a `const` on `./ports` and the exemption
      // evaporates in the same run T050's guard goes red."* Identical specifier,
      // identical import kind; only the artefact moved.
      expect(() =>
        render({
          ...consumerReaching(TYPE_ONLY_PORTS),
          ...ownerFiles('gadgets', {
            subpath: 'ports',
            emitted: "export const REGISTRY = new Map();\n",
          }),
        }),
      ).toThrow(/surface is 'runtime'.*REGISTRY/s);
    });

    it('refuses a value import at the same contract-surface subpath', () => {
      expect(() =>
        render({
          ...consumerReaching(
            "import { GadgetPort } from '@endora-commerce/mod-gadgets/ports';\n" +
              'export const p = GadgetPort;',
          ),
          ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
        }),
      ).toThrow(/as a value-import, which survives into the emitted JavaScript/);
    });

    it('refuses a side-effect import at the same contract-surface subpath', () => {
      // `import '<pkg>/ports'` is erased by nothing: it is in the emitted `.js`
      // and needs a dependency an installer really resolves.
      expect(() =>
        render({
          ...consumerReaching("import '@endora-commerce/mod-gadgets/ports';"),
          ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
        }),
      ).toThrow(/as a side-effect-import, which survives into the emitted JavaScript/);
    });

    it('refuses a type-only reach at ./backend with R4’s message, unchanged', () => {
      let message = '';
      try {
        render({
          ...consumerReaching(
            "import type { Gadget } from '@endora-commerce/mod-gadgets/backend';\n" +
              'export type G = Gadget;',
          ),
          ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
        });
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      // R4's original sentence, verbatim — the narrowing adds one sentence and
      // rewrites none.
      expect(message).toContain(
        'imports @endora-commerce/mod-gadgets, another module package. R4: a module reaches ' +
          'another through a port declared in its manifest `dependencies`, never through npm ' +
          '— a package edge is one the lifecycle, the migration order and an operator ' +
          'switching the owner off all know nothing about.',
      );
      expect(message).toMatch(/surface is 'runtime'.*registerModule/s);
    });

    it('refuses a type-only reach at a subpath the owner does not declare', () => {
      expect(() =>
        render({
          ...consumerReaching(
            "import type { GadgetPort } from '@endora-commerce/mod-gadgets/internals';\n" +
              'export type P = GadgetPort;',
          ),
          ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
        }),
      ).toThrow(/surface is 'undeclared'/);
    });

    it('refuses a declared subpath whose emitted module is missing, as exit 2 and not as R4', () => {
      // The one direction in which a silence would grant standing rather than
      // withhold it (issue #113). A cold `dist` is a broken artefact, not a
      // coupling, and a refusal that said "coupling" would send the author to
      // redesign a seam that is fine.
      let caught: unknown;
      try {
        render({
          ...consumerReaching(TYPE_ONLY_PORTS),
          ...ownerFiles('gadgets', { subpath: 'ports' }),
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UnreadableSubpathError);
      expect(caught).not.toBeInstanceOf(ModulePackageManifestError);
      expect((caught as Error).message).toContain('pnpm run build:packages');
    });

    it('counts the owner manifests and emitted modules it opened', () => {
      // A check that reads files without counting them is issue #244 in the
      // tool that exists to prevent it.
      const withReach = render({
        ...consumerReaching(TYPE_ONLY_PORTS),
        ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
      });
      // The same checkout, file for file, with the one specifier pointing at
      // the consumer's own tree instead of at the owner — so the difference is
      // the surfaces reader's two files and nothing else.
      const withoutReach = render({
        ...consumerReaching(
          "import type { ModuleContext } from '@endora-commerce/platform/kernel';\n" +
            'export type P = ModuleContext;',
        ),
        ...ownerFiles('gadgets', { subpath: 'ports', emitted: 'export {};\n' }),
      });
      // The owner's `package.json` and its emitted `dist/ports/index.js`: two
      // files the run would otherwise have read and not reported.
      expect(withReach.filesRead - withoutReach.filesRead).toBe(2);
    });
  });

  /**
   * A devDependency cycle between two module packages, refused here.
   *
   * pnpm's workspace graph includes `devDependencies`, which is what orders
   * `pnpm -r run build` so an owner's `dist/ports/index.d.ts` exists before its
   * consumer's `tsc` looks for it. A cycle is where that benefit bites:
   * measured on this tree, pnpm **warns and does not fail**, loses the ordering,
   * builds the pair concurrently, and the consumer fails with TS2307 — then
   * succeeds on a re-run. A CI red that depends on scheduling.
   *
   * `orders` ↔ `payments` **is** that pair, and it stopped being hypothetical
   * while this was being written. T048 (!1052) converted `orders`' reach into
   * `payments`' `Payment` entity class into a published port, so the tree now
   * holds both directions, both `import type`, both into a `ports/index`:
   *
   *   `orders/services/order-service.ts`     → `payments/ports/index`
   *   `payments/services/receive-payment-handler.ts` → `orders/ports/index`
   *
   * They are relative specifiers today, which is why nothing is red: a relative
   * specifier has no subpath and names no package. The moment both modules are
   * packaged and both specifiers become bare, each manifest devDepends on the
   * other — which is this fixture, with the real names and the real directions.
   */
  describe('a mutual type-only devDependency pair is refused (§7)', () => {
    /**
     * `orders` and `payments` as packages, each publishing the `./ports` its
     * `backend/src/modules/<id>/ports/index.ts` already holds and each reaching
     * the other's, exactly as the two files above reach each other today.
     */
    function mutualPair(): Record<string, string> {
      const files: Record<string, string> = { ...checkoutWith({}) };
      for (const [id, other, takes] of [
        ['orders', 'payments', 'PaymentPlacementApplyPort'],
        ['payments', 'orders', 'OrderPaymentStatusApplyPort'],
      ] as const) {
        const dir = `${ROOT}/packages/modules/${id}`;
        const publishes =
          id === 'orders' ? 'OrderPaymentStatusApplyPort' : 'PaymentPlacementApplyPort';
        Object.assign(
          files,
          packageFiles(id, {
            ...BACKEND_ONLY,
            'src/ports/index.ts': `export interface ${publishes} { apply(): void }\n`,
            'src/backend/reach.ts':
              `import type { ${takes} } from '@endora-commerce/mod-${other}/ports';\n` +
              `export type P = ${takes};\n`,
          }),
        );
        files[`${dir}/package.json`] = JSON.stringify({
          name: `@endora-commerce/mod-${id}`,
          description: 'A module package.',
          endora: { type: 'module', id },
          exports: {
            '.': { types: './dist/manifest.d.ts', default: './dist/manifest.js' },
            './backend': {
              types: './dist/backend/index.d.ts',
              default: './dist/backend/index.js',
            },
            './ports': {
              types: './dist/ports/index.d.ts',
              default: './dist/ports/index.js',
            },
            './package.json': './package.json',
          },
        });
        files[`${dir}/dist/ports/index.js`] = 'export {};\n';
        files[`${dir}/dist/backend/index.js`] =
          'export function registerModule(ctx) { void ctx; }\nexport const entities = [];\n';
      }
      return files;
    }

    it('refuses the pair, naming both packages and both clean exits', () => {
      let message = '';
      try {
        render(mutualPair());
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('@endora-commerce/mod-orders');
      expect(message).toContain('@endora-commerce/mod-payments');
      expect(message).toContain('would each devDepend on the other');
      // The two exits the tree already demonstrates. A refusal whose message
      // stops at "blocked" is a refusal that blocks the sweep.
      expect(message).toContain('publish the interface on ONE side only');
      expect(message).toContain('@endora-commerce/contracts');
    });

    /**
     * The message must not describe the two-sided failure as a race.
     *
     * !1047 measured the pair `returns` ↔ `credit_limits`, where **one**
     * direction carried a real reach: the other side compiled, emitted its
     * `dist/ports/index.d.ts`, and an immediate re-run of the consumer went
     * green — a scheduling-dependent red. Re-measured on this tree for the
     * shape this refusal was actually written against, `orders` ↔ `payments`,
     * where **both** directions carry one: every package build sets
     * `noEmitOnError: true`, so the side that loses the race emits nothing and
     * the side that would have won never gets the `.d.ts` it is waiting for.
     * Seven runs, seven reds, the same TS2307 every time — four cold and
     * concurrent, two warm, one cold at `--workspace-concurrency=1`. **There is
     * no build order**, which is why `build:packages` cannot be taught one and
     * why "just re-run it" is advice that cannot work here.
     *
     * The distinction is load-bearing for the author who reads this message: a
     * race invites a retry, and a deadlock does not.
     */
    it('says a two-sided pair has no build order, rather than calling it a race', () => {
      let message = '';
      try {
        render(mutualPair());
      } catch (error: unknown) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain('noEmitOnError');
      expect(message).toContain('no build order');
      expect(message).not.toContain('succeeds on a re-run');
    });

    it('renders the same pair when only one side reaches the other', () => {
      const files = mutualPair();
      delete files[`${ROOT}/packages/modules/payments/src/backend/reach.ts`];
      const orders = manifestOf(files, 'orders');
      const payments = manifestOf(files, 'payments');
      expect(orders['devDependencies']).toMatchObject({
        '@endora-commerce/mod-payments': 'workspace:*',
      });
      expect(payments['devDependencies']).not.toHaveProperty('@endora-commerce/mod-orders');
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
        // The package's own `@source` declarations, which a UI layer earns and
        // a backend-only package does not (`admin-stylesheet-composition.md`
        // R1.1). It is a plain path and not a conditions object: the file is
        // CSS, imported by a stylesheet rather than by a module resolver.
        './tailwind.css',
        './package.json',
      ]);
      expect((manifest['exports'] as Record<string, unknown>)['./tailwind.css']).toBe(
        './tailwind.css',
      );
      expect(manifest['files']).toContain('tailwind.css');
    });

    it('declares no source subpath for a package with no UI layer', () => {
      // Publishing one would name two directories that are not there, which
      // Tailwind skips in silence (M12) — a declaration a reader would take
      // for coverage.
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['exports']).not.toHaveProperty('./tailwind.css');
      expect(manifest['files']).not.toContain('tailwind.css');
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

  describe('the admin application declares the modules it composes (feature 091)', () => {
    /** The admin manifest this run reconciled, parsed. */
    function adminManifestOf(files: Record<string, string>): Record<string, unknown> {
      const run = render(files);
      const found = run.applicationRendered.find((entry) => entry.packageName === 'admin');
      expect(found, 'no admin manifest rendered').toBeDefined();
      return JSON.parse(found!.content) as Record<string, unknown>;
    }

    const WITH_ADMIN_LAYER = {
      ...BACKEND_ONLY,
      'src/admin/index.ts': "export const contributions = { routes: [] };\n",
    };

    it('adds a module that ships an admin layer, at its sorted position', () => {
      // The generated registry names it by bare specifier, and a bare specifier
      // resolves only through a declared dependency. Without this the module's
      // screens are registered and unresolvable.
      const deps = adminManifestOf(widgets(WITH_ADMIN_LAYER))['dependencies'] as Record<
        string,
        string
      >;
      expect(deps['@endora-commerce/mod-widgets']).toBe('workspace:*');
      expect(Object.keys(deps)).toEqual([
        '@endora-commerce/contracts',
        '@endora-commerce/mod-widgets',
        'lucide-react',
        'react',
      ]);
    });

    it('adds nothing for a module with no admin layer', () => {
      // R3 — the layer is optional and its absence is silent. A backend-only
      // module is not something the admin resolves.
      const deps = adminManifestOf(widgets(BACKEND_ONLY))['dependencies'] as Record<
        string,
        string
      >;
      expect(Object.keys(deps)).not.toContain('@endora-commerce/mod-widgets');
    });

    it('removes a module that has dropped its admin layer', () => {
      // The stale direction. A dependency on a package the registry no longer
      // names is an edge nothing declares and nothing removes.
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/admin/package.json`] = JSON.stringify({
        name: 'admin',
        dependencies: {
          '@endora-commerce/contracts': 'workspace:*',
          '@endora-commerce/mod-widgets': 'workspace:*',
          react: '^19.2.5',
        },
      });
      const deps = adminManifestOf(files)['dependencies'] as Record<string, string>;
      expect(Object.keys(deps)).not.toContain('@endora-commerce/mod-widgets');
    });

    it('leaves every other dependency, and its order, exactly where it was', () => {
      // The admin's React, Radix and Tailwind ranges are a human's, with
      // Constitution IV's justification behind them. This reconciliation owns
      // one thing and must be seen not to own the rest.
      const files = widgets(WITH_ADMIN_LAYER);
      files[`${ROOT}/admin/package.json`] = JSON.stringify(
        {
          name: 'admin',
          private: true,
          dependencies: { zod: '^4.2.0', '@endora-commerce/contracts': 'workspace:*' },
          devDependencies: { typescript: '^5.9.3' },
        },
        null,
        2,
      );
      const manifest = adminManifestOf(files);
      expect(Object.keys(manifest)).toEqual([
        'name',
        'private',
        'dependencies',
        'devDependencies',
      ]);
      expect(Object.keys(manifest['dependencies'] as object)).toEqual([
        '@endora-commerce/mod-widgets',
        'zod',
        '@endora-commerce/contracts',
      ]);
      expect(manifest['devDependencies']).toEqual({ typescript: '^5.9.3' });
    });

    it('removes an edge to a workspace member that has gone', () => {
      // The case the "is it one of ours" question above cannot answer, because
      // it is answered from the packages this run **found**: a module that has
      // been deleted, renamed or moved out of the globs is exactly the one it
      // cannot find. A `workspace:` range naming no current member is the
      // discriminator, and it is not a stranger's — a registry package carries
      // a semver range, never the workspace protocol.
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/admin/package.json`] = JSON.stringify({
        name: 'admin',
        dependencies: {
          '@endora-commerce/mod-departed': 'workspace:*',
          react: '^19.2.5',
        },
      });
      const deps = adminManifestOf(files)['dependencies'] as Record<string, string>;
      expect(Object.keys(deps)).not.toContain('@endora-commerce/mod-departed');
      expect(deps['react']).toBe('^19.2.5');
    });

    it('never touches a third-party package that merely looks like one of ours', () => {
      // Ours is answered from the identities this run derived, never from a
      // `mod-` prefix test: the prefix is a naming convention (§6), and a
      // stranger's package following it would be silently deleted.
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/admin/package.json`] = JSON.stringify({
        name: 'admin',
        dependencies: { '@endora-commerce/mod-widgets-theme': '^1.0.0', react: '^19.2.5' },
      });
      const deps = adminManifestOf(files)['dependencies'] as Record<string, string>;
      expect(deps['@endora-commerce/mod-widgets-theme']).toBe('^1.0.0');
    });

    it('is idempotent — a second render over its own output changes nothing', () => {
      const files = widgets(WITH_ADMIN_LAYER);
      const first = render(files).applicationRendered[0]!;
      files[first.outputPath] = first.content;
      expect(render(files).applicationRendered[0]!.content).toBe(first.content);
    });

    it('refuses an admin application with no dependencies block', () => {
      const files = widgets(WITH_ADMIN_LAYER);
      files[`${ROOT}/admin/package.json`] = JSON.stringify({ name: 'admin' });
      expect(() => render(files)).toThrow(/dependencies/);
    });

    it('refuses a checkout where no member declares the admin source alias', () => {
      // Zero or two is a refusal rather than a walk narrowed to whichever
      // sorted first — `lib/admin-surfaces.ts`' rule, applied here because this
      // reconciliation has to know which manifest it is reconciling.
      const files = widgets(WITH_ADMIN_LAYER);
      delete files[`${ROOT}/admin/tsconfig.json`];
      expect(() => render(files)).toThrow(/@\/\*/);
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

    /**
     * The subject used to be `peerDependenciesMeta`, which FR-022 now
     * generates. `keywords` replaces it because it has the property the example
     * needs and the old one has lost: it is a real npm field a hand would
     * plausibly add, and it is on neither list — so the refusal is proven over
     * a field that is genuinely unclaimed rather than over one whose absence
     * from `GENERATED_FIELDS` was itself the thing under repair.
     */
    it('refuses a field it neither generates nor preserves', () => {
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/package.json`;
      files[path] = JSON.stringify({
        ...(JSON.parse(files[path]!) as object),
        keywords: ['commerce'],
      });
      expect(() => render(files)).toThrow(/keywords/);
    });
  });

  /**
   * The version is the **release process's** field, and this generator's job
   * is to leave it alone (D-210).
   *
   * It was the constant `'0.0.0'` until the first release set 79 manifests to
   * `0.7.0` by hand, whereupon regenerating wanted to undo all 70 module
   * packages and `manifests:check` went red on `master`. That is not a bug in
   * the number chosen: a version is not derivable from a layer inventory at
   * all, so any constant here is a release decision this file is in no
   * position to take, and the next release would falsify a new constant
   * exactly as it falsified `0.0.0`.
   *
   * So it is preserved when the package has one, and seeded from the platform
   * host's own version when it does not — the same
   * preserved-or-seeded shape `description` has, for the same reason.
   */
  describe('the version belongs to the release process', () => {
    it('preserves a version the release process already set', () => {
      // Deliberately not the platform's, so the assertion discriminates
      // between "it kept what was there" and "it wrote the seed, which happens
      // to match".
      const files = widgets(BACKEND_ONLY);
      const path = `${ROOT}/packages/modules/widgets/package.json`;
      files[path] = JSON.stringify({
        ...(JSON.parse(files[path]!) as object),
        version: '1.4.2',
      });
      expect(manifestOf(files)['version']).toBe('1.4.2');
    });

    it("seeds a package that has no manifest yet from the platform's version", () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      expect(manifestOf(files)['version']).toBe(PLATFORM_VERSION);
    });

    it('needs no platform at all while every package carries its own version', () => {
      // The refusals below are asked at the point of need, never at the top of
      // the run: a checkout whose packages are all versioned has no question
      // for the platform, so an unanswerable one cannot fail it. The member
      // stays in the workspace — deleting the manifest would make
      // `@endora-commerce/platform` a third-party peer with no declared range,
      // which is a different refusal and would prove nothing about this one.
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/packages/platform/package.json`] = JSON.stringify({
        name: '@endora-commerce/platform',
      });
      expect(manifestOf(files)['version']).toBe(PLATFORM_VERSION);
    });

    it('refuses to seed when no member declares itself the platform', () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      files[`${ROOT}/packages/platform/package.json`] = JSON.stringify({
        name: '@endora-commerce/platform',
        version: PLATFORM_VERSION,
      });
      expect(() => render(files)).toThrow(/no workspace member declares/);
    });

    it('refuses to seed when the platform declares no version', () => {
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      files[`${ROOT}/packages/platform/package.json`] = JSON.stringify({
        name: '@endora-commerce/platform',
        endora: { type: 'platform' },
      });
      expect(() => render(files)).toThrow(/declares no `version`/);
    });

    it('refuses a checkout where two members declare themselves the platform', () => {
      // Zero or two is a refusal rather than a walk narrowed to whichever
      // sorted first — `lib/platform-root.ts`' rule, and this generator asks
      // it through that same function rather than re-deriving the block.
      const files = widgets(BACKEND_ONLY);
      delete files[`${ROOT}/packages/modules/widgets/package.json`];
      files[`${ROOT}/packages/contracts/package.json`] = JSON.stringify({
        name: '@endora-commerce/contracts',
        version: '9.9.9',
        endora: { type: 'platform' },
      });
      expect(() => render(files)).toThrow(/declare/);
    });
  });

  describe('the constant half', () => {
    /**
     * R6's `private` half is gone (D-208, the owner's publication ruling of
     * 2026-09-05): every module package publishes, so the field is **absent**
     * rather than `false`. Absent is npm's own default, and `false` would be
     * the same fact stated twice — `check:release-intent`'s
     * `unpublished-package` reads the field and a written `false` says nothing
     * it does not already read from its absence.
     */
    it('is ESM, side-effect free and no longer private (R6, D-208)', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['private']).toBeUndefined();
      expect(manifest['type']).toBe('module');
      expect(manifest['sideEffects']).toBe(false);
    });

    /**
     * The two fields a published package owes a consumer and a private one does
     * not (`check:release-intent`'s `incomplete-public-package`), and both are
     * derived rather than written into the generator: the `url` is the
     * workspace root's — one repository, one URL, so the remote moving does not
     * leave 70 manifests pointing at nothing — and the `directory` is where the
     * package actually sits, so a package that moves a directory does not need
     * anybody to remember.
     */
    it('declares `repository` and `publishConfig.access`, both derived', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['repository']).toEqual({
        type: 'git',
        url: 'git+https://example.invalid/fx.git',
        directory: 'packages/modules/widgets',
      });
      expect(manifest['publishConfig']).toEqual({ access: 'public' });
    });

    /**
     * And the refusal at the point of need, like the Node engine's: a workspace
     * root with no `repository` has no source for the field. Inventing one
     * publishes 70 links to somebody else's repository, which is worse than not
     * rendering — a consumer following it would arrive somewhere plausible.
     */
    it('refuses a workspace root that declares no `repository.url`', () => {
      const files = widgets(BACKEND_ONLY);
      files[`${ROOT}/package.json`] = JSON.stringify({
        name: 'root',
        engines: { node: '>=22.17.0' },
      });
      expect(() => render(files)).toThrow(/declares no repository\.url/);
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
          // A test file with no configuration is refused since feature 089's
          // Phase 1, so a fixture that ships one ships the runner too.
          [`${ROOT}/packages/modules/widgets/vitest.config.ts`]: 'export default {};\n',
        }),
      );
      expect((withTests['scripts'] as Record<string, string>)['lint']).toBe('eslint src test');
    });
  });

  /**
   * A test file nothing runs (feature 089, Phase 1).
   *
   * `specs/deferred-defects.md` recorded the state this closes: four packaged
   * modules carried fifteen co-located test files, no runner collected them, no
   * job reported them and no total counted them. They were not failing — as far
   * as the pipeline was concerned they did not exist, which in review reads as
   * coverage. The two halves below are the whole repair: an *undeclared* run is
   * refused here, and a *declared* one is made honest by the script it emits.
   */
  describe('a test file has a runner', () => {
    const VITEST_CONFIG = 'export default {};\n';

    it('refuses a co-located test file when the package declares no vitest config', () => {
      const tree = (): Record<string, string> =>
        widgets({
          ...BACKEND_ONLY,
          'src/backend/services/thing.service.test.ts': "import { it } from 'vitest';\n",
        });
      expect(() => manifestOf(tree())).toThrow(ModulePackageManifestError);
      expect(() => manifestOf(tree())).toThrow(/src\/backend\/services\/thing\.service\.test\.ts/);
      expect(() => manifestOf(tree())).toThrow(/vitest\.config\.ts/);
    });

    it('refuses one under test/ too — the layout contract puts them there', () => {
      const tree = (): Record<string, string> =>
        widgets(BACKEND_ONLY, {
          [`${ROOT}/packages/modules/widgets/test/unit/thing.test.ts`]:
            "import { it } from 'vitest';\n",
        });
      expect(() => manifestOf(tree())).toThrow(ModulePackageManifestError);
      expect(() => manifestOf(tree())).toThrow(/test\/unit\/thing\.test\.ts/);
    });

    it('emits a bare `vitest run` for a package that declares one', () => {
      // Never `--passWithNoTests`: measured on vitest 2.1.9, bare `run` exits 1
      // on "No test files found" and the flag turns that into 0 — which is the
      // same "green means not looking" this refusal exists to stop, one layer up.
      const manifest = manifestOf(
        widgets(
          {
            ...BACKEND_ONLY,
            'src/backend/services/thing.service.test.ts': "import { it } from 'vitest';\n",
          },
          { [`${ROOT}/packages/modules/widgets/vitest.config.ts`]: VITEST_CONFIG },
        ),
      );
      expect((manifest['scripts'] as Record<string, string>)['test']).toBe('vitest run');
    });

    it('declares the runner that script names, for a package whose tests are under test/', () => {
      // The half the co-located four hid. Their `vitest` devDependency arrives
      // through the specifier walk, which reads the test's own
      // `import … from 'vitest'` — and that walk enters `src/` only. A package
      // that puts its tests in `test/`, which is where the layout contract puts
      // them, therefore got a `test` script naming a runner nothing installs:
      // measured on a scaffolded package, `pnpm run test` answered
      // `vitest: command not found`.
      const manifest = manifestOf(
        widgets(BACKEND_ONLY, {
          [`${ROOT}/packages/modules/widgets/test/unit/thing.test.ts`]:
            "import { it } from 'vitest';\n",
          [`${ROOT}/packages/modules/widgets/vitest.config.ts`]: VITEST_CONFIG,
        }),
      );
      expect((manifest['devDependencies'] as Record<string, string>)['vitest']).toBe('^2.1.4');
      // A devDependency and not a peer: a consumer never runs this package's
      // tests, and the emit excludes them, so nothing published names it.
      expect(manifest['peerDependencies']).not.toHaveProperty('vitest');
    });

    it('names no runner for a package that declares no configuration', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect(manifest['devDependencies']).not.toHaveProperty('vitest');
    });

    it('emits no test script for a package that ships neither', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect((manifest['scripts'] as Record<string, string>)['test']).toBeUndefined();
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

  describe('the build script comes from what is on disk beside the sources', () => {
    // Criterion 8. `tsc` copies nothing but `.ts` (measured over a `src/`
    // holding `a.ts`, `data/t.txt`, `data/t.json` and `data/t.md`: it emits
    // `dist/a.js` and nothing else), so a package whose module opens a file at
    // runtime needs a second build step. **Whether it has one is derived**, and
    // that is the whole point: an asset rule an author has to remember is a
    // rule an author forgets, and this one fails silently — every reader
    // downstream is handed a directory and asked what is in it, for which "the
    // build dropped it" and "this module ships none" are the same input.

    it('adds the asset copier when src/ holds a runtime asset', () => {
      const manifest = manifestOf(
        widgets({
          ...BACKEND_ONLY,
          'src/backend/data/taxonomies/en.txt': 'a > b\n',
        }),
      );
      expect((manifest['scripts'] as Record<string, string>)['build']).toBe(
        'tsc -p tsconfig.build.json && node ../../../scripts/copy-package-assets.mjs ' +
          '--src src --out dist',
      );
    });

    it('leaves the bare compile alone when it holds none', () => {
      const manifest = manifestOf(widgets(BACKEND_ONLY));
      expect((manifest['scripts'] as Record<string, string>)['build']).toBe(
        'tsc -p tsconfig.build.json',
      );
    });

    it('does not count a file kind nothing opens at runtime', () => {
      // `PROVENANCE.md` sits beside `product_feeds`' taxonomy files and is
      // documentation; a package holding only that ships no asset.
      const manifest = manifestOf(
        widgets({ ...BACKEND_ONLY, 'src/backend/data/PROVENANCE.md': '# where these came from' }),
      );
      expect((manifest['scripts'] as Record<string, string>)['build']).toBe(
        'tsc -p tsconfig.build.json',
      );
    });

    it('refuses an extension nobody has ruled on, rather than dropping it', () => {
      const tree = (): Record<string, string> =>
        widgets({ ...BACKEND_ONLY, 'src/backend/templates/invoice.hbs': '{{x}}' });
      expect(() => manifestOf(tree())).toThrow(ModulePackageManifestError);
      expect(() => manifestOf(tree())).toThrow(/invoice\.hbs/);
    });

    it('names the emit layout the package declares, never a written-down dist', () => {
      const files = widgets({ ...BACKEND_ONLY, 'src/backend/data/en.txt': 'x\n' });
      files[`${ROOT}/packages/modules/widgets/tsconfig.build.json`] = JSON.stringify({
        compilerOptions: { rootDir: 'lib', outDir: 'build' },
      });
      // The layer inventory still walks `src/`, which is where the layout
      // contract puts the sources; `--src`/`--out` are the *emit* declaration,
      // and a package that emits elsewhere gets its own answer.
      expect((manifestOf(files)['scripts'] as Record<string, string>)['build']).toContain(
        '--src lib --out build',
      );
    });

    it('counts the package’s own depth, so the copier path resolves from where it is', () => {
      // `packages/*` is a workspace glob too, and a member one directory
      // shallower needs one `..` fewer. A depth written down would give it a
      // build script pointing at nothing.
      const files = checkoutWith(packageFiles('gadgets', { ...BACKEND_ONLY }, {}));
      const shallow: Record<string, string> = {};
      for (const [path, text] of Object.entries(files)) {
        shallow[path.replace('/packages/modules/gadgets/', '/packages/gadgets/')] = text;
      }
      shallow[`${ROOT}/packages/gadgets/src/backend/data/en.txt`] = 'x\n';
      expect(
        (manifestOf(shallow, 'gadgets')['scripts'] as Record<string, string>)['build'],
      ).toContain('node ../../scripts/copy-package-assets.mjs');
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
      expect([...names.keys()].sort()).toEqual(['bullmq', 'fastify', 'ioredis', 'zod']);
    });

    it('keeps the subpath and the import kind of every reach (D-171)', () => {
      // Both facts are what R4's narrowing turns on, and both were discarded one
      // line before the refusal saw them.
      const names = peerNamesOf(
        new Map([
          [
            'a.ts',
            "import type { A } from '@endora-commerce/mod-gadgets/ports';\n" +
              "import { B } from '@endora-commerce/mod-gadgets';\n",
          ],
        ]),
      );
      expect(names.get('@endora-commerce/mod-gadgets')).toEqual([
        { subpath: 'ports', kind: 'type-only-import', file: 'a.ts', line: 1 },
        { subpath: '', kind: 'value-import', file: 'a.ts', line: 2 },
      ]);
    });
  });
});
