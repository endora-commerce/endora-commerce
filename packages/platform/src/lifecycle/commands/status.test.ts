import { defineModuleManifest } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';

import { migrationOwnershipOf } from '../../db/configured-migrations.js';
import { moduleMigrationsOf, runStatusCommand } from './status.js';
import type { MigrationCatalogue, OperatorRuntime } from './operator-runtime.js';

/**
 * `module:status` lists a module's migrations, each with its origin and whether
 * this database has applied it (`specs/190-overlay-full-modules/` FR-045, T091;
 * `contracts/overlay-lifecycle.md` §1).
 *
 * An overlay module's migrations are read at runtime from the deployment root,
 * not from any committed registry, so an operator who asked "did my overlay's
 * table get created?" had no command that answered. The listing is the
 * migration order's own (`registered`, with origins) narrowed to the module by
 * the ownership answer `uninstall --hard` reverts by — one population, so what
 * `status` lists is exactly what a hard uninstall would revert.
 *
 * The database is a stub: the two reads this command makes are the
 * registration rows and the migrator's executed list, and both are answered
 * here so the rendering is what is under test.
 */
const OVERLAY = 'acme_notes';
const OWN_A = 'Migration20261125T120000AcmeNotesCreateNotes';
const OWN_B = 'Migration20261126T090000AcmeNotesAddPinned';
const CORE = 'Migration20260101T000000OrganizationsInit';

const manifestFor = (id: string) =>
  defineModuleManifest({ id, name: id, description: `${id} fixture`, version: '1.0.0', dependencies: [] });

const catalogue: MigrationCatalogue = {
  registered: [
    { name: CORE, origin: 'core' },
    { name: OWN_A, origin: 'overlay' },
    { name: OWN_B, origin: 'overlay' },
  ],
  ownership: migrationOwnershipOf(
    [
      { moduleId: 'organizations', cls: { name: CORE } as never },
      { moduleId: OVERLAY, cls: { name: OWN_B } as never },
      { moduleId: OVERLAY, cls: { name: OWN_A } as never },
    ],
    ['organizations', OVERLAY],
  ),
};

function runtime(options: { catalogue?: MigrationCatalogue; executed?: string[] } = {}): {
  rt: OperatorRuntime;
  out: string[];
} {
  const out: string[] = [];
  const executed = options.executed ?? [CORE, OWN_A];
  const rt: OperatorRuntime = {
    resources: () =>
      Promise.resolve({
        orm: {
          migrator: { getExecuted: () => Promise.resolve(executed.map((name) => ({ name }))) },
        },
        em: () => ({ find: () => Promise.resolve([]) }),
        redis: {},
      } as never),
    entries: [OVERLAY, 'organizations'].map((id) => ({
      manifest: manifestFor(id),
      filePath: `/fixture/${id}/manifest.js`,
      origin: id === OVERLAY ? ('overlay' as const) : ('core' as const),
    })),
    ...(options.catalogue ? { migrations: () => Promise.resolve(options.catalogue!) } : {}),
    out: (line: string) => void out.push(line),
    err: () => undefined,
  };
  return { rt, out };
}

describe('moduleMigrationsOf', () => {
  it('lists the module’s migrations in execution order, with origin and applied state', () => {
    expect(moduleMigrationsOf(catalogue, OVERLAY, new Set([CORE, OWN_A]))).toEqual([
      { name: OWN_A, origin: 'overlay', state: 'applied' },
      { name: OWN_B, origin: 'overlay', state: 'pending' },
    ]);
  });

  it('answers [] for a covered module that owns none, and null for one the registry cannot answer for', () => {
    const covered = { ...catalogue, ownership: migrationOwnershipOf([], ['fixture_none']) };
    expect(moduleMigrationsOf(covered, 'fixture_none', new Set())).toEqual([]);
    expect(moduleMigrationsOf(catalogue, 'unknown_module', new Set())).toBeNull();
  });
});

describe('module:status — a module’s migrations (190 T091)', () => {
  it('--json carries each row’s migrations with origin and state', async () => {
    const { rt, out } = runtime({ catalogue });
    expect(await runStatusCommand(['--json'], rt)).toBe(0);
    const { modules } = JSON.parse(out.join('')) as {
      modules: Array<{ id: string; migrations?: unknown }>;
    };
    expect(modules.find((row) => row.id === OVERLAY)?.migrations).toEqual([
      { name: OWN_A, origin: 'overlay', state: 'applied' },
      { name: OWN_B, origin: 'overlay', state: 'pending' },
    ]);
    expect(modules.find((row) => row.id === 'organizations')?.migrations).toEqual([
      { name: CORE, origin: 'core', state: 'applied' },
    ]);
  });

  it('the table for one module lists its migrations by name, origin and state', async () => {
    const { rt, out } = runtime({ catalogue });
    expect(await runStatusCommand([OVERLAY], rt)).toBe(0);
    const text = out.join('');
    expect(text).toMatch(new RegExp(`${OWN_A}\\s+overlay\\s+applied`));
    expect(text).toMatch(new RegExp(`${OWN_B}\\s+overlay\\s+pending`));
    expect(text).not.toContain(CORE);
  });

  it('says so when the module owns no migration', async () => {
    const { rt, out } = runtime({
      catalogue: { ...catalogue, ownership: migrationOwnershipOf([], [OVERLAY, 'organizations']) },
    });
    await runStatusCommand([OVERLAY], rt);
    expect(out.join('')).toContain('(no migrations)');
  });

  it('lists nothing and opens no migrator when the host supplies no catalogue', async () => {
    const { rt, out } = runtime();
    await runStatusCommand(['--json'], rt);
    const { modules } = JSON.parse(out.join('')) as { modules: Array<Record<string, unknown>> };
    expect(modules.every((row) => !('migrations' in row))).toBe(true);
  });
});
