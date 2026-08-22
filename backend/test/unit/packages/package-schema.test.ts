import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { packageSchemaContributionsUnder } from '../../../src/packages/package-runtime.js';

/**
 * The schema half of package discovery (feature 080, T033 — D-106.2).
 *
 * An installed extension package may ship entities and migrations, and neither
 * can reach the committed registries: the entity registry is emitted from a
 * source-text probe for `@Entity(` under `backend/src` and compilation removes
 * that text, and the migration registry is a walk of the same tree. So both are
 * read at runtime, through the package's own `exports` map.
 *
 * The fixtures are `node_modules` trees on disk, resolved and imported by the
 * same code the deployment path runs — never a pre-built contribution handed to
 * the last function in the chain (issue #130).
 */

let root: string;

interface FixtureOptions {
  readonly instance: string;
  readonly name: string;
  readonly id: string;
  readonly version?: string;
  /** How the `./migrations` export declares its list; omitted publishes none. */
  readonly migrations?: 'classes' | 'pairs' | 'mismatched-name' | 'not-an-array' | 'not-a-class';
  /** How the `./backend` export declares its entities. */
  readonly entities?: 'classes' | 'not-an-array';
}

function writeFixture(options: FixtureOptions): string {
  const dir = join(root, options.instance, 'node_modules', ...options.name.split('/'));
  mkdirSync(join(dir, 'dist', 'migrations'), { recursive: true });

  const exportsMap: Record<string, string> = {
    '.': './dist/manifest.js',
    './backend': './dist/backend.js',
    './package.json': './package.json',
  };
  if (options.migrations) exportsMap['./migrations'] = './dist/migrations/index.js';

  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version ?? '1.0.0',
        type: 'module',
        endora: { type: 'module', id: options.id, platform: '0.x' },
        exports: exportsMap,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, 'dist', 'manifest.js'),
    `export const manifest = ${JSON.stringify({
      id: options.id,
      name: options.name,
      version: options.version ?? '1.0.0',
      dependencies: [],
    })};\nexport default manifest;\n`,
  );

  const entityBody =
    options.entities === 'not-an-array'
      ? 'export const entities = { nope: 1 };\n'
      : options.entities === 'classes'
        ? 'export class ProbeRow {}\nexport const entities = [ProbeRow];\n'
        : '';
  writeFileSync(join(dir, 'dist', 'backend.js'), `export function registerModule() {}\n${entityBody}`);

  if (options.migrations) {
    // A real migration file, named the way the convention says, beside an
    // `index.js` that is not one — the shape a published `dist/migrations` has.
    writeFileSync(
      join(dir, 'dist', 'migrations', '20260821T120000_probe_init.js'),
      'export class Migration20260821T120000ProbeInit { up() {} }\n',
    );
    const list =
      options.migrations === 'classes'
        ? 'export const migrations = [Migration20260821T120000ProbeInit];'
        : options.migrations === 'pairs'
          ? "export const migrations = [{ name: 'Migration20260821T120000ProbeInit', class: Migration20260821T120000ProbeInit }];"
          : options.migrations === 'mismatched-name'
            ? "export const migrations = [{ name: 'MigrationSomethingElse', class: Migration20260821T120000ProbeInit }];"
            : options.migrations === 'not-a-class'
              ? "export const migrations = [{ name: 'x' }];"
              : 'export const migrations = 7;';
    writeFileSync(
      join(dir, 'dist', 'migrations', 'index.js'),
      `import { Migration20260821T120000ProbeInit } from './20260821T120000_probe_init.js';\n${list}\nexport { Migration20260821T120000ProbeInit };\n`,
    );
  }
  return dir;
}

