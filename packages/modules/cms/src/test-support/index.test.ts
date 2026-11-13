/**
 * Issue #1087 — the CMS templates are emptied between test files.
 *
 * `cms_templates` hangs off nothing the harness truncates: its sales-channel
 * bindings cascade away with `sales_channels`, the template itself stays. So a
 * template one file created stood, unbound, for every later file on the same
 * worker database — and `seeded-content-renders.test.ts`, which reads the table
 * whole, failed on `cta-free-shipping-<stamp>: bound to no channel`, written by
 * `quickstart-smoke.test.ts`. The per-file reset reads a module's
 * `volatileTables`; this holds the declaration, and that every name in it is a
 * table this module's own migrations create, so a rename cannot leave the reset
 * pointing at nothing.
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

describe('cms test support', () => {
  it('declares the templates and their channel bindings volatile', () => {
    expect([...volatileTables].sort()).toEqual(['cms_template_sales_channels', 'cms_templates']);
  });

  it('names only tables this module creates', () => {
    const created = tablesCreatedByOwnMigrations();
    for (const table of volatileTables) expect(created, table).toContain(table);
  });
});
