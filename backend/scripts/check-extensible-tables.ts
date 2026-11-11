/**
 * CI check — no migration of an extensible table's owner rebuilds it, and every
 * custom-field binding names its table's real owner
 * (`specs/178-extensible-columns/` FR-072, FR-012). **Repository-scope host**
 * over the analysis in `@endora-commerce/cli/rules/extensible-tables.js`, whose
 * header carries the reasoning; this file supplies the module layout, the
 * owners' migration sources and `check:module-boundary`'s table→owner map.
 *
 * Usage: `tsx scripts/check-extensible-tables.ts`
 * Exit 0 = clean; exit 1 = at least one finding; exit 2 = an owning module
 * contributed no migration source, or nothing was read — a green there would
 * mean "not looking" (issues #113, #215).
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkExtensibleTables,
  publishedBindings,
  type ExtensibleBinding,
  type ExtensibleTablesResult,
  type MigrationSourceInput,
} from '@endora-commerce/cli/rules/extensible-tables.js';

import { buildTableOwners, scanModuleBoundaryTree } from './check-module-boundary.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/extensible-tables.js';

/** Every migration source of the modules that own an extensible table. */
export function owningModuleMigrations(
  layout: Pick<ModuleTreeLayout, 'moduleDirectoryOf' | 'keyOf'>,
  bindings: readonly ExtensibleBinding[],
): Map<string, MigrationSourceInput> {
  const migrations = new Map<string, MigrationSourceInput>();
  for (const moduleId of [...new Set(bindings.map((binding) => binding.ownerModuleId))].sort()) {
    const root = layout.moduleDirectoryOf(moduleId);
    if (root === null) continue;
    for (const directory of [join(root, 'src', 'migrations'), join(root, 'migrations')]) {
      if (!existsSync(directory)) continue;
      for (const name of readdirSync(directory).sort()) {
        if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'index.ts') continue;
        const file = join(directory, name);
        migrations.set(layout.keyOf(file), { moduleId, text: readFileSync(file, 'utf8') });
      }
    }
  }
  return migrations;
}

/** Print the result; returns the exit code. */
export function report(result: ExtensibleTablesResult): number {
  reportReadSize({
    prefix: '[extensible-tables]',
    files: result.files,
    sites: result.sites,
    coverage: [{ source: 'extensible-owners', expected: result.owners.expected, covered: result.owners.covered }],
  });
  if (result.owners.missing.length > 0) {
    console.error(
      `[extensible-tables] owning module(s) contributed no migration source: ${result.owners.missing.join(', ')}. ` +
        'Every extensible table is created by a migration of its owner, so a walk that found none read the ' +
        'wrong tree — refusing a vacuous pass.',
    );
    return 2;
  }
  const rebuilds = result.findings.filter((finding) => finding.kind === 'extensible-table-rebuild').length;
  console.log(
    `[extensible-tables] owners=${result.owners.covered} migrations=${result.files} ` +
      `rebuilds=${rebuilds} binding-mismatches=${result.findings.length - rebuilds}`,
  );
  for (const finding of result.findings) {
    console.error(`  - [${finding.kind}] ${finding.location}: ${finding.message}`);
  }
  return result.findings.length > 0 ? 1 : 0;
}

async function main(): Promise<void> {
  const layout = await requireModuleLayout('[extensible-tables]');
  const bindings = publishedBindings();
  const scan = await scanModuleBoundaryTree(layout);
  const owners = buildTableOwners(scan.input.schema, scan.input.packageTables, scan.input.hostResidentModules).owners;
  const result = checkExtensibleTables({
    migrations: owningModuleMigrations(layout, bindings),
    bindings,
    owners: new Map([...owners].map(([table, owner]) => [table, owner.id] as const)),
  });
  process.exit(report(result));
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