function rootsFor(instance: string): string[] {
  return [join(root, instance, 'node_modules')];
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'b2b-t033-schema-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('what an installed package contributes to the schema', () => {
  it('reads its migration classes, tags them external and names their owning module', async () => {
    writeFixture({ instance: 'classes', name: '@vendor/mod-loyalty', id: 'loyalty', migrations: 'classes' });
    const [contribution] = await packageSchemaContributionsUnder(rootsFor('classes'));

    expect(contribution?.id).toBe('loyalty');
    expect(contribution?.migrations.map((entry) => entry.cls.name)).toEqual([
      'Migration20260821T120000ProbeInit',
    ]);
    // Never 'core' and never absent: the baseline block is a claim about *our*
    // history, and an entry that lies about its origin joins a frozen prefix it
    // has no business in.
    expect(contribution?.migrations.map((entry) => entry.origin)).toEqual(['external']);
    expect(contribution?.migrations.map((entry) => entry.moduleId)).toEqual(['loyalty']);
  });

  it('reads the { name, class } shape too, because the fixture and the contract disagree', async () => {
    writeFixture({ instance: 'pairs', name: '@vendor/mod-pairs', id: 'pairs', migrations: 'pairs' });
    const [contribution] = await packageSchemaContributionsUnder(rootsFor('pairs'));
    expect(contribution?.migrations.map((entry) => entry.cls.name)).toEqual([
      'Migration20260821T120000ProbeInit',
    ]);
  });

  it('refuses a declared name that is not the class name', async () => {
    writeFixture({
      instance: 'mismatch',
      name: '@vendor/mod-mismatch',
      id: 'mismatch',
      migrations: 'mismatched-name',
    });
    // mikro_orm_migrations persists the class name, so a host that believed the
    // declared one would record one string and revert by another.
    await expect(packageSchemaContributionsUnder(rootsFor('mismatch'))).rejects.toThrow(
      /declares migration "MigrationSomethingElse" for a class named/,
    );
  });

  it('refuses a migrations export that is not a list, rather than skipping it', async () => {
    writeFixture({
      instance: 'notarray',
      name: '@vendor/mod-notarray',
      id: 'notarray',
      migrations: 'not-an-array',
    });
    // Skipping would create no table and produce a query error nobody connects
    // to package discovery.
    await expect(packageSchemaContributionsUnder(rootsFor('notarray'))).rejects.toThrow(
      /exports no 'migrations' array/,
    );
  });

  it('refuses a migrations entry that is neither a class nor a pair', async () => {
    writeFixture({
      instance: 'notaclass',
      name: '@vendor/mod-notaclass',
      id: 'notaclass',
      migrations: 'not-a-class',
    });
    await expect(packageSchemaContributionsUnder(rootsFor('notaclass'))).rejects.toThrow(
      /is neither a migration class nor a \{ name, class \} pair/,
    );
  });

  it('reads the entity classes its ./backend export declares', async () => {
    writeFixture({
      instance: 'entities',
      name: '@vendor/mod-entities',
      id: 'entities',
      migrations: 'classes',
      entities: 'classes',
    });
    const [contribution] = await packageSchemaContributionsUnder(rootsFor('entities'));
    expect(contribution?.entities.map((entity) => entity.name)).toEqual(['ProbeRow']);
  });

  it('refuses an entities export that is not a list', async () => {
    writeFixture({
      instance: 'badentities',
      name: '@vendor/mod-badentities',
      id: 'badentities',
      entities: 'not-an-array',
    });
    await expect(packageSchemaContributionsUnder(rootsFor('badentities'))).rejects.toThrow(
      /exports 'entities' that is not an array/,
    );
  });

  it('reports the directory the ./migrations subpath resolves into, for the template digest', async () => {
    const dir = writeFixture({
      instance: 'digest',
      name: '@vendor/mod-digest',
      id: 'digest',
      migrations: 'classes',
    });
    const [contribution] = await packageSchemaContributionsUnder(rootsFor('digest'));
    // A package ships compiled output with no `.ts` source to hash, so this
    // directory is what the harness reads to tell two versions of one package
    // apart (D-155.5).
    expect(contribution?.migrationsDirectory).toBe(join(dir, 'dist', 'migrations'));
    expect(contribution?.packageName).toBe('@vendor/mod-digest');
    expect(contribution?.version).toBe('1.0.0');
  });

  it('says nothing about a package that publishes neither subpath', async () => {
    writeFixture({ instance: 'bare', name: '@vendor/mod-bare', id: 'bare' });
    const [contribution] = await packageSchemaContributionsUnder(rootsFor('bare'));
    expect(contribution?.migrationsDirectory).toBeNull();
    expect(contribution?.migrations).toEqual([]);
    expect(contribution?.entities).toEqual([]);
  });

  it('is empty for an instance that installed no module package', async () => {
    mkdirSync(join(root, 'empty', 'node_modules'), { recursive: true });
    expect(await packageSchemaContributionsUnder(rootsFor('empty'))).toEqual([]);
  });
});
