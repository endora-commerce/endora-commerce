import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * SC-005 / FR-006 — the generic custom-fields core MUST contain no entity-specific
 * capability logic. This asserts none of the catalog-only attribute flags leak
 * into the module source (they belong behind host extension points via `config`).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const MODULE_ROOT = join(HERE, '../../../src/modules/custom_fields');

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

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
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
