import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Migration } from '@mikro-orm/migrations';
import { PostgreSqlPlatform } from '@mikro-orm/postgresql';
import { afterAll, describe, expect, it, vi } from 'vitest';

import type { OverlaySchemaContribution } from '../overlay/overlay-schema.js';
import type { PackageSchemaContribution } from '../packages/package-runtime.js';
import { configuredMigrationsFrom, discoverConfiguredMigrations } from './configured-migrations.js';
import { ForeignSchemaWriteError, type MigrationClass } from './foreign-schema-guard.js';
import type { MigrationRegistryEntry } from './migration-order.js';

/**
 * The migration merge with an overlay module in it (`specs/190-overlay-full-modules/`
 * FR-033 – FR-036, contract `overlay-schema-discovery.md` §2, #1850).
 *
 * An overlay contribution is merged as a package's is — ordered by its manifest
 * dependencies, covered by ownership, wrapped by the foreign-schema guard — and
 * differs in two things only: its origin (`overlay`, R-7) and its exemption list,
 * which is always empty (OR-4).
 */
function migration(name: string, up: (self: Migration) => void | Promise<void> = () => {}): MigrationClass {
  const cls = class extends Migration {
    override async up(): Promise<void> {
      await up(this);
    }
  };
  Object.defineProperty(cls, 'name', { value: name });
  return cls;
}

const CORE_ENTRIES: MigrationRegistryEntry[] = [
  { moduleId: 'alpha', cls: migration('Migration20270301T000000AlphaInit') as never },
];
const CORE_DEPENDENCIES = new Map<string, readonly string[]>([
  ['core', []],
  ['alpha', []],
]);

function overlay(overrides: Partial<OverlaySchemaContribution> = {}): OverlaySchemaContribution {
  return {
    id: 'notice',
    source: 'overlay apps/shop/modules/notice',
    version: '1.0.0',
    migrationsDirectory: null,
    // Stamped before `alpha`'s, and depending on it: the stamp orders nothing across modules.
    migrations: [
      { moduleId: 'notice', cls: migration('Migration20270101T000000NoticeInit') as never, origin: 'overlay' },
    ],
    entities: [],
    dependencies: ['alpha'],
    nonDeactivatable: false,
    schemaExtensions: [],
    ...overrides,
  };
}

const merge = (overlays: readonly OverlaySchemaContribution[], packages: readonly PackageSchemaContribution[] = []) =>
  configuredMigrationsFrom({
    coreEntries: CORE_ENTRIES,
    coreModuleDependencies: CORE_DEPENDENCIES,
    packages,
    overlays,
    baseline: [],
    foreignWriteExemptions: [],
  });

function fakeDriver() {
  const executed: string[] = [];
  const platform = new PostgreSqlPlatform();
  return {
    executed,
    getPlatform: () => platform,
    getMetadata: () => ({ getAll: () => ({}) }),
    execute: vi.fn(async (sql: string) => {
      executed.push(sql);
      return [];
    }),
  };
}

async function runUp(cls: unknown): Promise<string[]> {
  const driver = fakeDriver();
  const instance = new (cls as new (d: unknown, c: unknown) => Migration)(driver, {});
  await instance.up();
  return driver.executed;
}

