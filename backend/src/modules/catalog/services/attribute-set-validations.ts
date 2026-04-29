/**
 * Pure validation helpers for the AttributeSet domain.
 *
 * Extracted so the rules can be unit-tested without spinning up Postgres
 * (Constitution Principle III: integration tests hit the real DB; unit
 * tests stay deterministic and fast).
 *
 * Implementation lands in T022; this file currently exposes the type
 * surface and stubs that throw `not implemented` so the failing unit
 * test (T010) compiles.
 */

export type AttributeSetValidationCode =
  | 'SYSTEM_ATTRIBUTE_SET_IMMUTABLE'
  | 'ATTRIBUTE_SET_IN_USE';

export class AttributeSetValidationError extends Error {
  constructor(
    message: string,
    public readonly code: AttributeSetValidationCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AttributeSetValidationError';
  }
}

export interface SystemSetMarker {
  isSystem: boolean;
  code: string;
}

/**
 * Reject any attempt to change the `code` of a system Attribute Set.
 * Renaming the localized `name` of the Default set is permitted; only
 * the `code` (a stable integration key) is immutable.
 *
 * Throws AttributeSetValidationError with code SYSTEM_ATTRIBUTE_SET_IMMUTABLE.
 */
export function assertCodeNotImmutable(
  currentSet: SystemSetMarker,
  newCode: string | undefined,
): void {
  void currentSet;
  void newCode;
  throw new Error('not implemented');
}

/**
 * Reject deletion of an Attribute Set that has at least one Product
 * pointing to it. Caller passes `productCount` aggregated from a count
 * query against `products.attribute_set_id`.
 *
 * Throws AttributeSetValidationError with code ATTRIBUTE_SET_IN_USE
 * (and `details: { productCount }`) when productCount > 0.
 */
export function assertNotInUse(productCount: number): void {
  void productCount;
  throw new Error('not implemented');
}

export interface AttributePartition {
  /** Attribute keys preserved as live values (still in the new Set). */
  preservedKeys: string[];
  /** Attribute keys whose values are kept as archival (no longer editable). */
  archivedKeys: string[];
}

/**
 * Decide which attribute values on a Product survive a Set swap and which
 * become archival. Spec §"Edge Cases" / §1.1 Assumptions:
 *
 *   - Keys present in BOTH old and new Set → preserved (still editable).
 *   - Keys present ONLY in old Set → archived (not editable, not displayed,
 *     but kept in `attribute_values` JSONB until either re-added or
 *     explicitly cleared by the admin).
 *   - Keys present ONLY in new Set → not in current values; product is
 *     marked as needing backfill (out of scope for this helper — caller
 *     handles).
 *
 * Returns the partition of currently-set keys into preserved vs archived.
 */
export function partitionAttributesForSetChange(
  currentValueKeys: string[],
  oldSetAttributeKeys: string[],
  newSetAttributeKeys: string[],
): AttributePartition {
  void currentValueKeys;
  void oldSetAttributeKeys;
  void newSetAttributeKeys;
  throw new Error('not implemented');
}
