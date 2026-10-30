import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Feature 155 (FR-026, FR-027; research R13.1; `contracts/quote-requests-api.md`
 * §1) — which catalogue packaging unit a buyer's quote line is ordered in.
 *
 * Pure: the caller reads the units with one `listPackagingUnitsByProductIds`
 * over the product ids `#acquirableProductsById` has already vetted (threat
 * F12), and runs this before anything is priced or written (FR-029).
 */

/** The packaging part of a buyer's line, as sent. */
export interface PackagingReferenceLine {
  productId: string;
  packagingUnitId?: string | undefined;
  packagingUnitName?: string | undefined;
  packagingUnitBaseQuantity?: number | undefined;
}

/** The fields of a catalogue packaging unit the resolution reads. */
export interface PackagingUnitCandidate {
  id: string;
  productId: string;
  name: string;
  baseQuantity: number;
}

/** What a line stores: the catalogue's unit, or plain pieces (all `null`). */
export interface ResolvedPackaging {
  packagingUnitId: string | null;
  packagingUnitName: string | null;
  packagingUnitBaseQuantity: number | null;
}

/** The external reason of a refused line (`contracts/error-codes.md`). */
export type PackagingMismatchReason = 'unknown_unit' | 'name_unknown' | 'base_quantity_mismatch';

/**
 * Why an id gave `unknown_unit` — **for the logger only** (threat F6): the
 * answer to the buyer is one reason whatever this says. Deleted and
 * never-existed cannot be told apart from a read over vetted ids alone, and no
 * wider read is made to tell them apart.
 */
export type PackagingMismatchCause = 'not_a_current_unit' | 'unit_of_another_product';

export interface PackagingMismatch {
  index: number;
  productId: string;
  reason: PackagingMismatchReason;
  /** Server-side only; never in a response. Absent for the name path. */
  cause?: PackagingMismatchCause;
}

const PLAIN_PIECES: ResolvedPackaging = {
  packagingUnitId: null,
  packagingUnitName: null,
  packagingUnitBaseQuantity: null,
};

/**
 * Resolves every line (index-aligned output) and lists every failing line in
 * input order:
 *
 * - an id → must be a unit of the line's own product, else `unknown_unit`; the
 *   catalogue's name and base quantity are stored, whatever else was sent;
 * - no id, a name → the product must have a unit of that name **and** base
 *   quantity: an unknown name is `name_unknown`, a known name with another or
 *   no base quantity is `base_quantity_mismatch`;
 * - no id, no name, a base quantity → names no unit: `name_unknown`;
 * - nothing → plain pieces.
 *
 * A failing line resolves to plain pieces in the output; the caller refuses the
 * whole request when `mismatches` is not empty.
 *
 * Feature 163 (FR-079, T138; owner decision 2026-10-26) — the stored name is
 * the unit's name at `scopeLanguage` (its translation there, else the global
 * name; `null` or absent = the global name). The name match above stays on the
 * global name only: a line that names its unit by a translation (the name a
 * buyer saw in another language) matches no unit and is refused as
 * `name_unknown`. A client names the unit by its id, or by its global name.
 */
export function resolveLinePackaging(
  lines: readonly PackagingReferenceLine[],
  units: readonly PackagingUnitCandidate[],
  _scopeLanguage?: string | null,
): { lines: ResolvedPackaging[]; mismatches: PackagingMismatch[] } {
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const resolved: ResolvedPackaging[] = [];
  const mismatches: PackagingMismatch[] = [];

  const fromUnit = (unit: PackagingUnitCandidate): ResolvedPackaging => ({
    packagingUnitId: unit.id,
    // 168-shim: the Global unit name; S2 snapshots it at (C, L) with `effectivePackagingUnitNames`.
    packagingUnitName: unit.name,
    packagingUnitBaseQuantity: unit.baseQuantity,
  });

  lines.forEach((line, index) => {
    const refuse = (reason: PackagingMismatchReason, cause?: PackagingMismatchCause): void => {
      mismatches.push({ index, productId: line.productId, reason, ...(cause ? { cause } : {}) });
      resolved.push(PLAIN_PIECES);
    };

    if (line.packagingUnitId !== undefined) {
      const unit = unitsById.get(line.packagingUnitId);
      if (unit === undefined) return refuse('unknown_unit', 'not_a_current_unit');
      if (unit.productId !== line.productId) return refuse('unknown_unit', 'unit_of_another_product');
      resolved.push(fromUnit(unit));
      return;
    }

    if (line.packagingUnitName !== undefined) {
      const named = units.find((unit) => unit.productId === line.productId && unit.name === line.packagingUnitName);
      if (named === undefined) return refuse('name_unknown');
      if (line.packagingUnitBaseQuantity !== named.baseQuantity) return refuse('base_quantity_mismatch');
      resolved.push(fromUnit(named));
      return;
    }

    if (line.packagingUnitBaseQuantity !== undefined) return refuse('name_unknown');
    resolved.push(PLAIN_PIECES);
  });

  return { lines: resolved, mismatches };
}

/** Whether a line speaks about packaging at all — only those need the catalogue's units. */
export function carriesPackagingReference(line: PackagingReferenceLine): boolean {
  return (
    line.packagingUnitId !== undefined ||
    line.packagingUnitName !== undefined ||
    line.packagingUnitBaseQuantity !== undefined
  );
}

/**
 * `422 PACKAGING_UNIT_MISMATCH` for every failing line: `lineNumber` is the
 * first failing line's `index + 1`, `productName` its product's (what the
 * bundle sentence interpolates). `cause` never leaves the server.
 */
export function packagingMismatchError(
  mismatches: readonly PackagingMismatch[],
  productNameById: ReadonlyMap<string, string>,
): HttpError {
  const nameOf = (productId: string): string => productNameById.get(productId) ?? productId;
  const first = mismatches[0]!;
  const productName = nameOf(first.productId);
  const lineNumber = first.index + 1;
  return new HttpError(
    422,
    ERROR_CODES.PACKAGING_UNIT_MISMATCH,
    `The packaging unit on line ${lineNumber} ("${productName}") does not match the product's packaging units.`,
    {
      lineNumber,
      productName,
      lines: mismatches.map((m) => ({
        index: m.index,
        productId: m.productId,
        productName: nameOf(m.productId),
        reason: m.reason,
      })),
    },
  );
}
