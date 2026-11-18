/**
 * `specs/180-off-platform-complaints/` — the return clauses are emptied between test
 * files.
 *
 * `return_case_clauses` has no foreign key to anything the harness truncates, so a
 * clause one file created stood for every later file on the same worker database. A
 * clause is not inert data: an active `must_accept` clause makes every later filing
 * that does not accept it a refusal. The per-file reset reads a module's
 * `volatileTables`; this holds the declaration, and that every name in it is a table
 * this module's own migrations create, so a rename cannot leave the reset pointing at
 * nothing.
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

describe('returns test support', () => {
  it('declares the return clauses volatile', () => {
    expect([...volatileTables]).toEqual(['return_case_clauses']);
  });

  it('names only tables this module creates', () => {
    const created = tablesCreatedByOwnMigrations();
    for (const table of volatileTables) expect(created, table).toContain(table);
  });
});
