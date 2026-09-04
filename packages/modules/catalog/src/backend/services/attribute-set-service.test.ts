import { describe, expect, it } from 'vitest';

import {
  assertCodeNotImmutable,
  assertNotInUse,
  partitionAttributesForSetChange,
  AttributeSetValidationError,
} from './attribute-set-validations.js';

/**
 * T010 — pure unit tests over the AttributeSetService domain invariants
 * (specs/002-catalog-module/data-model.md §2.1, §2.2).
 *
 * The validations live in their own pure module so this test stays free
 * of EM/Postgres setup. The persistence-side of the service is covered
 * by the integration test (T012).
 *
 * Per Constitution Principle III: written FIRST. Stubs throw
 * `not implemented`; impl lands in T022.
 */

describe('assertCodeNotImmutable (T010)', () => {
  it('allows code change on a non-system Set', () => {
    expect(() =>
      assertCodeNotImmutable({ isSystem: false, code: 'electronics' }, 'apparel'),
    ).not.toThrow();
  });

  it('allows omitting the code change on a system Set', () => {
    // PATCH without `code` — name-only update — is fine for the Default Set.
    expect(() =>
      assertCodeNotImmutable({ isSystem: true, code: 'default' }, undefined),
    ).not.toThrow();
  });

  it('allows passing the same code on a system Set (no-op)', () => {
    expect(() =>
      assertCodeNotImmutable({ isSystem: true, code: 'default' }, 'default'),
    ).not.toThrow();
  });

  it('rejects renaming the code of a system Set with SYSTEM_ATTRIBUTE_SET_IMMUTABLE', () => {
    let caught: unknown;
    try {
      assertCodeNotImmutable({ isSystem: true, code: 'default' }, 'something_else');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AttributeSetValidationError);
    expect((caught as AttributeSetValidationError).code).toBe(
      'SYSTEM_ATTRIBUTE_SET_IMMUTABLE',
    );
  });
});

describe('assertNotInUse (T010)', () => {
  it('allows deletion when no Products reference the Set', () => {
    expect(() => assertNotInUse(0)).not.toThrow();
  });

  it('rejects deletion when at least one Product points to the Set with ATTRIBUTE_SET_IN_USE', () => {
    let caught: unknown;
    try {
      assertNotInUse(7);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AttributeSetValidationError);
    expect((caught as AttributeSetValidationError).code).toBe(
      'ATTRIBUTE_SET_IN_USE',
    );
    // The error MUST surface the count so the admin sees what's blocking.
    expect((caught as AttributeSetValidationError).details).toEqual({
      productCount: 7,
    });
  });

  it('treats negative or fractional counts defensively (still > 0 ⇒ throw)', () => {
    expect(() => assertNotInUse(0.0001)).toThrow(AttributeSetValidationError);
    // < 0 is nonsense from the caller's side, but if it ever leaks through,
    // we'd rather not silently allow deletion. Choosing the conservative
    // branch: anything not exactly 0 is treated as "in use".
    expect(() => assertNotInUse(-1)).toThrow(AttributeSetValidationError);
  });
});

describe('partitionAttributesForSetChange (T010)', () => {
  it('returns empty partitions when product has no attribute values', () => {
    expect(
      partitionAttributesForSetChange(
        [],
        ['color', 'size'],
        ['color', 'material'],
      ),
    ).toEqual({ preservedKeys: [], archivedKeys: [] });
  });

  it('preserves keys present in both old and new Set', () => {
    expect(
      partitionAttributesForSetChange(
        ['color', 'size'],
        ['color', 'size', 'material'],
        ['color', 'size', 'weight'],
      ),
    ).toEqual({ preservedKeys: ['color', 'size'], archivedKeys: [] });
  });

  it('archives keys present only in old Set', () => {
    expect(
      partitionAttributesForSetChange(
        ['color', 'size', 'weight'],
        ['color', 'size', 'weight'],
        ['color'],
      ),
    ).toEqual({ preservedKeys: ['color'], archivedKeys: ['size', 'weight'] });
  });

  it('ignores currently-set keys that were never in the old Set (orphan data)', () => {
    // Defensive: a value that wasn't even in the old Set is treated as orphan.
    // We do NOT archive it — the caller can clean it up if needed; partition
    // only deals with rule-bound moves.
    expect(
      partitionAttributesForSetChange(
        ['color', 'rogue'],
        ['color'],
        ['color', 'material'],
      ),
    ).toEqual({ preservedKeys: ['color'], archivedKeys: [] });
  });

  it('returns archivedKeys in stable, deterministic order', () => {
    const out = partitionAttributesForSetChange(
      ['z_last', 'a_first', 'm_mid'],
      ['z_last', 'a_first', 'm_mid'],
      [],
    );
    // Stable order = order of appearance in `currentValueKeys`.
    expect(out.archivedKeys).toEqual(['z_last', 'a_first', 'm_mid']);
  });
});
