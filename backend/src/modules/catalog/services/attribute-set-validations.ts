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
  if (!currentSet.isSystem) return;
  if (newCode === undefined) return;
  if (newCode === currentSet.code) return;
  throw new AttributeSetValidationError(
    `Cannot change code of the system Attribute Set "${currentSet.code}".`,
    'SYSTEM_ATTRIBUTE_SET_IMMUTABLE',
  );
}

/**
 * Reject deletion of an Attribute Set that has at least one Product
 * pointing to it. Caller passes `productCount` aggregated from a count
 * query against `products.attribute_set_id`.
 *
 * Throws AttributeSetValidationError with code ATTRIBUTE_SET_IN_USE
 * (and `details: { productCount }`) when productCount > 0.
 *
 * Defensive on negative or fractional inputs: anything other than
 * exactly `0` is treated as "in use". A negative count is nonsense from
 * the caller's side, but we'd rather refuse the delete than silently
 * allow it.
 */
export function assertNotInUse(productCount: number): void {
  if (productCount === 0) return;
  throw new AttributeSetValidationError(
    `Attribute Set is referenced by ${productCount} Product(s).`,
    'ATTRIBUTE_SET_IN_USE',
    { productCount },
  );
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
  const oldSet = new Set(oldSetAttributeKeys);
  const newSet = new Set(newSetAttributeKeys);
  const preservedKeys: string[] = [];
  const archivedKeys: string[] = [];
  for (const key of currentValueKeys) {
    if (!oldSet.has(key)) {
      // Orphan — wasn't in the old Set either; partition does not move it.
      continue;
    }
    if (newSet.has(key)) {
      preservedKeys.push(key);
    } else {
      archivedKeys.push(key);
    }
  }
  return { preservedKeys, archivedKeys };
}
