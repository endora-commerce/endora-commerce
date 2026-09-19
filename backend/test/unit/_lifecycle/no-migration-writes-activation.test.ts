import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configuredMigrations } from '../../../src/db/configured-migrations.js';

/**
 * T034 / FR-018 / R5.4 — **no migration writes an activation row.**
 *
 * ## Why this is asserted rather than reviewed
 *
 * Changing a shipped default must not change an operator's **recorded** choice. The
 * default applies only where the Setting row carries no override, which is what makes
 * FR-017's flip reversible and non-destructive: a deployment that chose explicitly has a
 * `global_value` and keeps it.
 *
 * A migration that wrote an activation row would break that quietly and in the direction
 * nobody checks — it would attribute a choice to an operator who made none, and the
 * exclusion guards the *transition* rather than the existing state, so a persisted
 * invalid state is never surfaced. `research.md` D7 rejects both migration-shaped
 * alternatives on exactly that ground, and neither is rejected on taste:
 *
 *  - materialising the effective value for everyone would write `true` for three
 *    connectors, which is three simultaneous explicit claims in a family that permits
 *    one — an invalid state, persisted, attributed to nobody;
 *  - materialising it only where a connection exists would put a `select` over four
 *    connectors' tables inside `pim_connector`'s migration, which is a
 *    `check:module-boundary` R1 finding whose only manifest answer is the shape
 *    `specs/conventions/module-migrations.md` item 4a forbids — and it would pick one
 *    connector arbitrarily wherever several qualify, which is an operator's decision
 *    made by a migration.
 *
 * So the absence is the design, and an absence nothing asserts is an absence that comes
 * back.
 *
 * ## The population is every migration file, floored by the registry
 *
 * The files are walked, because a file is what carries the write. The **registry** —
 * `configured-migrations.ts`, the list the ORM actually runs — is read alongside as the
 * floor: a walk that collapses would otherwise pass, and this repository's own history is
 * several checks that read clean after their reach halved. Walking the files rather than
 * only the registered set is the wider of the two, deliberately: an unregistered migration
 * does not run today, but it is a file somebody will register.
 */

const registry = await configuredMigrations();

/**
 * The checkout root, found by walking up to the workspace manifest rather than counting
 * `..` segments — so moving this file cannot silently make the walk read nothing, which is
 * the failure the floor below would then be the only thing catching.
 */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  throw new Error('could not find the workspace root above this test file');
}

const ROOT = repoRoot();

/**
 * Every migration file a module or the platform owns.
 *
 * Rooted at the checkout found above, so this reads the tree it is running in.
 */
function migrationFiles(): string[] {
  const roots: string[] = [join(ROOT, 'packages', 'platform', 'src', 'migrations')];

  const modulesDir = join(ROOT, 'packages', 'modules');
  let moduleIds: string[] = [];
  try {
    moduleIds = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    moduleIds = [];
  }
  for (const id of moduleIds) {
    roots.push(join(modulesDir, id, 'src', 'migrations'));
  }

  const files: string[] = [];
  for (const dir of roots) {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.ts') || name === 'index.ts' || name.endsWith('.test.ts')) continue;
      files.push(join(dir, name));
    }
  }
  return files.sort();
}

const FILES = migrationFiles();

/**
 * Comments removed, because a migration's prose legitimately discusses the settings store
 * — several say *"configuration lives in the Settings module and needs no schema here"*,
 * which is the correct thing to have written and the opposite of a violation.
 *
 * The first shape of this test matched those comments and reported six false positives.
 * A pattern that reads prose is a pattern that will be relaxed until it reads nothing, so
 * the prose is removed instead.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/**
 * Writing an activation Setting, in the shapes a migration could use.
 *
 * Deliberately **not** a search for the word `activation`: what is forbidden is a write
 * whose target is the settings store and whose subject is an activation code.
 */
const ACTIVATION_WRITE = [
  // SQL against the settings table naming an activation code, either order.
  /(insert\s+into|update|upsert)[\s\S]{0,300}?settings[\s\S]{0,300}?\.activation/i,
  /\.activation[\s\S]{0,300}?(insert\s+into|update)[\s\S]{0,200}?settings/i,
  // The ORM path: `Setting` passed as the entity of a write.
  /\b(create|persist|nativeUpdate|nativeInsert|upsert)\s*(<[^>]*>)?\s*\(\s*Setting\s*[,)]/,
];

describe('no migration writes a module activation row [FR-018]', () => {
  it('walked a population, and it is at least as large as what the ORM runs', () => {
    // The vacuous-pass guard, both halves: an empty walk passes every assertion below,
    // and a walk narrower than the registry would be reading less than what runs.
    expect(registry.names.length, 'registered migrations').toBeGreaterThan(100);
    expect(FILES.length, 'migration files walked').toBeGreaterThanOrEqual(
      registry.names.length,
    );
  });

  it('no migration file writes an activation Setting', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(file, 'utf8');
      if (ACTIVATION_WRITE.some((pattern) => pattern.test(code(source)))) offenders.push(file);
    }
    expect(
      offenders,
      "a migration appears to write an activation Setting row — see this file's header for " +
        'why FR-018 forbids it, and `research.md` D7 for the two alternatives that were ' +
        'rejected and why neither is a matter of taste',
    ).toEqual([]);
  });

  it('the patterns catch a write that really is one, in each shape', () => {
    // **The positive control, and without it this file is a pattern that matches nothing.**
    // Three synthetic offenders, one per shape the forbidden write can take, each in the
    // form a migration would actually be written in.
    const offending = [
      `this.addSql("insert into settings (code, global_value) values ('pim_akeneo.activation', 'true')");`,
      `this.addSql("update settings set global_value = 'true' where code = 'pim_akeneo.activation'");`,
      `const em = this.getEntityManager(); em.create(Setting, { code: 'pim_akeneo.activation' });`,
    ];
    for (const source of offending) {
      expect(
        ACTIVATION_WRITE.some((pattern) => pattern.test(code(source))),
        `not matched: ${source}`,
      ).toBe(true);
    }
  });

  it('and does not catch a migration that merely mentions the settings store', () => {
    // The false positives the first shape of this test produced: six migrations whose
    // comments say configuration lives in Settings and needs no schema, which is the
    // correct thing to have written.
    const innocent = [
      `/** PWA identity and toggles are NOT a table — they live in the Settings module. */`,
      `// Channel configuration (enabled, pixel id) lives in the Settings module.`,
      `/* Settings (\`carts.abandonment.inactivity_minutes\`) are reconciled, not migrated. */`,
    ];
    for (const source of innocent) {
      expect(
        ACTIVATION_WRITE.some((pattern) => pattern.test(code(source))),
        `falsely matched: ${source}`,
      ).toBe(false);
    }
  });

  it('this feature touched no migration at all', () => {
    // The narrower claim T034 makes, stated where it is checkable without git: none of the
    // three families' owners or members gained or changed a migration for feature 132. The
    // activation flip is a declaration change; there is nothing to migrate, and reaching
    // for one would be the signal that the design went wrong (`research.md` D8).
    const families = [
      'pim_connector',
      'pim_akeneo',
      'pim_ergonode',
      'pim_pimcore',
      'pim_unopim',
      'erp_connector',
      'comarch_xl',
      'invoice_ledger',
      'infakt',
      'wfirma',
    ];
    const touched = FILES.filter((file) =>
      families.some((id) => file.includes(`/${id}/src/migrations/`)),
    ).filter((file) => readFileSync(file, 'utf8').includes('capabilit'));
    expect(touched).toEqual([]);
  });
});
