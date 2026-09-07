import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Feature 012 / T068 — Audit guardrail.
 *
 * Migration 032 retired the legacy `product_attributes.enum_values` JSONB
 * column. Every reader was migrated to the new `attribute_options` table (or
 * its API projection). The legacy `enumValues` field name survives in a small
 * set of files, each of which is a boundary that still has to speak the old
 * shape, and this test fails when a NEW occurrence appears outside that set —
 * the signal that the migration's intent is being undone.
 *
 * ## The ledger is two-way (feature 091 fallout)
 *
 * It was an allow-list: an unlisted file failed, and an entry that had stopped
 * describing anything did not. That is the half that rots, and it rotted twice
 * over, in both of the ways AGENTS.md names.
 *
 * Silently: four entries — `attribute-type-mapping.ts`, `catalog-query.service.ts`,
 * `product-attribute.entity.ts` and `dev-catalog-seed.ts` — named files that no
 * longer mention the legacy field at all. Each was a permission nobody needed,
 * standing on a claim the tree had stopped backing, and nothing in this
 * repository could say so.
 *
 * Loudly, and for the wrong reason: feature 091's admin drain moved
 * `AttributesManager.tsx` from `admin/src/modules/catalog/` into
 * `packages/modules/catalog/src/admin/pages/`, and the one-way ledger reported
 * the arrival as a **new offender** while saying nothing about the departure.
 * A reader is told a boundary was added when a file was relocated — which is
 * exactly *"the batch that frees an entry is structurally the batch that cannot
 * see it go stale"*, arriving here for the first time. With both directions
 * live, the drain batch would have seen one stale entry and one new offender in
 * the same run, which reads as the relocation it is.
 *
 * ## The key stays the path, deliberately
 *
 * A path key is what the drain destabilised, so the question is fair; the
 * answer is that nothing stabler describes this subject. The entry's claim is
 * *"this file is a boundary that may speak the legacy shape"*, and a file has
 * no identity here other than where it is: a content digest — the shape
 * `check:module-boundary`'s ledger uses, where the subject is a **reach** and
 * survives an edit above it — would go stale on every unrelated line of these
 * files, which is strictly worse; a module id plus a basename cannot tell two
 * `routes.admin.ts` apart across layers, and this file already carries entries
 * from four owners (core migrations, `catalog`, `contracts`, the admin). What
 * was missing was never the key. It was the second direction, which turns a
 * relocation into two findings that describe each other.
 *
 * The walk itself is not allowed to come back empty (issue #113): the whole
 * ledger describing nothing is the moved-tree state, not a clean tree.
 */
const allowlist = [
  // Foundation + the migration itself
  'backend/src/db/migrations/20260424T165847_core_foundation_init.ts',
  'packages/modules/catalog/src/migrations/20260505T060113_catalog_attribute_options_and_flags.ts',
  // Boundary helpers — accept + project the legacy shape
  'packages/modules/catalog/src/backend/services/catalog-admin.service.ts',
  // Feature 061 — the attribute create Command inherits the write-side
  // legacy `enumValues` acceptance from catalog-admin.service.ts.
  'packages/modules/catalog/src/backend/commands/attribute-commands.ts',
  'packages/modules/catalog/src/backend/routes.admin.ts',
  // Contracts package — deprecated request field
  'packages/contracts/src/catalog.ts',
  // Admin UI — backward-compatible projection. Feature 091's Phase 4 moved this
  // screen out of `admin/src/modules/catalog/` and into the module package that
  // owns it; the permission is unmoved, only its address.
  'packages/modules/catalog/src/admin/pages/AttributesManager.tsx',
];

function filesNamingTheLegacyField(repoRoot: string): string[] {
  let output = '';
  try {
    output = execSync(
      // -l = files with matches; --include limits to TS sources;
      // exclude tests + node_modules; case-sensitive.
      `grep -rIl --include='*.ts' --include='*.tsx' \
        --exclude-dir=node_modules \
        --exclude-dir=dist \
        --exclude-dir=test \
        'enumValues\\|enum_values' \
        backend/src admin/src storefront packages || true`,
      { cwd: repoRoot, encoding: 'utf8' },
    ).trim();
  } catch {
    // grep returns non-zero when no match; treat as "no offenders".
    output = '';
  }
  return output.split('\n').filter((line) => line.length > 0);
}

describe('no-new enumValues / enum_values references (T068)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const matches = filesNamingTheLegacyField(repoRoot);

  it('read something — an empty walk is a moved tree, not a clean one', () => {
    // The ledger's own entries are the independent expectation: every one of
    // them names a file that has to be in the walk's output, so a walk that
    // stopped reaching these directories is a red here rather than a silent
    // `offenders === []`.
    expect(matches.length).toBeGreaterThan(0);
  });

  it('does not introduce new enumValues outside the documented allowlist', () => {
    const offenders = matches.filter((file) => !allowlist.includes(file));

    if (offenders.length > 0) {
      // Surface every new offender to make remediation obvious.
      throw new Error(
        `Feature 012 / T068 — new enumValues / enum_values references outside the allowlist:\n` +
          offenders.map((f) => `  - ${f}`).join('\n') +
          `\n\nMigration 032 retired the column; every reader must go through ` +
          `the attribute_options table (or its API projection). Update the file ` +
          `or, if the reference is intentional, add it to the allowlist in this ` +
          `test (with a one-line justification).`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('holds no entry the tree has stopped backing', () => {
    const stale = allowlist.filter((file) => !matches.includes(file));

    if (stale.length > 0) {
      throw new Error(
        `Feature 012 / T068 — allowlist entries that describe nothing:\n` +
          stale.map((f) => `  - ${f}`).join('\n') +
          `\n\nEither the legacy field was removed from the file — delete the ` +
          `entry — or the file moved, in which case the offender reported above ` +
          `is this same permission at its new address and the entry is to be ` +
          `re-pointed, not added.`,
      );
    }
    expect(stale).toEqual([]);
  });
});
