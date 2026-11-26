/**
 * The palette-coverage analysis and its overlay readers (`specs/190-overlay-full-modules/`
 * T046, FR-085; `contracts/overlay-admin-layer.md` §4).
 *
 * The rule itself is proved where it has always been, in
 * `admin/test/unit/palette-coverage.test.ts`, whose red proofs now enter this
 * module. What is proved here is what an instance adds: an overlay module's
 * admin layer and manifest are **read from source** — an `index.tsx` is JSX no
 * Node process can import — and a declaration the reader cannot evaluate is a
 * finding, never a silent pass.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  deploymentPaletteCoverage,
  describeFinding,
  readOverlayAdminSurface,
  readOverlayManifestActions,
} from './palette-coverage.js';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

const LAYER = `import type { AdminContributions } from '@acme/admin-kit/contributions';

const ROUTE_PATH = '/acme-board';

export const contributions: AdminContributions = {
  routes: [
    { path: ROUTE_PATH, component: () => import('./pages/Board.js'), index: true },
    { path: '/acme-board/:id', component: () => import('./pages/Detail.js') },
  ],
  nav: [{ to: ROUTE_PATH, labelKey: 'nav.board.label', icon: 'Box', section: 'main' }],
};
`;

const MANIFEST = `import { defineModuleManifest } from '@acme/contracts';

export const manifest = defineModuleManifest({
  id: 'acme_board',
  actions: [
    { id: 'open-acme-board', labelKey: 'a', descriptionKey: 'b', targetRoute: '/acme-board', icon: 'Box' },
  ],
});
`;

describe('readOverlayAdminSurface', () => {
  it('reads routes and nav entries, resolving a same-file string constant', () => {
    expect(readOverlayAdminSurface('acme_board', 'index.tsx', LAYER)).toEqual({
      surface: {
        moduleId: 'acme_board',
        routes: [{ path: '/acme-board', index: true }, { path: '/acme-board/:id' }],
        nav: [{ to: '/acme-board' }],
      },
      unreadable: [],
    });
  });

  it('reports a path it cannot evaluate instead of dropping the route', () => {
    const source = LAYER.replace("path: ROUTE_PATH, component", 'path: `${BASE}/x`, component');
    const read = readOverlayAdminSurface('acme_board', 'index.tsx', source);
    expect(read.unreadable).toEqual(['index.tsx: routes[0].path is not a string literal or a same-file constant']);
  });

  it('reports a layer with no `contributions` object', () => {
    expect(readOverlayAdminSurface('acme_board', 'index.tsx', 'export const other = {};\n').unreadable).toEqual([
      'index.tsx: no `export const contributions = { … }` object literal',
    ]);
  });
});

describe('readOverlayManifestActions', () => {
  it('reads each action id and target route', () => {
    expect(readOverlayManifestActions('acme_board', 'manifest.ts', MANIFEST)).toEqual({
      actions: [{ moduleId: 'acme_board', id: 'open-acme-board', targetRoute: '/acme-board' }],
      unreadable: [],
    });
  });

  it('reads a manifest that declares no actions as none', () => {
    const source = "export const manifest = defineModuleManifest({ id: 'x' });\n";
    expect(readOverlayManifestActions('x', 'manifest.ts', source)).toEqual({ actions: [], unreadable: [] });
  });
});

describe('deploymentPaletteCoverage', () => {
  function apps(manifest: string): string {
    const root = mkdtempSync(join(tmpdir(), 'palette-'));
    scratch.push(root);
    const dir = join(root, 'acme', 'modules', 'acme_board');
    write(join(dir, 'manifest.ts'), manifest);
    write(join(dir, 'admin', 'index.tsx'), LAYER);
    write(join(root, 'acme', 'modules', 'headless', 'manifest.ts'), "export const manifest = { id: 'headless' };\n");
    write(join(root, 'bare', 'modules', '.gitkeep'), '');
    return root;
  }

  it('is clean for every deployment when the landing route has an action', () => {
    const result = deploymentPaletteCoverage(apps(MANIFEST), []);
    expect(result.map((entry) => [entry.deployment, entry.surfaces, entry.findings.map(describeFinding)])).toEqual([
      ['acme', 1, []],
      ['bare', 0, []],
    ]);
  });

  it('is red on a landing route with no action, naming the module and the route', () => {
    const result = deploymentPaletteCoverage(apps(MANIFEST.replace(/actions: \[[\s\S]*?\],\n/, '')), []);
    expect(result[0]!.findings.map((finding) => `${finding.kind} ${finding.path}`)).toEqual([
      'uncovered-landing /acme-board',
      'module-without-action /acme-board',
    ]);
  });

  it("counts an installed package's action as coverage, but not as the module's own", () => {
    const result = deploymentPaletteCoverage(apps(MANIFEST.replace(/actions: \[[\s\S]*?\],\n/, '')), [
      { moduleId: 'catalog', id: 'open-board', targetRoute: '/acme-board' },
    ]);
    expect(result[0]!.findings.map((finding) => finding.kind)).toEqual(['module-without-action']);
  });

  it('carries what it could not read', () => {
    const result = deploymentPaletteCoverage(apps("export const manifest = { id: 'acme_board', actions: ACTIONS };\n"), []);
    expect(result[0]!.unreadable).toEqual([
      expect.stringMatching(/acme\/modules\/acme_board\/manifest\.ts: actions is not an array literal$/),
    ]);
  });
});
