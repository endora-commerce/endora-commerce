import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configuredMigrationsFrom, discoverConfiguredMigrations } from '../db/configured-migrations.js';
import { defineColumnExtension } from '../kernel/schema-extensions/define.js';
import { SchemaExtensionInvalidError } from '../kernel/schema-extensions/errors.js';
import { schemaExtensionMigrationName } from '../db/schema-extension-migration.js';
import { discoverOverlaySchema, overlaySchemaContributionsUnder } from './overlay-schema.js';

/**
 * `x_*` columns declared by an overlay module (`specs/190-overlay-full-modules/`
 * FR-065, T110; contract `overlay-schema-discovery.md` §5).
 *
 * The cases `package-runtime-schema-extensions.test.ts` holds a **package**
 * declarer to (`specs/178-extensible-columns/` V9 – V11), re-run with an overlay
 * declarer: the module id is the overlay's, and the dependency closure V10 walks
 * is the composed graph — the overlays of the root, and every module outside it
 * whose edges the caller supplies (core, installed packages). Downstream, the
 * generated step lands at the head of the overlay's block, under its id.
 *
 * The fixture's `backend.js` hands back declarations this test made, through a
 * global, for the package test's reason: a tree under the OS temp directory
 * cannot resolve `@endora-commerce/platform` itself.
 */

const SLOT = '__overlaySchemaExtensionFixtures';
const fixtures = globalThis as unknown as Record<string, Record<string, unknown>>;
const roots: string[] = [];
const MODULES = 'apps/shop/modules';

const acme = defineColumnExtension({
  host: 'organizations',
  module: 'acme_overlay',
  columns: { erpCode: { type: 'varchar', length: 64, nullable: true } },
});
const acmeTwin = defineColumnExtension({
  host: 'organizations',
  module: 'acme_overlay',
  columns: { other: { type: 'text', nullable: true } },
});

beforeAll(() => {
  fixtures[SLOT] = { acme, acmeTwin, spread: { ...acme } };
});

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  delete fixtures[SLOT];
});

/** A deployment root holding one overlay module per entry of `modules`. */
function deployment(
  modules: Readonly<
    Record<string, { readonly dependencies?: readonly string[]; readonly schemaExtensions?: string }>
  >,
): string {
  const root = mkdtempSync(join(tmpdir(), 'overlay-schema-extensions-'));
  roots.push(root);
  const write = (path: string, content: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  };
  for (const [id, module] of Object.entries(modules)) {
    write(
      `${MODULES}/${id}/manifest.js`,
      `export const manifest = ${JSON.stringify({
        id,
        name: id,
        version: '1.4.0',
        dependencies: module.dependencies ?? [],
      })};\n`,
    );
    write(
      `${MODULES}/${id}/backend.js`,
      'export function registerModule() {}\n' +
        (module.schemaExtensions === undefined
          ? ''
          : `export const schemaExtensions = ${module.schemaExtensions};\n`),
    );
  }
  return root;
}

const read = (root: string, ids: readonly string[], options = {}) =>
  overlaySchemaContributionsUnder(join(root, MODULES), ids, options);

async function refusal(promise: Promise<unknown>): Promise<SchemaExtensionInvalidError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(SchemaExtensionInvalidError);
  return error as SchemaExtensionInvalidError;
}

