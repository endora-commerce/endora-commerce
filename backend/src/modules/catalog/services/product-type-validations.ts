/**
 * Pure validation helpers for the Product type domain (feature 002,
 * data-model.md §1.1).
 *
 * Implementation lands in T047. This module currently exposes only
 * the type surface and stubs that throw `not implemented` so the
 * failing unit test (T040) compiles.
 */

export type ProductTypeValidationCode =
  | 'CONFIGURABLE_REQUIRES_VARIANT'
  | 'VIRTUAL_DOWNLOAD_EXACTLY_ONE'
  | 'NON_VIRTUAL_HAS_DOWNLOAD_FIELDS';

export class ProductTypeValidationError extends Error {
  constructor(
    message: string,
    public readonly code: ProductTypeValidationCode,
  ) {
    super(message);
    this.name = 'ProductTypeValidationError';
  }
}

export interface ProductTypeForVariantCheck {
  type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  variantCount: number;
}

/**
 * Reject a configurable Product that has zero variants. Other types
 * are accepted regardless of `variantCount`.
 *
 * Throws ProductTypeValidationError with code
 * CONFIGURABLE_REQUIRES_VARIANT.
 */
export function assertConfigurableHasVariants(
  _input: ProductTypeForVariantCheck,
): void {
  throw new Error('not implemented');
}

export interface ProductTypeForDownloadCheck {
  type: 'simple' | 'configurable' | 'grouped' | 'bundle' | 'virtual';
  downloadAssetId: string | null;
  downloadUrl: string | null;
}

/**
 * Cross-field validation of `downloadAssetId` / `downloadUrl` against
 * the Product type:
 *   - virtual: exactly one of the two MUST be set.
 *   - non-virtual: BOTH MUST be null.
 *
 * Throws ProductTypeValidationError with one of:
 *   - VIRTUAL_DOWNLOAD_EXACTLY_ONE
 *   - NON_VIRTUAL_HAS_DOWNLOAD_FIELDS
 */
export function assertVirtualDownloadFields(
  _input: ProductTypeForDownloadCheck,
): void {
  throw new Error('not implemented');
}
