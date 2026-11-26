/**
 * `endora new migration <moduleId> --name <slug>` — inside an instance
 * (`specs/190-overlay-full-modules/` T101, FR-056; `contracts/overlay-cli.md` §2).
 *
 * An overlay module's `migrations/` is read file by file at runtime, so the file
 * this writes is the whole of registering it — and a misnamed one is refused at
 * boot (`migration-file-shape`). Every case runs over an instance on disk, and
 * the naming is held to `lib/migration-naming.ts`, the code this repository's
 * `migration:new` uses too.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/bin/endora.js';
import {
  BASELINE_THROUGH,
  classNameFromFile,
  MIGRATION_FILE_RE,
} from '../src/lib/migration-naming.js';
import { runNewMigration } from '../src/new-migration/index.js';
import { ScaffoldHostError, ScaffoldInputError } from '../src/new-module/spec.js';
import { cleanInstances, instance, write } from './support/overlay-instance.js';

afterEach(cleanInstances);

/** An instance holding one overlay module, `store_notes`, in `apps/<deployment>/`. */
function withOverlay(options: Parameters<typeof instance>[0] = {}, deployment = 'acme'): string {
  const root = instance(options);
  write(
    join(root, 'apps', deployment, 'modules', 'store_notes', 'manifest.ts'),
    "export const manifest = { id: 'store_notes' };\n",
  );
  return root;
}

const NOW = new Date(Date.UTC(2026, 10, 26, 10, 15, 0));

describe('writes a module-scoped migration into the overlay module', () => {
  it('names it by the shared rules and puts it in the module’s migrations/', async () => {
    const root = withOverlay();
    const result = await runNewMigration({ id: 'store_notes', name: 'Add Index', cwd: root, now: NOW });
    const dir = join(root, 'apps', 'acme', 'modules', 'store_notes', 'migrations');
    expect(result.path).toBe(join(dir, '20261126T101500_store_notes_add_index.ts'));
    expect(readdirSync(dir)).toEqual(['20261126T101500_store_notes_add_index.ts']);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain(`import { Migration } from '@mikro-orm/migrations';`);
    expect(content).toContain(
      'export class Migration20261126T101500StoreNotesAddIndex extends Migration {',
    );
    expect(content).toMatch(/override async up\(\): Promise<void> \{\n\s*\/\/[^\n]*\n\s*\}/);
    expect(content).toMatch(/override async down\(\): Promise<void> \{\n\s*\/\/[^\n]*\n\s*\}/);
    expect(classNameFromFile('20261126T101500_store_notes_add_index.ts')).toBe(
      result.className,
    );
    // Nothing of this repository's own tooling in a client's file.
    expect(content).not.toMatch(/composer:generate|--filter backend/);
  });

  it('clamps the stamp above the frozen watermark', async () => {
    const root = withOverlay();
    const result = await runNewMigration({
      id: 'store_notes',
      name: 'early',
      cwd: root,
      now: new Date(Date.UTC(2020, 0, 1)),
    });
    const stamp = MIGRATION_FILE_RE.exec(result.filename)![1]!;
    expect(stamp > BASELINE_THROUGH).toBe(true);
  });

  it('takes the next free second when the stamp is taken in the deployment', async () => {
    const root = withOverlay();
    write(
      join(root, 'apps', 'acme', 'modules', 'other', 'migrations', '20261126T101500_other_x.ts'),
      'export {};\n',
    );
    write(join(root, 'apps', 'acme', 'modules', 'other', 'manifest.ts'), 'export {};\n');
    const result = await runNewMigration({ id: 'store_notes', name: 'x', cwd: root, now: NOW });
    expect(result.filename).toBe('20261126T101501_store_notes_x.ts');
  });

  it('writes into the deployment `.env` selects', async () => {
    const root = instance({ env: 'DEPLOYMENT=beta\n', deployments: ['acme', 'beta'] });
    write(
      join(root, 'apps', 'beta', 'modules', 'store_notes', 'manifest.ts'),
      "export const manifest = { id: 'store_notes' };\n",
    );
    const result = await runNewMigration({ id: 'store_notes', name: 'x', cwd: root, now: NOW });
    expect(result.deployment).toBe('beta');
    expect(result.path).toContain(join('apps', 'beta', 'modules', 'store_notes', 'migrations'));
  });

  it('a dry run writes nothing', async () => {
    const root = withOverlay();
    const result = await runNewMigration({
      id: 'store_notes',
      name: 'x',
      cwd: root,
      now: NOW,
      dryRun: true,
    });
    expect(existsSync(result.path)).toBe(false);
    expect(result.contents).toContain(`export class ${result.className} extends Migration`);
  });

  it('the next steps are the instance’s build and migrate', async () => {
    const root = withOverlay();
    const steps = (await runNewMigration({ id: 'store_notes', name: 'x', cwd: root, now: NOW }))
      .nextSteps.join('\n');
    expect(steps).toContain('pnpm run build');
    expect(steps).toContain('pnpm run migrate');
    expect(steps).not.toMatch(/composer:generate|--filter/);
  });
});

