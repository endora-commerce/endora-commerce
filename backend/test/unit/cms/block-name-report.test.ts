import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FROZEN_BLOCK_RENAMES } from '@endora-commerce/page-builder-core/migration';
import {
  BLOCK_NAME_COLUMNS,
  classifyBlockName,
} from '../../../../packages/modules/cms/src/backend/cli/block-names.js';

/**
 * Feature 096, T411 — the pre-flight report (`contracts/block-name-migration.md`
 * §7).
 *
 * A10 (the report writes nothing) and A11 (its counts equal the migration's
 * rename counts, per column) are asserted here in the two halves each can be
 * asserted in without a database:
 *
 * - **A10 is structural.** The report's only walk is `countBlockNames`, which is
 *   `mapBlockNames` with a visitor that returns `undefined` for every name, and
 *   the file issues `select` and nothing else. Both are asserted below by
 *   reading the source, because "there is no `update` in this file" is a claim
 *   about the file rather than about a run — a run-level checksum would pass on
 *   any input that happened to need no rewrite.
 * - **A11 is the classifier.** Every name the migration renames classifies as
 *   `will-be-renamed` with the migration's own target, and nothing else does.
 *   The two read the same map, so the assertion is that the *classification*
 *   agrees with it, which is the half a shared constant cannot make true by
 *   itself.
 */

const CLI_SOURCE = new URL(
  '../../../../packages/modules/cms/src/backend/cli/block-names.ts',
  import.meta.url,
);

describe('the block-names report', () => {
  it('A10 — writes nothing: the file issues no statement that could', () => {
    const source = readFileSync(CLI_SOURCE, 'utf8');
    // Strip the doc comments before looking for the words, so this file's own
    // explanation of what it does not do cannot be mistaken for a violation.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const forbidden of [/\bupdate\s/i, /\binsert\s/i, /\bdelete\s/i, /\bflush\b/, /\bpersist/]) {
      expect(forbidden.test(code), `${String(forbidden)} appears in the report`).toBe(false);
    }
    expect(code).toContain('countBlockNames');
  });

  it('A11 — classifies exactly the migration’s domain as will-be-renamed, with its target', () => {
    for (const [bare, namespaced] of Object.entries(FROZEN_BLOCK_RENAMES)) {
      expect(classifyBlockName(bare)).toEqual({
        classification: 'will-be-renamed',
        becomes: namespaced,
      });
      // The codomain is what the column holds *after* the migration, and it
      // must read as done rather than as pending.
      expect(classifyBlockName(namespaced).classification).toBe('already-namespaced');
    }
  });

  it('classifies a malformed dotted name as unrecognised rather than waving it through', () => {
    // The ruling of 2026-09-02: `isNamespaced` is the strict test, so
    // `acme.banner` is named to the operator instead of being counted as
    // already done. The migration leaves it alone either way; the difference is
    // whether the operator is told.
    expect(classifyBlockName('acme.banner').classification).toBe('unrecognised');
    expect(classifyBlockName('acme.Banner').classification).toBe('already-namespaced');
    expect(classifyBlockName('NotAKnownBlock').classification).toBe('unrecognised');
  });

  it('reads exactly the columns the five migrations rewrite, in both directions', () => {
    // The report's column list and the migrations' `applyRenameFunctionSql`
    // calls are two statements of one population, made by different authors in
    // different files. A column added to one and not the other is a report that
    // lies about its own coverage, or a migration nothing reports on.
    const files = globSync('../../../../packages/modules/*/src/migrations/*_namespace_block_names.ts', {
      cwd: import.meta.dirname,
    });
    const fromMigrations = new Set<string>();
    for (const file of files) {
      const source = readFileSync(new URL(file, `file://${import.meta.dirname}/`), 'utf8');
      for (const match of source.matchAll(
        /applyRenameFunctionSql\(FN, '([a-z_]+)', '([a-z_]+)'\)/g,
      )) {
        fromMigrations.add(`${match[1]}.${match[2]}`);
      }
    }
    const fromReport = new Set(BLOCK_NAME_COLUMNS.map((c) => `${c.table}.${c.column}`));
    expect([...fromReport].sort()).toEqual([...fromMigrations].sort());
    expect(fromReport.size).toBe(11);
  });
});
