import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * Feature 012 / T068 — Audit guardrail.
 *
 * Migration 032 retired the legacy `product_attributes.enum_values` JSONB
 * column. Every reader was migrated to the new `attribute_options` table
 * (or its API projection). The legacy `enumValues` field name is retained
 * deliberately in a small allowlist of files for backward compatibility:
 *
 *   - Foundation migration 001 (the original CREATE TABLE)
 *   - Migration 032 itself (the migrate-and-drop step)
 *   - `attribute-type-mapping.ts` (DTO ↔ DB conversion at the API
 *     boundary — keeps the legacy form acceptable from external clients)
 *   - `catalog-admin.service.ts` + `routes.admin.ts` (write-side accept
 *     legacy `enumValues` and materialise into `attribute_options`;
 *     read-side projects the option list back to legacy shape)
 *   - `product-attribute.entity.ts` (doc comment about the dropped column)
 *   - `dev-catalog-seed.ts` (comment explaining the schema reshape)
 *   - `packages/contracts/src/catalog.ts` (legacy field on the request
 *     schema; deprecated input)
 *   - `admin/src/modules/catalog/AttributesManager.tsx` (legacy
 *     projection support; visual editor for the new options table is
 *     a follow-up admin-UI iteration)
 *
 * This test fails when a NEW occurrence of `enumValues` / `enum_values`
 * appears outside the allowlist, signalling that the migration's intent
 * is being undone.
 */

const allowlist = [
  // Foundation + the migration itself
  'backend/src/db/migrations/20260424T165847_core_foundation_init.ts',
  'backend/src/modules/catalog/migrations/20260505T060113_catalog_attribute_options_and_flags.ts',
  // Boundary helpers — accept + project the legacy shape
  'backend/src/modules/catalog/services/attribute-type-mapping.ts',
  'backend/src/modules/catalog/services/catalog-admin.service.ts',
  'backend/src/modules/catalog/services/catalog-query.service.ts',
  // Feature 061 — the attribute create Command inherits the write-side
  // legacy `enumValues` acceptance from catalog-admin.service.ts.
  'backend/src/modules/catalog/commands/attribute-commands.ts',
  'backend/src/modules/catalog/routes.admin.ts',
  'backend/src/modules/catalog/entities/product-attribute.entity.ts',
  'backend/src/seeds/dev-catalog-seed.ts',
  // Contracts package — deprecated request field
  'packages/contracts/src/catalog.ts',
  // Admin UI — backward-compatible projection
  'admin/src/modules/catalog/AttributesManager.tsx',
];

describe('no-new enumValues / enum_values references (T068)', () => {
  it('does not introduce new enumValues outside the documented allowlist', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
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

    const offenders = output
      .split('\n')
      .filter((line) => line.length > 0)
      .filter((file) => !allowlist.includes(file));

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
});