describe('refusals — nothing is written', () => {
  it('an id an installed module package holds: its migrations are its author’s', async () => {
    const root = withOverlay();
    const error = await runNewMigration({ id: 'settings', name: 'x', cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('@endora-commerce/mod-settings');
    expect((error as Error).message).toContain('store_notes');
    expect(existsSync(join(root, 'apps', 'acme', 'modules', 'settings'))).toBe(false);
  });

  it('an id that is no overlay module of the selected deployment', async () => {
    const root = withOverlay({ env: 'DEPLOYMENT=beta\n', deployments: ['acme', 'beta'] });
    const error = await runNewMigration({ id: 'store_notes', name: 'x', cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldInputError);
    expect((error as Error).message).toContain('apps/beta/modules');
  });

  it('a directory under modules/ with no manifest is not a module', async () => {
    const root = instance();
    write(join(root, 'apps', 'acme', 'modules', 'loose', 'notes.txt'), 'x\n');
    const error = await runNewMigration({ id: 'loose', name: 'x', cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldInputError);
  });

  it('a missing id or name', async () => {
    const root = withOverlay();
    await expect(runNewMigration({ name: 'x', cwd: root })).rejects.toBeInstanceOf(
      ScaffoldInputError,
    );
    await expect(runNewMigration({ id: 'store_notes', cwd: root })).rejects.toBeInstanceOf(
      ScaffoldInputError,
    );
    await expect(
      runNewMigration({ id: 'store_notes', name: ' !! ', cwd: root }),
    ).rejects.toThrow(/empty slug/);
  });

  it('a second run never overwrites the first', async () => {
    const root = withOverlay();
    await runNewMigration({ id: 'store_notes', name: 'x', cwd: root, now: NOW });
    const dir = join(root, 'apps', 'acme', 'modules', 'store_notes', 'migrations');
    // Same second, same slug: the stamp walk moves it on, so the file is new.
    const again = await runNewMigration({ id: 'store_notes', name: 'x', cwd: root, now: NOW });
    expect(again.filename).toBe('20261126T101501_store_notes_x.ts');
    expect(readdirSync(dir)).toHaveLength(2);
  });

  it('outside an instance it names this repository’s own scaffolder', async () => {
    const root = withOverlay();
    // The platform repository is told apart by its manifest generator.
    write(join(root, 'backend', 'scripts', 'generate-module-manifests.ts'), 'export {};\n');
    const error = await runNewMigration({ id: 'store_notes', name: 'x', cwd: root }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ScaffoldHostError);
    expect((error as Error).message).toContain('migration:new');
  });
});

describe('the program', () => {
  it('`endora new migration <id> --name <slug>` writes it and exits 0', async () => {
    const root = withOverlay();
    const out: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    let code: number;
    try {
      code = await main(['new', 'migration', 'store_notes', '--name', 'add_index'], root);
    } finally {
      stdout.mockRestore();
    }
    expect(code).toBe(0);
    const written = readdirSync(join(root, 'apps', 'acme', 'modules', 'store_notes', 'migrations'));
    expect(written).toEqual([expect.stringMatching(/^\d{8}T\d{6}_store_notes_add_index\.ts$/)]);
    expect(out.join('')).toContain(`apps/acme/modules/store_notes/migrations/${written[0]!}`);
  });

  it('an unknown id exits 1', async () => {
    const root = withOverlay();
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await main(['new', 'migration', 'ghost', '--name', 'x'], root)).toBe(1);
    } finally {
      stderr.mockRestore();
    }
  });
});
