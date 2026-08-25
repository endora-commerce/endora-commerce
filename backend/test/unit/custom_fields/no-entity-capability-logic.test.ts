import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * SC-005 / FR-006 — the generic custom-fields core MUST contain no entity-specific
 * capability logic. This asserts none of the catalog-only attribute flags leak
 * into the module source (they belong behind host extension points via `config`).
 */

/**
 * The module's own directory, **resolved** rather than spelled: `custom_fields`
 * became a workspace package in feature 080's T040b, and a literal
 * `src/modules/custom_fields` is an `ENOENT` the day it moves rather than a
 * narrowed scan — loud, but for the wrong reason.
 */
const layout = await requireModuleLayout('[custom-fields-entity-agnostic]');
const MODULE_ROOT = layout.moduleDirectoryOf('custom_fields');
if (MODULE_ROOT === null) {
  throw new Error('[custom-fields-entity-agnostic] no such module: custom_fields');
}

// Catalog-only capability identifiers that must NOT appear in the generic core.
const FORBIDDEN = [
  'isVariantAxis',
  'isPromoRule',
  'filterPosition',
  'isVisibleOnProductPage',
  'channelScoped',
  'languageScoped',
  'quickSearchable',
  'massEditable',
];

/**
 * `dist` and `node_modules` are skipped, and that is a consequence of resolving
 * the root rather than spelling it: a package's directory holds its **build**,
 * whose `.d.ts` files end in `.ts` and are a second copy of every source line.
 * Left in, the walk reports each finding twice and a *repaired* source still
 * fails until somebody rebuilds — a verdict about a stale artefact wearing this
 * rule's clothes. Every module walk in the estate skips both by name for the
 * same reason (`scripts/lib/module-roots.ts`).
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('custom-fields core is entity-agnostic (SC-005 / FR-006)', () => {
  it('contains none of the catalog-specific capability identifiers', () => {
    const offenders: string[] = [];
    for (const file of walk(MODULE_ROOT)) {
      const src = readFileSync(file, 'utf8');
      for (const flag of FORBIDDEN) {
        if (src.includes(flag)) offenders.push(`${file}: ${flag}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
