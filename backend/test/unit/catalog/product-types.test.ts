import { describe, expect, it } from 'vitest';

/**
 * T040 — pure unit tests over Product-type domain invariants from
 * feature 002 (data-model.md §1.1). Three rules:
 *
 *  1. type='configurable' MUST have ≥ 1 Variant before status can move
 *     beyond `draft`. (Enforced by service; tested as the boolean
 *     predicate that the service uses.)
 *  2. type='virtual' MUST have exactly one of `downloadAssetId` /
 *     `downloadUrl`. Both NULL or both set ⇒ INVALID.
 *  3. Non-virtual products MUST have BOTH download fields NULL.
 *
 * The functions live in a sibling pure module so they're unit-testable
 * without an EM (Constitution Principle III: integration tests hit
 * Postgres; unit tests stay fast and deterministic).
 *
 * NOTE: target module `product-type-validations.ts` doesn't exist yet —
 * this test file imports it as a stub. It will fail to compile until
 * T047 ships the helper. That IS the intended TDD red state.
 */

import {
  assertConfigurableHasVariants,
  assertVirtualDownloadFields,
  ProductTypeValidationError,
  type ProductTypeForVariantCheck,
  type ProductTypeForDownloadCheck,
} from '../../../src/modules/catalog/services/product-type-validations.js';

describe('assertConfigurableHasVariants (T040)', () => {
  it('passes when type is not "configurable" (regardless of variant count)', () => {
    const cases: ProductTypeForVariantCheck[] = [
      { type: 'simple', variantCount: 0 },
      { type: 'grouped', variantCount: 0 },
      { type: 'virtual', variantCount: 0 },
      { type: 'bundle', variantCount: 0 },
    ];
    for (const c of cases) {
      expect(() => assertConfigurableHasVariants(c)).not.toThrow();
    }
  });

  it('passes when type=configurable and at least one variant exists', () => {
    expect(() =>
      assertConfigurableHasVariants({ type: 'configurable', variantCount: 1 }),
    ).not.toThrow();
    expect(() =>
      assertConfigurableHasVariants({ type: 'configurable', variantCount: 99 }),
    ).not.toThrow();
  });

  it('rejects type=configurable with zero variants (CONFIGURABLE_REQUIRES_VARIANT)', () => {
    let caught: unknown;
    try {
      assertConfigurableHasVariants({ type: 'configurable', variantCount: 0 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductTypeValidationError);
    expect((caught as ProductTypeValidationError).code).toBe(
      'CONFIGURABLE_REQUIRES_VARIANT',
    );
  });
});

describe('assertVirtualDownloadFields (T040)', () => {
  it('rejects type=virtual with BOTH downloadAssetId and downloadUrl null', () => {
    const input: ProductTypeForDownloadCheck = {
      type: 'virtual',
      downloadAssetId: null,
      downloadUrl: null,
    };
    expect(() => assertVirtualDownloadFields(input)).toThrow(
      ProductTypeValidationError,
    );
  });

  it('rejects type=virtual with BOTH downloadAssetId and downloadUrl set', () => {
    const input: ProductTypeForDownloadCheck = {
      type: 'virtual',
      downloadAssetId: '00000000-0000-4000-8000-000000000aaa',
      downloadUrl: 'https://files.example.com/ebook.pdf',
    };
    let caught: unknown;
    try {
      assertVirtualDownloadFields(input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProductTypeValidationError);
    expect((caught as ProductTypeValidationError).code).toBe(
      'VIRTUAL_DOWNLOAD_EXACTLY_ONE',
    );
  });

  it('passes type=virtual with only downloadAssetId', () => {
    expect(() =>
      assertVirtualDownloadFields({
        type: 'virtual',
        downloadAssetId: '00000000-0000-4000-8000-000000000aaa',
        downloadUrl: null,
      }),
    ).not.toThrow();
  });

  it('passes type=virtual with only downloadUrl', () => {
    expect(() =>
      assertVirtualDownloadFields({
        type: 'virtual',
        downloadAssetId: null,
        downloadUrl: 'https://files.example.com/ebook.pdf',
      }),
    ).not.toThrow();
  });

  it('rejects non-virtual type with ANY download field set', () => {
    const cases: Array<ProductTypeForDownloadCheck['type']> = [
      'simple',
      'configurable',
      'grouped',
      'bundle',
    ];
    for (const type of cases) {
      let caught: unknown;
      try {
        assertVirtualDownloadFields({
          type,
          downloadAssetId: null,
          downloadUrl: 'https://files.example.com/x',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ProductTypeValidationError);
      expect((caught as ProductTypeValidationError).code).toBe(
        'NON_VIRTUAL_HAS_DOWNLOAD_FIELDS',
      );
    }
  });

  it('passes non-virtual type with both download fields null', () => {
    const cases: Array<ProductTypeForDownloadCheck['type']> = [
      'simple',
      'configurable',
      'grouped',
      'bundle',
    ];
    for (const type of cases) {
      expect(() =>
        assertVirtualDownloadFields({
          type,
          downloadAssetId: null,
          downloadUrl: null,
        }),
      ).not.toThrow();
    }
  });
});