describe('an overlay module’s schemaExtensions, held to V9 – V11 with the overlay context', () => {
  it('reads the declarations off backend’s `schemaExtensions` export', async () => {
    const root = deployment({
      acme_overlay: { dependencies: ['organizations'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    const [contribution] = await read(root, ['acme_overlay']);
    expect(contribution?.schemaExtensions).toEqual([acme]);
    expect(contribution?.schemaExtensions[0]).toBe(acme);
  });

  it('refuses a non-array export, naming the overlay', async () => {
    const root = deployment({
      acme_overlay: { dependencies: ['organizations'], schemaExtensions: `globalThis.${SLOT}.acme` },
    });
    const error = await refusal(read(root, ['acme_overlay']));
    expect(error.rule).toBe('not-a-declaration');
    expect(error.message).toContain('overlay apps/shop/modules/acme_overlay');
  });

  it('refuses a member that is not a branded declaration', async () => {
    const root = deployment({
      acme_overlay: { dependencies: ['organizations'], schemaExtensions: `[globalThis.${SLOT}.spread]` },
    });
    expect((await refusal(read(root, ['acme_overlay']))).rule).toBe('not-a-declaration');
  });

  it('V9 refuses a declaration for another module id — the overlay id is the declaring module', async () => {
    const root = deployment({
      someone_else: { dependencies: ['organizations'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    const error = await refusal(read(root, ['someone_else']));
    expect(error.rule).toBe('module-mismatch');
    expect(error.message).toContain('"someone_else"');
    expect(error.message).toContain('overlay apps/shop/modules/someone_else');
  });

  it('V10 refuses a host whose owner is not in the dependency closure', async () => {
    const root = deployment({
      acme_overlay: { dependencies: [], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    expect((await refusal(read(root, ['acme_overlay']))).rule).toBe('host-not-a-dependency');
  });

  it('V10 walks the closure across overlays of the same deployment', async () => {
    const root = deployment({
      acme_base: { dependencies: ['organizations'] },
      acme_overlay: { dependencies: ['acme_base'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    const contributions = await read(root, ['acme_base', 'acme_overlay']);
    expect(contributions.find((c) => c.id === 'acme_overlay')?.schemaExtensions).toEqual([acme]);
  });

  it('V10 walks the closure over the composed graph — through a module outside the root', async () => {
    // `acme_overlay` → `customers` (core here, a package in an instance) → `organizations`.
    const root = deployment({
      acme_overlay: { dependencies: ['customers'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    expect((await refusal(read(root, ['acme_overlay']))).rule).toBe('host-not-a-dependency');
    const [contribution] = await read(root, ['acme_overlay'], {
      composedDependencies: new Map([
        ['customers', ['organizations']],
        ['organizations', []],
      ]),
    });
    expect(contribution?.schemaExtensions).toEqual([acme]);
  });

  it('V11 refuses two declarations of one (module, host)', async () => {
    const root = deployment({
      acme_overlay: {
        dependencies: ['organizations'],
        schemaExtensions: `[globalThis.${SLOT}.acme, globalThis.${SLOT}.acmeTwin]`,
      },
    });
    expect((await refusal(read(root, ['acme_overlay']))).rule).toBe('duplicate-declaration');
  });
});

describe('the merge, given an overlay declarer', () => {
  const overlayEntry = (id: string, dependencies: readonly string[]) => ({
    id,
    source: `overlay apps/shop/modules/${id}`,
    version: '1.4.0',
    migrationsDirectory: null,
    migrations: [{ moduleId: id, cls: class Migration20260101T000000AcmeOverlayInit {} as never, origin: 'overlay' as const }],
    entities: [],
    dependencies,
    nonDeactivatable: false,
    schemaExtensions: [acme],
  });

  const merged = () =>
    configuredMigrationsFrom({
      coreEntries: [{ moduleId: 'organizations', cls: class Migration20250101T000000OrganizationsInit {} as never }],
      coreModuleDependencies: new Map([
        ['core', []],
        ['organizations', []],
      ]),
      packages: [],
      overlays: [overlayEntry('acme_overlay', ['organizations'])],
      baseline: [],
    });

  it('generates the step at the head of the overlay’s block, under the overlay id', () => {
    const configured = merged();
    const generated = schemaExtensionMigrationName('acme_overlay', [acme]);
    expect(configured.names).toEqual([
      'Migration20250101T000000OrganizationsInit',
      generated,
      'Migration20260101T000000AcmeOverlayInit',
    ]);
    expect(configured.registered.find((m) => m.name === generated)?.origin).toBe('generated');
  });

  it('lists the generated step in the overlay’s ownership answer, so a hard uninstall reverts it', () => {
    const owned = merged().ownership.migrationNamesFor('acme_overlay');
    expect(owned).toContain(schemaExtensionMigrationName('acme_overlay', [acme]));
  });

  it('refuses an overlay and a package that resolve to one physical name', () => {
    expect(() =>
      configuredMigrationsFrom({
        coreEntries: [],
        coreModuleDependencies: new Map([['core', []], ['organizations', []]]),
        packages: [
          {
            id: 'acme_overlay',
            packageName: '@acme/mod-acme-overlay',
            version: '1.0.0',
            migrationsDirectory: null,
            migrations: [],
            entities: [],
            dependencies: ['organizations'],
            schemaExtensions: [acme],
          },
        ],
        overlays: [{ ...overlayEntry('acme_overlay', ['organizations']), migrations: [] }],
        baseline: [],
      }),
    ).toThrow();
  });
});

describe('discoverConfiguredMigrations hands the overlay reader the composed graph', () => {
  it('accepts a declaration whose host owner is reached only through a core module', async () => {
    const root = deployment({
      acme_overlay: { dependencies: ['customers'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    const configured = await discoverConfiguredMigrations(
      {
        coreEntries: [],
        manifests: [
          { id: 'organizations', manifest: { id: 'organizations', dependencies: [] } },
          { id: 'customers', manifest: { id: 'customers', dependencies: ['organizations'] } },
        ] as never,
      },
      { DEPLOYMENT: 'shop', ENDORA_INSTANCE_ROOT: root },
      root,
    );
    expect(configured.overlays.map((c) => [c.id, c.schemaExtensions])).toEqual([['acme_overlay', [acme]]]);
    expect(configured.names).toContain(schemaExtensionMigrationName('acme_overlay', [acme]));
  });

  it('the overlay reader alone keeps today’s answer — no graph, direct edges only', async () => {
    const root = deployment({
      acme_overlay: { dependencies: ['customers'], schemaExtensions: `[globalThis.${SLOT}.acme]` },
    });
    expect((await refusal(discoverOverlaySchema(root, { DEPLOYMENT: 'shop' }))).rule).toBe(
      'host-not-a-dependency',
    );
  });
});
