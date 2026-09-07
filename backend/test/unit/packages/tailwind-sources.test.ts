import { describe, expect, it } from 'vitest';

import {
  renderTailwindStylesheet,
  scannableLayersOf,
  tailwindScannablePackages,
  TailwindSourceError,
  TAILWIND_SOURCE_SUBPATH,
} from '../../../scripts/lib/tailwind-sources.js';
import type { WorkspaceFs, WorkspaceMember } from '../../../scripts/lib/workspace-packages.js';

/**
 * Which packages ship scannable UI, and what their own `./tailwind.css` says
 * (`specs/110-instance-repository/contracts/admin-stylesheet-composition.md`
 * R1; FR-023).
 *
 * ## What is being protected
 *
 * Every failure in this area is silent. Tailwind skips an `@source` naming a
 * directory that is not there and says nothing (§1, M12), so a wrong emitted
 * directory, a package left out of the population, or a family member whose
 * `src` was mapped to `dist/src` all produce a stylesheet that compiles green
 * and drops every utility the package declares. Nothing in a type-check, a lint
 * or a build observes it.
 *
 * So the derivation is driven here on synthetic checkouts that enter at the top
 * of the analysis (issue #130): a `pnpm-workspace.yaml`, manifests and a build
 * configuration, never a pre-computed layer list. The one thing a fixture may
 * not do is hand in the answer this file exists to check.
 */

