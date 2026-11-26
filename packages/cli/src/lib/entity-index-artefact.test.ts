/**
 * The entity index names the selected deployment's overlay entities too
 * (`specs/190-overlay-full-modules/` T104, FR-058; `contracts/overlay-cli.md` §3).
 *
 * Since D-297 an overlay module may own a table, and a server-bound test in an
 * instance writes its rows the way it writes a package's: through the class the
 * ORM registered, picked out of the module's `entities` array by name. So the
 * index gains one entry per overlay module of the deployment the instance runs
 * as whose sources declare an entity — read off **decorator syntax nodes**, as a
 * package's classification is, never off text a comment could carry.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runGenerate } from '../generate/index.js';
import {
  collectEntityIndexEntries,
  collectOverlayEntityIndexEntries,
  emitEntityIndex,
  entityIndexOutputPathIn,
} from './entity-index-artefact.js';
import type { ModulePackage } from './module-packages.js';
import { cleanInstances, instance } from '../../test/support/overlay-instance.js';

const scratch: string[] = [];
afterEach(() => {
  while (scratch.length > 0) rmSync(scratch.pop()!, { recursive: true, force: true });
  cleanInstances();
});

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}

const ENTITY = `import { Entity, PrimaryKey } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

@GlobalEntity()
@Entity({ tableName: 'notes' })
export class Note {
  @PrimaryKey({ type: 'uuid' })
  id!: string;
}
`;

/** Overlay modules under `apps/<deployment>/modules/` of `root`. */
function overlays(root: string, deployment = 'acme'): void {
  const modules = join(root, 'apps', deployment, 'modules');
  write(join(modules, 'notes', 'manifest.ts'), 'export const manifest = {};\n');
  write(join(modules, 'notes', 'backend.ts'), 'export const entities = [];\n');
  write(join(modules, 'notes', 'entities', 'note.entity.ts'), ENTITY);
  // No entity: nothing for a test to build a row of, so no entry.
  write(join(modules, 'plain', 'manifest.ts'), 'export const manifest = {};\n');
  write(join(modules, 'plain', 'backend.ts'), 'export function registerModule() {}\n');
  // `@Entity(` in a comment declares nothing.
  write(join(modules, 'commented', 'manifest.ts'), 'export const manifest = {};\n');
  write(join(modules, 'commented', 'backend.ts'), 'export {};\n');
  write(
    join(modules, 'commented', 'entities', 'x.ts'),
    '// @Entity({ tableName: "x" }) is what a table would need.\nexport class X {}\n',
  );
}

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-entity-index-'));
  scratch.push(root);
  return root;
}

describe('collectOverlayEntityIndexEntries', () => {
  it('names each overlay module whose sources declare an entity, by its backend', () => {
    const root = tree();
    overlays(root);
    const indexPath = entityIndexOutputPathIn(root);
    const entries = collectOverlayEntityIndexEntries(root, 'acme', indexPath);
    expect(entries).toEqual([
      { moduleId: 'notes', specifier: '../../apps/acme/modules/notes/backend.js' },
    ]);
    // The specifier is the module's own `backend.ts`, as a test resolves it.
    const target = resolve(dirname(indexPath), entries[0]!.specifier.replace(/\.js$/, '.ts'));
    expect(existsSync(target)).toBe(true);
  });

  it('reads the selected deployment and no other', () => {
    const root = tree();
    overlays(root, 'beta');
    expect(collectOverlayEntityIndexEntries(root, 'acme', entityIndexOutputPathIn(root))).toEqual([]);
    expect(
      collectOverlayEntityIndexEntries(root, 'beta', entityIndexOutputPathIn(root)).map(
        (entry) => entry.moduleId,
      ),
    ).toEqual(['notes']);
  });
});

describe('the index over packages and overlays', () => {
  const pkg = (moduleId: string): ModulePackage =>
    ({
      moduleId,
      name: `@endora-commerce/mod-${moduleId}`,
      exports: new Map([['./backend', './dist/backend/index.js']]),
    }) as unknown as ModulePackage;

  it('merges them, sorted by module id', () => {
    const entries = collectEntityIndexEntries(
      [pkg('settings'), pkg('auth')],
      [{ moduleId: 'notes', specifier: '../../apps/acme/modules/notes/backend.js' }],
    );
    expect(entries.map((entry) => entry.moduleId)).toEqual(['auth', 'notes', 'settings']);
    expect(emitEntityIndex(entries)).toContain(
      `import { entities as entities1 } from '../../apps/acme/modules/notes/backend.js';`,
    );
  });

  it('refuses an overlay id a package already holds', () => {
    expect(() =>
      collectEntityIndexEntries(
        [pkg('notes')],
        [{ moduleId: 'notes', specifier: '../../apps/acme/modules/notes/backend.js' }],
      ),
    ).toThrow(/notes/);
  });
});

describe('`endora generate` in an instance', () => {
  it('renders the overlay entities of the deployment `.env` selects', async () => {
    const root = instance();
    overlays(root);
    await runGenerate({ cwd: root });
    const index = readFileSync(entityIndexOutputPathIn(root), 'utf8');
    expect(index).toContain(`from '../../apps/acme/modules/notes/backend.js';`);
    expect(index).toMatch(/\n {2}notes: entities\d+,\n/);
    expect(index).not.toContain('modules/plain/');
    expect(index).not.toContain('modules/commented/');
  });

  it('names none when no deployment is selected, and still renders the packages', async () => {
    const root = instance({ env: null, deployments: ['acme', 'beta'] });
    overlays(root);
    await runGenerate({ cwd: root });
    const index = readFileSync(entityIndexOutputPathIn(root), 'utf8');
    expect(index).not.toContain('apps/');
    expect(index).toContain('settings: entities');
  });
});
