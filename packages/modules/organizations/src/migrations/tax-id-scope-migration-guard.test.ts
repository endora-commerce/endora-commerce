import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `specs/177-tax-id-scope/` T007 (data-model §3, *Future migrations*) —
 * migrations do not depend on the tax-ID scope.
 *
 * Which of `organizations_tax_id_unique` (`global`) and
 * `organizations_tax_id_one_tree` (`per-tree-root`) exists is a runtime fact,
 * changed by the scope Command and recorded in `organization_tax_id_policy`. A
 * later migration that recreated, dropped or altered either by name, without
 * reading that row, would break every installation in the other scope — and
 * nothing at run time would say so until a duplicate tax ID got through or a
 * branch was refused. So any migration of this module stamped after the one
 * that introduced the scope and naming either constraint must also name the
 * policy table.
 */
const SCOPE_MIGRATION_STAMP = '20261110T135941';
const CONSTRAINTS = ['organizations_tax_id_unique', 'organizations_tax_id_one_tree'] as const;
const POLICY_TABLE = 'organization_tax_id_policy';

interface ScopeGuardFinding {
  file: string;
  constraint: string;
}

/** The migrations after the scope's own that name a scope constraint and not the policy. */
function scopeBlindMigrations(files: ReadonlyArray<{ name: string; source: string }>): ScopeGuardFinding[] {
  return files.flatMap(({ name, source }) => {
    const stamp = name.slice(0, SCOPE_MIGRATION_STAMP.length);
    if (!/^\d{8}T\d{6}$/.test(stamp) || stamp <= SCOPE_MIGRATION_STAMP) return [];
    if (source.includes(POLICY_TABLE)) return [];
    return CONSTRAINTS.filter((constraint) => source.includes(constraint)).map((constraint) => ({
      file: name,
      constraint,
    }));
  });
}

const directory = dirname(fileURLToPath(import.meta.url));

describe('tax-ID scope — later migrations branch on the policy [unit]', () => {
  it('no migration of this module after the scope migration names a scope constraint blindly', () => {
    const files = readdirSync(directory)
      .filter((name) => /^\d{8}T\d{6}_.*\.ts$/.test(name) && !name.endsWith('.test.ts'))
      .map((name) => ({ name, source: readFileSync(join(directory, name), 'utf8') }));
    expect(files.some((file) => file.name.startsWith(SCOPE_MIGRATION_STAMP))).toBe(true);
    expect(scopeBlindMigrations(files)).toEqual([]);
  });

  it('refuses a later migration that recreates the unique constraint without reading the scope', () => {
    const blind = {
      name: '20261201T000000_organizations_rebuild_tax_id.ts',
      source: `this.addSql('alter table "organizations" add constraint "organizations_tax_id_unique" unique ("tax_id");');`,
    };
    expect(scopeBlindMigrations([blind])).toEqual([
      { file: blind.name, constraint: 'organizations_tax_id_unique' },
    ]);
  });

  it('accepts one that branches on the policy row, and ignores the earlier migrations', () => {
    const branching = {
      name: '20261201T000000_organizations_rebuild_tax_id.ts',
      source: `do $$ begin if (select scope from organization_tax_id_policy) = 'global' then
        alter table organizations add constraint organizations_tax_id_unique unique (tax_id); end if; end $$;`,
    };
    const init = {
      name: '20260424T205317_organizations_init.ts',
      source: `constraint "organizations_tax_id_unique" unique ("tax_id")`,
    };
    const itself = {
      name: `${SCOPE_MIGRATION_STAMP}_organizations_tax_id_scope.ts`,
      source: 'organizations_tax_id_one_tree',
    };
    expect(scopeBlindMigrations([branching, init, itself])).toEqual([]);
  });
});
