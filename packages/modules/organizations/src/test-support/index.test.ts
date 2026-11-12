/**
 * Issue #1056 — the sales-rep assignments and the reach governor are emptied
 * between test files.
 *
 * Neither table has a foreign key to anything the harness truncates, so a row a
 * file left behind stood for every later file on the same database — and since a
 * representative reaches every Organization nobody is assigned to (spec 175), a
 * leaked assignment changes what a later file's representatives reach. The
 * per-file reset reads a module's `volatileTables`; this holds the declaration,
 * and that every name in it is a table this module's own migrations create, so
 * a rename cannot leave the reset pointing at nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { volatileTables } from './index.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

function tablesCreatedByOwnMigrations(): Set<string> {
  const created = new Set<string>();
  for (const file of readdirSync(migrationsDir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of source.matchAll(/create table (?:if not exists )?"([a-z_]+)"/g)) {
      created.add(match[1]!);
    }
  }
  return created;
}

describe('organizations test support', () => {
  it('declares the sales-rep assignments and the reach governor volatile', () => {
    expect([...volatileTables].sort()).toEqual([
      'organization_reach_governor',
      'organization_sales_rep_assignments',
    ]);
  });

  it('names only tables this module creates', () => {
    const created = tablesCreatedByOwnMigrations();
    for (const table of volatileTables) expect(created, table).toContain(table);
  });
});
