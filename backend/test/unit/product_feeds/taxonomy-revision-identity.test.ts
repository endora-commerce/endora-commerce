import { describe, expect, it } from 'vitest';
import {
  combineContentHashes,
  compareToInstalledNodeSet,
  deriveRevisionLabel,
  normaliseTaxonomyContent,
  taxonomyContentHash,
  withCollisionSuffix,
} from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-revision-identity.js';
import {
  buildTaxonomyNodes,
  parseTaxonomyFile,
  parseTaxonomyHeader,
} from '../../../../packages/modules/product_feeds/src/backend/services/taxonomy-file-parser.js';

/**
 * Feature 067 Phase 11 / T121 — revision identity (FR-088, research §R20).
 *
 * The question is never "are these bytes identical" — a CDN edge that adds a
 * trailing newline or re-encodes a BOM produces different bytes and an
 * identical taxonomy. Installing that would put a row in front of the operator
 * whose impact preview reads "0 changes", which trains people to promote
 * without reading. So the authoritative comparison is the parsed **node set**,
 * and the hash is the cheap gate in front of it.
 */

const GOOGLE = [
  '# Google_Product_Taxonomy_Version: 2026-05-14',
  '1 - Animals & Pet Supplies',
  '3237 - Animals & Pet Supplies > Live Animals',
  '2 - Apparel & Accessories',
].join('\n');

const META = ['category_id,category', '101,food & beverages', '102,food & beverages > food'].join(
  '\n',
);

function nodesOf(content: string): ReturnType<typeof buildTaxonomyNodes> {
  return buildTaxonomyNodes([{ language: 'en', lines: parseTaxonomyFile(content) }]);
}

describe('parseTaxonomyHeader', () => {
  it('captures Google’s stamped revision label', () => {
    expect(parseTaxonomyHeader(GOOGLE)).toBe('2026-05-14');
  });

  it('tolerates a BOM, extra whitespace and a lower-case header key', () => {
    expect(parseTaxonomyHeader('﻿#   google_product_taxonomy_version:   2021-09-21  \n1 - A')).toBe(
      '2021-09-21',
    );
  });

  it('answers null where the provider stamps nothing (Meta)', () => {
    expect(parseTaxonomyHeader(META)).toBeNull();
  });

  it('does not change what `parseTaxonomyFile` sees', () => {
    // The header is a comment line; capturing it must not make it a node.
    expect(parseTaxonomyFile(GOOGLE).map((line) => line.externalId)).toEqual([
      '1',
      '3237',
      '2',
    ]);
  });
});

describe('content identity', () => {
  it('normalises away a BOM and CRLF so the hash is stable', () => {
    const lf = '1 - Animals\n2 - Apparel\n';
    const crlf = '﻿1 - Animals\r\n2 - Apparel\r\n';
    expect(normaliseTaxonomyContent(crlf)).toBe(normaliseTaxonomyContent(lf));
    expect(taxonomyContentHash(crlf)).toBe(taxonomyContentHash(lf));
  });

  it('combines the two language hashes into one per-revision identity', () => {
    const combined = combineContentHashes('aa', 'bb');
    expect(combined).toMatch(/^[0-9a-f]{64}$/);
    expect(combined).not.toBe(combineContentHashes('bb', 'aa'));
  });

  it('is not fooled into calling different content the same', () => {
    expect(taxonomyContentHash('1 - Animals')).not.toBe(taxonomyContentHash('1 - Apparel'));
  });
});

describe('deriveRevisionLabel (FR-088)', () => {
  it('uses Google’s own published label when the file stamps one', () => {
    expect(
      deriveRevisionLabel({
        providerCode: 'google_merchant',
        headerLabel: parseTaxonomyHeader(GOOGLE),
        contentHash: 'deadbeefcafebabe'.repeat(4),
        fetchedAt: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toBe('2026-05-14');
  });

  it('derives `YYYY-MM-DD-<hash8>` where the provider publishes none (Meta)', () => {
    expect(
      deriveRevisionLabel({
        providerCode: 'meta',
        headerLabel: null,
        contentHash: '9f3a1c04' + '0'.repeat(56),
        fetchedAt: new Date('2026-08-14T10:22:00Z'),
      }),
    ).toBe('2026-08-14-9f3a1c04');
  });

  it('falls back to the derived label when Google forgets its header', () => {
    const label = deriveRevisionLabel({
      providerCode: 'google_merchant',
      headerLabel: null,
      contentHash: 'abcdef01' + '0'.repeat(56),
      fetchedAt: new Date('2026-08-14T10:22:00Z'),
    });
    expect(label).toBe('2026-08-14-abcdef01');
  });

  it('never exceeds the column’s 32 characters', () => {
    const label = deriveRevisionLabel({
      providerCode: 'google_merchant',
      headerLabel: 'x'.repeat(80),
      contentHash: '0'.repeat(64),
      fetchedAt: new Date('2026-08-14T10:22:00Z'),
    });
    expect(label.length).toBeLessThanOrEqual(32);
  });
});

describe('withCollisionSuffix', () => {
  it('leaves a free label alone', () => {
    expect(withCollisionSuffix('2026-05-14', new Set())).toBe('2026-05-14');
  });

  it('installs republished content under `<label>-r2`, then `-r3` (research §R20)', () => {
    // An installed revision is immutable — mappings, checks and audit entries
    // reference it — so rewriting one in place is never an option.
    expect(withCollisionSuffix('2026-05-14', new Set(['2026-05-14']))).toBe('2026-05-14-r2');
    expect(withCollisionSuffix('2026-05-14', new Set(['2026-05-14', '2026-05-14-r2']))).toBe(
      '2026-05-14-r3',
    );
  });
});

describe('compareToInstalledNodeSet (the authoritative comparison)', () => {
  const installed = nodesOf(GOOGLE).map((node) => ({
    externalId: node.externalId,
    parentExternalId: node.parentExternalId,
    fullPath: node.fullPath['en'] ?? '',
  }));

  it('calls a trailing-newline-only difference `unchanged`', () => {
    expect(compareToInstalledNodeSet(nodesOf(`${GOOGLE}\n\n`), installed)).toBe('unchanged');
  });

  it('calls a CRLF/BOM-only difference `unchanged`', () => {
    const cosmetic = `﻿${GOOGLE.split('\n').join('\r\n')}`;
    expect(compareToInstalledNodeSet(nodesOf(cosmetic), installed)).toBe('unchanged');
  });

  it('calls a genuinely different tree `changed`', () => {
    const withNewNode = `${GOOGLE}\n4 - Arts & Entertainment`;
    expect(compareToInstalledNodeSet(nodesOf(withNewNode), installed)).toBe('changed');
  });

  it('notices a renamed path even when every id survives', () => {
    const renamed = GOOGLE.replace('Live Animals', 'Living Animals');
    expect(compareToInstalledNodeSet(nodesOf(renamed), installed)).toBe('changed');
  });

  it('calls anything `changed` when there is nothing installed to compare against', () => {
    expect(compareToInstalledNodeSet(nodesOf(GOOGLE), [])).toBe('changed');
  });
});