describe('configuredMigrationsFrom — an overlay module is merged as a package is', () => {
  it('orders its chain by its manifest dependencies and reports it under its own origin', () => {
    const merged = merge([overlay()]);
    expect(merged.names).toEqual(['Migration20270301T000000AlphaInit', 'Migration20270101T000000NoticeInit']);
    expect(merged.registered.at(-1)).toEqual({ name: 'Migration20270101T000000NoticeInit', origin: 'overlay' });
    expect(merged.overlays.map((contribution) => contribution.id)).toEqual(['notice']);
  });

  it('covers its id in the ownership `uninstall --hard` reverts by (FR-036)', () => {
    const merged = merge([overlay()]);
    expect(merged.ownership.migrationNamesFor('notice')).toEqual(['Migration20270101T000000NoticeInit']);
    expect(merge([]).ownership.migrationNamesFor('notice')).toBeNull();
  });

  it('wraps it in the foreign-schema guard, naming the overlay, and keeps the class name (FR-034)', async () => {
    const rogue = migration('Migration20270101T000000NoticeInit', (self) =>
      self.addSql(`update "orders" set "status" = 'x'`),
    );
    const merged = merge([
      overlay({ migrations: [{ moduleId: 'notice', cls: rogue as never, origin: 'overlay' }] }),
    ]);
    const wrapped = merged.migrations.find((entry) => entry.name === 'Migration20270101T000000NoticeInit')!;
    expect(wrapped.class).not.toBe(rogue);
    const refused = await runUp(wrapped.class).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForeignSchemaWriteError);
    expect(refused).toMatchObject({ packageName: 'overlay apps/shop/modules/notice', moduleId: 'notice', table: 'orders' });
  });

  it('grants it no exemption — not even a first-party one naming the same migration and table (OR-4)', async () => {
    const name = 'Migration20270101T000000NoticeInit';
    const rogue = migration(name, (self) => self.addSql(`update "orders" set "status" = 'x'`));
    const merged = configuredMigrationsFrom({
      coreEntries: CORE_ENTRIES,
      coreModuleDependencies: CORE_DEPENDENCIES,
      packages: [],
      overlays: [overlay({ migrations: [{ moduleId: 'notice', cls: rogue as never, origin: 'overlay' }] })],
      baseline: [],
      foreignWriteExemptions: [{ moduleId: 'notice', migration: name, table: 'orders' }],
    });
    const wrapped = merged.migrations.find((entry) => entry.name === name)!;
    await expect(runUp(wrapped.class)).rejects.toBeInstanceOf(ForeignSchemaWriteError);
  });

  it('with no overlay the result is the one it was before overlays could ship schema (FR-035)', () => {
    const without = configuredMigrationsFrom({
      coreEntries: CORE_ENTRIES,
      coreModuleDependencies: CORE_DEPENDENCIES,
      packages: [],
      baseline: [],
      foreignWriteExemptions: [],
    });
    const empty = merge([]);
    expect(empty.names).toEqual(without.names);
    expect(empty.registered).toEqual(without.registered);
    expect(empty.diagnostics).toEqual(without.diagnostics);
    expect([...empty.ownership.coveredModuleIds]).toEqual([...without.ownership.coveredModuleIds]);
    expect(empty.migrations.map((entry) => entry.class)).toEqual(without.migrations.map((entry) => entry.class));
    expect(without.overlays).toEqual([]);
  });
});

describe('discoverConfiguredMigrations — the deployment root reaches the merge (FR-035)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  const deploymentRoot = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'configured-migrations-'));
    roots.push(root);
    const files: Record<string, string> = {
      'apps/shop/modules/notice/manifest.js':
        "export const manifest = { id: 'notice', version: '1.0.0', dependencies: [] };\n",
      'apps/shop/modules/notice/migrations/20270101T000000_notice_init.js':
        'export class Migration20270101T000000NoticeInit { async up() {} }\n',
    };
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content, 'utf8');
    }
    return root;
  };

  it('merges the active deployment\'s overlay migrations', async () => {
    const merged = await discoverConfiguredMigrations(
      { coreEntries: [], manifests: [] },
      { DEPLOYMENT: 'shop' },
      deploymentRoot(),
    );
    expect(merged.registered).toContainEqual({ name: 'Migration20270101T000000NoticeInit', origin: 'overlay' });
    expect(merged.ownership.migrationNamesFor('notice')).toEqual(['Migration20270101T000000NoticeInit']);
  });

  it('is byte-identical to a run with no root when DEPLOYMENT is unset', async () => {
    const withRoot = await discoverConfiguredMigrations({ coreEntries: [], manifests: [] }, {}, deploymentRoot());
    const withoutRoot = await discoverConfiguredMigrations({ coreEntries: [], manifests: [] }, {});
    expect(JSON.stringify([withRoot.registered, withRoot.diagnostics])).toBe(
      JSON.stringify([withoutRoot.registered, withoutRoot.diagnostics]),
    );
    expect([...withRoot.ownership.coveredModuleIds]).toEqual([...withoutRoot.ownership.coveredModuleIds]);
  });
});
