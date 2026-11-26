import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertOverlayLayout, OverlayLayoutError } from './overlay-layout.js';
import { overlayModuleIdsUnder } from './overlay-runtime.js';

/**
 * `specs/190-overlay-full-modules/` T010 (FR-002, FR-003, contract
 * `overlay-module-layout.md` §1): an overlay module is flat under `modules/` and
 * is not a package. Each fixture is a directory on disk, read by the same walk
 * the loader runs.
 */

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-layout-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  }
  return root;
}

function refusal(root: string, ids: readonly string[]): OverlayLayoutError {
  try {
    assertOverlayLayout(root, ids);
  } catch (error) {
    if (error instanceof OverlayLayoutError) return error;
    throw error;
  }
  throw new Error('assertOverlayLayout accepted the tree');
}

describe('assertOverlayLayout', () => {
  it('accepts flat modules with their fixed and conventional files', () => {
    const root = tree({
      'acme_loyalty/manifest.ts': '',
      'acme_loyalty/backend.ts': '',
      'acme_loyalty/ports.ts': '',
      'acme_loyalty/i18n/en.json': '{}',
      'acme_loyalty/migrations/20261125T000000_init.ts': '',
      'acme_loyalty/entities/loyalty-account.entity.ts': '',
      'acme_loyalty/admin/index.tsx': '',
      'acme_loyalty_reports/manifest.js': '',
    });
    expect(() => assertOverlayLayout(root, ['acme_loyalty', 'acme_loyalty_reports'])).not.toThrow();
  });

  it('refuses a manifest below a module root as nested-module, naming the file and the remedy', () => {
    const root = tree({
      'acme_loyalty/manifest.ts': '',
      'acme_loyalty/reports/manifest.ts': '',
      'acme_loyalty/deep/er/manifest.js': '',
    });
    const error = refusal(root, ['acme_loyalty']);
    expect(error.findings).toEqual([
      { kind: 'nested-module', file: join(root, 'acme_loyalty/deep/er/manifest.js') },
      { kind: 'nested-module', file: join(root, 'acme_loyalty/reports/manifest.ts') },
    ]);
    expect(error.message).toContain('make it a sibling module and declare the dependency');
  });

  it('refuses a package.json, a tsconfig or a build/test configuration as package-in-disguise', () => {
    const root = tree({
      'acme_loyalty/manifest.ts': '',
      'acme_loyalty/package.json': '{ "exports": { ".": "./backend.js" } }',
      'acme_loyalty/tsconfig.build.json': '{}',
      'acme_loyalty/admin/vite.config.ts': '',
      'acme_loyalty/vitest.config.mts': '',
      'acme_loyalty/tsup.config.js': '',
    });
    const error = refusal(root, ['acme_loyalty']);
    expect(error.findings.map((finding) => finding.kind)).toEqual(
      Array(5).fill('package-in-disguise'),
    );
    expect(error.findings.map((finding) => finding.file)).toEqual(
      [
        'acme_loyalty/admin/vite.config.ts',
        'acme_loyalty/package.json',
        'acme_loyalty/tsconfig.build.json',
        'acme_loyalty/tsup.config.js',
        'acme_loyalty/vitest.config.mts',
      ].map((file) => join(root, file)),
    );
    expect(error.message).toContain('backend/tsconfig.apps.json');
  });

  it('reads only the modules it is handed, and skips node_modules and dist', () => {
    const root = tree({
      'acme_loyalty/manifest.ts': '',
      'acme_loyalty/node_modules/x/package.json': '{}',
      'acme_loyalty/dist/manifest.js': '',
      'not_listed/package.json': '{}',
    });
    expect(() => assertOverlayLayout(root, ['acme_loyalty'])).not.toThrow();
  });
});

describe('overlay resolution refuses the layout (T011)', () => {
  it('overlayModuleIdsUnder throws OverlayLayoutError before anything is imported', () => {
    const root = tree({
      'acme_loyalty/manifest.ts': 'throw new Error("imported")',
      'acme_loyalty/package.json': '{}',
    });
    expect(() => overlayModuleIdsUnder(root, [])).toThrow(OverlayLayoutError);
  });

  it('lists a well-formed tree as before', () => {
    const root = tree({ 'acme_loyalty/manifest.ts': '', 'acme_loyalty/backend.ts': '' });
    expect(overlayModuleIdsUnder(root, [])).toEqual(['acme_loyalty']);
  });
});