/** An in-memory checkout — the top of the analysis, with nothing precomputed. */
function fixtureFs(files: Readonly<Record<string, string>>): WorkspaceFs & {
  listFiles: (path: string) => readonly string[];
} {
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
const BUILD_CONFIG = JSON.stringify({ compilerOptions: { rootDir: 'src', outDir: 'dist' } });

/** A workspace member as `workspaceMembers` produces one. */
function member(
  dir: string,
  name: string,
  manifest: Record<string, unknown> = {},
): WorkspaceMember {
  return { dir, name, manifest: { name, ...manifest } };
}

describe('scannableLayersOf', () => {
  it('gives a module package the two lines of each UI layer it ships', () => {
    // R1.2 — the same layer inventory that decides whether the package declares
    // `./admin`. `dist` is what a published tarball carries and is what an
    // instance scans; `src` is inert there and is what keeps `admin run dev`
    // reading source here.
    const fs = fixtureFs({
      [`${ROOT}/packages/modules/blog/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/modules/blog/src/admin/index.ts`]: '',
      [`${ROOT}/packages/modules/blog/src/backend/index.ts`]: '',
    });
    const blog = member(`${ROOT}/packages/modules/blog`, '@endora-commerce/mod-blog', {
      endora: { type: 'module', id: 'blog' },
    });
    expect(scannableLayersOf(blog, fs, fs.listFiles)).toEqual([
      { emitted: 'dist/admin', source: 'src/admin' },
    ]);
  });

  it('names both UI layers when a module ships a published component beside its screens', () => {
    // Z9's `src/admin-ui/` is a sibling of `src/admin/`, and a package that
    // ships both asks for both to be scanned: a component published to another
    // module renders in the same admin, against the same tokens.
    const fs = fixtureFs({
      [`${ROOT}/packages/modules/cms/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/modules/cms/src/admin/index.ts`]: '',
      [`${ROOT}/packages/modules/cms/src/admin-ui/index.ts`]: '',
    });
    const cms = member(`${ROOT}/packages/modules/cms`, '@endora-commerce/mod-cms', {
      endora: { type: 'module', id: 'cms' },
    });
    expect(scannableLayersOf(cms, fs, fs.listFiles).map((layer) => layer.source)).toEqual([
      'src/admin',
      'src/admin-ui',
    ]);
  });

  it('says nothing about a module package that ships no UI layer', () => {
    // R1.1's population is *scannable UI*, and a backend-only module has none.
    // Declaring a stylesheet for it would publish a subpath naming two
    // directories that are not there — two silent `@source` skips a reader
    // would take for coverage.
    const fs = fixtureFs({
      [`${ROOT}/packages/modules/webhooks/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/modules/webhooks/src/backend/index.ts`]: '',
    });
    const webhooks = member(`${ROOT}/packages/modules/webhooks`, '@endora-commerce/mod-webhooks', {
      endora: { type: 'module', id: 'webhooks' },
    });
    expect(scannableLayersOf(webhooks, fs, fs.listFiles)).toEqual([]);
  });

  it('maps a family package whose whole build is UI to its emit root, not to dist/src', () => {
    // R1.3, and the mapping is the half that fails silently. `tsc` emits
    // `rootDir/x` at `outDir/x`, so the *root itself* is `outDir` — writing
    // `dist/src` names a directory that is not there, which Tailwind skips
    // without a word (M12) and which would drop the whole shell's CSS.
    const fs = fixtureFs({
      [`${ROOT}/packages/admin-shell/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/admin-shell/src/App.tsx`]: '',
    });
    const shell = member(`${ROOT}/packages/admin-shell`, '@endora-commerce/admin-shell');
    expect(scannableLayersOf(shell, fs, fs.listFiles)).toEqual([
      { emitted: 'dist', source: 'src' },
    ]);
  });

  it('finds a family package whose components are nested below src', () => {
    // The walk is recursive because a package's components are not at its
    // source root — `page-builder-core` keeps them under `src/editor/`. A
    // shallow probe would report it as shipping no UI and drop its utilities.
    const fs = fixtureFs({
      [`${ROOT}/packages/page-builder-core/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/page-builder-core/src/index.ts`]: '',
      [`${ROOT}/packages/page-builder-core/src/editor/preview.tsx`]: '',
    });
    const core = member(`${ROOT}/packages/page-builder-core`, '@endora-commerce/page-builder-core');
    expect(scannableLayersOf(core, fs, fs.listFiles)).toEqual([
      { emitted: 'dist', source: 'src' },
    ]);
  });

  it('says nothing about a family package that ships no component at all', () => {
    const fs = fixtureFs({
      [`${ROOT}/packages/contracts/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/contracts/src/index.ts`]: '',
    });
    const contracts = member(`${ROOT}/packages/contracts`, '@endora-commerce/contracts');
    expect(scannableLayersOf(contracts, fs, fs.listFiles)).toEqual([]);
  });

  it('excludes a package that publishes a finished stylesheet, whatever it ships', () => {
    // R4.2/R4.4 — and the exclusion is derived from the subpath the package
    // **declares**, never from its name (D-100). A package whose CSS the host
    // imports as bytes must not also be scanned: R4.4 measures three unprefixed
    // utilities reaching the admin bundle from a component whose every class
    // carries a prefix.
    const fs = fixtureFs({
      [`${ROOT}/packages/cms-components/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/cms-components/src/blocks/text.tsx`]: '',
    });
    const cms = member(`${ROOT}/packages/cms-components`, '@endora-commerce/cms-components', {
      exports: { './styles.css': './dist/cms-components.css' },
    });
    expect(scannableLayersOf(cms, fs, fs.listFiles)).toEqual([]);
  });

  it('refuses a UI package that declares no build layout rather than guessing dist', () => {
    // §4(b): naming a package's build directory from outside it is the shape
    // this contract rejects, because a package that renames it then breaks its
    // host's stylesheet silently. The emitted half comes off the package's own
    // `tsconfig.build.json` or the derivation stops.
    const fs = fixtureFs({ [`${ROOT}/packages/admin-kit/src/ui/button.tsx`]: '' });
    const kit = member(`${ROOT}/packages/admin-kit`, '@endora-commerce/admin-kit');
    expect(() => scannableLayersOf(kit, fs, fs.listFiles)).toThrow(TailwindSourceError);
  });
});

describe('tailwindScannablePackages', () => {
  const checkout = {
    [`${ROOT}/pnpm-workspace.yaml`]:
      'packages:\n  - admin\n  - packages/*\n  - packages/modules/*\n',
    // An application: a literal workspace entry, so it is not family. Its own
    // sources are covered by Tailwind's automatic detection, rooted at the
    // project it builds (R2.3), and it publishes nothing an `exports` entry
    // could serve.
    [`${ROOT}/admin/package.json`]: JSON.stringify({ name: 'admin' }),
    [`${ROOT}/admin/src/main.tsx`]: '',
    [`${ROOT}/packages/admin-shell/package.json`]: JSON.stringify({
      name: '@endora-commerce/admin-shell',
    }),
    [`${ROOT}/packages/admin-shell/tsconfig.build.json`]: BUILD_CONFIG,
    [`${ROOT}/packages/admin-shell/src/App.tsx`]: '',
    [`${ROOT}/packages/modules/blog/package.json`]: JSON.stringify({
      name: '@endora-commerce/mod-blog',
      endora: { type: 'module', id: 'blog' },
    }),
    [`${ROOT}/packages/modules/blog/tsconfig.build.json`]: BUILD_CONFIG,
    [`${ROOT}/packages/modules/blog/src/admin/index.ts`]: '',
  };

  it('holds the family members that ship UI and never an application', () => {
    const fs = fixtureFs(checkout);
    const found = tailwindScannablePackages(ROOT, fs, fs.listFiles);
    expect(found.map((pkg) => pkg.name)).toEqual([
      '@endora-commerce/admin-shell',
      '@endora-commerce/mod-blog',
    ]);
  });

  it('sorts by package name, which is the order the artefact and the guard take', () => {
    // R2.1's order. Two readers render from this list, so a sort that followed
    // the workspace globs would reorder the generated stylesheet whenever a
    // package moved between them.
    const fs = fixtureFs({
      ...checkout,
      [`${ROOT}/packages/modules/analytics/package.json`]: JSON.stringify({
        name: '@endora-commerce/mod-analytics',
        endora: { type: 'module', id: 'analytics' },
      }),
      [`${ROOT}/packages/modules/analytics/tsconfig.build.json`]: BUILD_CONFIG,
      [`${ROOT}/packages/modules/analytics/src/admin/index.ts`]: '',
    });
    expect(tailwindScannablePackages(ROOT, fs, fs.listFiles).map((pkg) => pkg.name)).toEqual([
      '@endora-commerce/admin-shell',
      '@endora-commerce/mod-analytics',
      '@endora-commerce/mod-blog',
    ]);
  });
});

describe('renderTailwindStylesheet', () => {
  it('writes the emitted directory first and the source directory second', () => {
    // R1.2's shape, verbatim. Order between the two is not load-bearing for
    // Tailwind — `@source` order is irrelevant (R3.3) — but the rendering is
    // byte-compared by `manifests:check`, so it is fixed here rather than left
    // to whichever the derivation happened to produce.
    const css = renderTailwindStylesheet({
      name: '@endora-commerce/mod-blog',
      dir: `${ROOT}/packages/modules/blog`,
      isModule: true,
      layers: [{ emitted: 'dist/admin', source: 'src/admin' }],
    });
    expect(css.split('\n').filter((line) => line.startsWith('@source'))).toEqual([
      '@source "./dist/admin";',
      '@source "./src/admin";',
    ]);
    expect(css.endsWith('\n')).toBe(true);
  });

  it('declares nothing but sources, and names the package it belongs to', () => {
    // R1.1 — "`@source` directives and nothing else". A rule, an `@import` or
    // an `@theme` here would put the package's CSS into the host's cascade,
    // which is R4.2's file and a different kind of stylesheet (R3.3).
    const css = renderTailwindStylesheet({
      name: '@endora-commerce/admin-shell',
      dir: `${ROOT}/packages/admin-shell`,
      isModule: false,
      layers: [{ emitted: 'dist', source: 'src' }],
    });
    const statements = css
      .split('\n')
      .filter((line) => line.trim().length > 0 && !line.trim().startsWith('*') && !line.startsWith('/*'));
    expect(statements).toEqual(['@source "./dist";', '@source "./src";']);
    expect(css).toContain('@endora-commerce/admin-shell');
  });
});

describe('the subpath', () => {
  it('is the one R1.1 names, because a consumer imports it by that literal', () => {
    // The instance's generated artefact writes `@import "<pkg>/tailwind.css"`,
    // so this constant is contract with every published package: renaming it
    // is `ERR_PACKAGE_PATH_NOT_EXPORTED` in every client that installed one.
    expect(TAILWIND_SOURCE_SUBPATH).toBe('./tailwind.css');
  });
});
