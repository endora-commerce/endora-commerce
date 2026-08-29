import { describe, expect, it } from 'vitest';

import {
  collectAdminContributions,
  emitAdminRegistry,
} from '../../../scripts/generate-composer.js';
import { ModulePackageError, type ModulePackage } from '../../../scripts/lib/module-packages.js';

/**
 * The fifth generated artefact (feature 091,
 * `specs/091-module-owned-admin-surfaces/contracts/admin-registry.md`).
 *
 * Its three `backend/src` siblings plus the manifest index come out of one
 * command, and every one of them fails the same way when it is wrong: silently.
 * A module missing from this one contributes no route and no sidebar entry, and
 * the admin renders exactly as it did before — which is indistinguishable from
 * a module that ships no screens.
 *
 * So the collector takes the package list rather than reading the disk, and
 * every way it can be wrong is driven here on input this repository does not
 * contain (issue #130: the fixture enters at the top of the analysis).
 */

/** A module package as `discoverModulePackages` produces one. */
function pkg(overrides: Partial<ModulePackage> & Pick<ModulePackage, 'moduleId'>): ModulePackage {
  return {
    name: `@endora-commerce/mod-${overrides.moduleId.replace(/_/g, '-')}`,
    dir: `/repo/packages/modules/${overrides.moduleId}`,
    exports: new Map([
      ['.', './dist/manifest.js'],
      ['./backend', './dist/backend/index.js'],
      ['./admin', './dist/admin/index.js'],
    ]),
    emit: { rootDir: 'src', outDir: 'dist' },
    ...overrides,
  };
}

const shipsAdmin = (packages: readonly ModulePackage[]) => (path: string): boolean =>
  packages.some((entry) => path === `${entry.dir}/src/admin/index.ts`);

describe('collectAdminContributions', () => {
  it('names a contributing package by the bare specifier its own exports map declares', () => {
    // D-149: never a relative reach into `packages/modules/<id>/src/`, which
    // would evaluate the package's source beside its `dist` — the duplicated
    // module instance `check:singleton-identity` refuses on the backend, in a
    // frontend where nothing would see it.
    const packages = [pkg({ moduleId: 'import_export' })];
    expect(collectAdminContributions(packages, shipsAdmin(packages))).toEqual([
      { moduleId: 'import_export', specifier: '@endora-commerce/mod-import-export/admin' },
    ]);
  });

  it('skips a module that ships no admin layer, and says nothing about it', () => {
    // R3 — the layer is optional and its absence is silent. A module with no
    // `src/admin/` behaves exactly as it did before this feature.
    const packages = [pkg({ moduleId: 'blog' }), pkg({ moduleId: 'import_export' })];
    const only = (path: string): boolean =>
      path === '/repo/packages/modules/import_export/src/admin/index.ts';
    expect(collectAdminContributions(packages, only).map((entry) => entry.moduleId)).toEqual([
      'import_export',
    ]);
  });

  it('refuses a module whose exports map does not cover the layer, rather than dropping it', () => {
    // R4. A skip is how a whole layer goes missing without a word — the same
    // reason a packaged migration covered by no declared subpath is refused.
    // The manifest generator renders `./admin` from the same inventory, so this
    // state means the two artefacts were committed apart.
    const packages = [
      pkg({
        moduleId: 'import_export',
        exports: new Map([
          ['.', './dist/manifest.js'],
          ['./backend', './dist/backend/index.js'],
        ]),
      }),
    ];
    expect(() => collectAdminContributions(packages, shipsAdmin(packages))).toThrow(
      ModulePackageError,
    );
  });

  it('orders by module id, so the artefact is a function of the tree', () => {
    const packages = [
      pkg({ moduleId: 'webhooks' }),
      pkg({ moduleId: 'analytics' }),
      pkg({ moduleId: 'import_export' }),
    ];
    expect(
      collectAdminContributions(packages, shipsAdmin(packages)).map((entry) => entry.moduleId),
    ).toEqual(['analytics', 'import_export', 'webhooks']);
  });
});

describe('emitAdminRegistry', () => {
  it('emits one bare import and one entry per contributing module', () => {
    const content = emitAdminRegistry([
      { moduleId: 'analytics', specifier: '@endora-commerce/mod-analytics/admin' },
      { moduleId: 'import_export', specifier: '@endora-commerce/mod-import-export/admin' },
    ]);
    expect(content).toContain(
      "import { contributions as contributions0 } from '@endora-commerce/mod-analytics/admin';",
    );
    expect(content).toContain(
      "import { contributions as contributions1 } from '@endora-commerce/mod-import-export/admin';",
    );
    expect(content).toContain("{ moduleId: 'analytics', contributions: contributions0 },");
    expect(content).toContain("{ moduleId: 'import_export', contributions: contributions1 },");
  });

  it('carries the do-not-edit header every generated artefact carries', () => {
    // The artefact is committed, so the only thing standing between a hand-edit
    // and `master` is `overlay:check` — and the header is what tells the author
    // that before they reach it.
    expect(emitAdminRegistry([])).toContain('AUTO-GENERATED');
    expect(emitAdminRegistry([])).toContain('composer:generate');
  });

  it('renders the same bytes for the same input, twice', () => {
    const entries = [
      { moduleId: 'import_export', specifier: '@endora-commerce/mod-import-export/admin' },
    ];
    expect(emitAdminRegistry(entries)).toBe(emitAdminRegistry(entries));
  });
});
