// Feature 096, T412 — three of the four assertions `contracts/block-name-check.md`
// §9 requires of the frozen map.
//
// **The fourth lives elsewhere, and the reason is structural rather than a
// preference.** Assertion 1 — every value is a name some module's manifest
// declares — needs the manifests, and every module package depends on this one.
// A test here that imported `@endora-commerce/mod-cms` would put a cycle in the
// dependency graph to answer a question the backend can already ask, so it is
// asked there instead: `backend/test/unit/cms/frozen-block-renames-codomain.test.ts`,
// over `REGISTERED_MANIFESTS`, which is the same population every module walk in
// this repository reads.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blockNameRe } from '@endora-commerce/contracts/cms';
import { FROZEN_BLOCK_RENAMES, FROZEN_BLOCK_RENAMES_INVERSE } from './frozen-block-renames.js';

/**
 * The digest of the map's entries, in declaration order.
 *
 * **Never re-record this to make a run pass.** An entry that changes changes
 * what five applied migrations meant: a database migrated under the old entry
 * keeps the old name, a database migrated after the edit gets the new one, and
 * nothing reconciles the two. The map is closed (FR-016) — a block born after
 * this feature is namespaced from birth and has no entry here — so there is no
 * legitimate reason for this constant to move.
 */
const FROZEN_DIGEST = '35e67094d49e97566beb9a9cdd45bb92be306e3bdda04ed9cf180fbbf41d4bf8';

describe('FROZEN_BLOCK_RENAMES', () => {
  it('is frozen — the digest over its entries has not moved', () => {
    const digest = createHash('sha256')
      .update(
        Object.entries(FROZEN_BLOCK_RENAMES)
          .map(([bare, namespaced]) => `${bare}=${namespaced}`)
          .join('\n'),
      )
      .digest('hex');
    expect(digest).toBe(FROZEN_DIGEST);
  });

  it('holds the 74 pre-096 names and no more — the domain is closed', () => {
    const keys = Object.keys(FROZEN_BLOCK_RENAMES);
    expect(keys).toHaveLength(74);
    expect(new Set(keys).size).toBe(74);
    for (const key of keys) {
      expect(key, `${key} is a pre-096 bare name and carries no separator`).not.toContain('.');
    }
  });

  it('is a bijection onto well-formed namespaced names, disjoint from its own domain', () => {
    const values = Object.values(FROZEN_BLOCK_RENAMES);
    expect(new Set(values).size, 'two keys sharing a value would make down() ambiguous').toBe(
      values.length,
    );
    for (const value of values) {
      expect(blockNameRe.test(value), `${value} is a well-formed block name`).toBe(true);
    }
    // Disjointness is what makes the rename idempotent by construction: a second
    // run looks every already-renamed name up in the map and finds nothing.
    const domain = new Set(Object.keys(FROZEN_BLOCK_RENAMES));
    for (const value of values) {
      expect(domain.has(value), `${value} must not also be a key`).toBe(false);
    }
  });

  it('renames in place but for one entry, whose local segment moved', () => {
    // 73 of the 74 are the stored name with an owner in front of it. The
    // exception is `InvoiceKsef` -> `ksef.InvoiceSection` (`data-model.md`
    // §7.3): the owner ruling of 2026-09-02 gave the block to `ksef`, and
    // `ksef.InvoiceKsef` would have stuttered the owner into the local name.
    const moved = Object.entries(FROZEN_BLOCK_RENAMES).filter(
      ([bare, namespaced]) => namespaced.slice(namespaced.indexOf('.') + 1) !== bare,
    );
    expect(moved).toEqual([['InvoiceKsef', 'ksef.InvoiceSection']]);
  });

  it('inverts exactly', () => {
    expect(Object.keys(FROZEN_BLOCK_RENAMES_INVERSE)).toHaveLength(74);
    for (const [bare, namespaced] of Object.entries(FROZEN_BLOCK_RENAMES)) {
      expect(FROZEN_BLOCK_RENAMES_INVERSE[namespaced]).toBe(bare);
    }
  });
});
