/**
 * Feature 146 — which stored line an incoming line of a rewrite *is*, and what
 * a paired line keeps (FR-034, FR-035, FR-036;
 * `specs/146-quote-request-pricing-history/research.md` R5, data-model §2).
 *
 * Admin `modify` and customer `patchDraft` both delete a request's lines and
 * recreate them from the body. Whatever a line carries that the body does not
 * restate — variant, line note, packaging unit, the customer's proposal, the
 * stored reference price — survives only by pairing the incoming line with the
 * row it replaces. Pure: no I/O, so both services share one rule and the rule
 * is unit-tested on its own.
 */

import { roundHalfUp } from '@endora-commerce/contracts';

/** The part of a stored line the pairing reads. */
export interface CarryOverRow {
  id: string;
  productId: string;
  variantId?: string | null;
  /** Feature 155 — the catalogue unit the line was stored with; `null` for older lines. */
  packagingUnitId?: string | null;
  packagingUnitName?: string | null;
  /** Feature 159 — the row's group (`null` = ungrouped); absent or `undefined` = not known. */
  groupId?: string | null | undefined;
  quantity?: number | undefined;
}

/**
 * The part of an incoming line the pairing reads.
 *
 * `variantId: undefined` is "key absent" — on the admin side that means "keep
 * the stored variant" (R5.2), so the line may pair with a row of any variant of
 * its product; on the customer side it means "no variant". `packagingUnitName:
 * undefined` means the body does not speak about packaging (the admin schema
 * has no such key) and only position decides.
 */
export interface IncomingLineKey {
  id?: string | undefined;
  productId: string;
  variantId?: string | null | undefined;
  /** Feature 155 — the catalogue unit the line resolved to; absent or `null` = none. */
  packagingUnitId?: string | null | undefined;
  packagingUnitName?: string | null | undefined;
  /**
   * Feature 159 (research N-32) — the group the line is in (`null` =
   * ungrouped); `undefined` says nothing, as a body without `groups` does.
   */
  groupId?: string | null | undefined;
  /** Feature 159 — the line's quantity; `undefined` says nothing. */
  quantity?: number | undefined;
}

/**
 * `'admin'` — `modify`: an `id` naming a row of this request with the same
 * product is that row (R5.1); an absent `variantId` is a wildcard over the
 * product's variants, a variant-less row preferred.
 * `'customer'` — `patchDraft`: lines carry no ids (R5.3); an absent variant is
 * `null` and must match `null`.
 */
export type PairingMode = 'admin' | 'customer';

export interface LinePairing<E> {
  /** Index-aligned with the incoming lines; `null` = a new line. */
  paired: Array<E | null>;
  /** Existing rows no incoming line paired with, in their stored order. */
  removed: E[];
}

/**
 * Pair incoming lines with stored rows: by `id` (admin only), then by product
 * and variant with the same packaging unit id, then with an equal packaging
 * name, then by product and variant in stored order (the R6 rule). Two variants
 * of one product never pair with each other. Each row pairs at most once.
 *
 * Feature 159 (research N-32) — one product may sit on several lines, in
 * different groups. Each of the passes after the id therefore prefers, among
 * the rows it accepts, one of the line's own group and quantity, then of its
 * group, then of its quantity, before stored order decides — each preference
 * run over every line before the next, so a closer match is never taken by a
 * line that would have settled for less. A line that says nothing of its group
 * or quantity skips that preference.
 */
export function pairLines<E extends CarryOverRow>(
  existing: readonly E[],
  incoming: readonly IncomingLineKey[],
  mode: PairingMode,
): LinePairing<E> {
  const paired: Array<E | null> = incoming.map(() => null);
  const taken = new Set<number>();

  const claim = (lineIndex: number, accept: (row: E) => boolean): void => {
    if (paired[lineIndex] !== null) return;
    const rowIndex = existing.findIndex((row, index) => !taken.has(index) && accept(row));
    if (rowIndex < 0) return;
    taken.add(rowIndex);
    paired[lineIndex] = existing[rowIndex]!;
  };

  const variantOf = (line: IncomingLineKey): string | null => line.variantId ?? null;
  const wildcardVariant = (line: IncomingLineKey): boolean =>
    mode === 'admin' && line.variantId === undefined;
  const sameVariant = (row: E, line: IncomingLineKey): boolean =>
    (row.variantId ?? null) === variantOf(line);

  // Feature 159 — the preferences inside each pass, strictest first.
  const sameGroup = (row: E, line: IncomingLineKey): boolean | null =>
    line.groupId === undefined || row.groupId === undefined ? null : (row.groupId ?? null) === (line.groupId ?? null);
  const sameQuantity = (row: E, line: IncomingLineKey): boolean | null =>
    line.quantity === undefined || row.quantity === undefined ? null : row.quantity === line.quantity;
  const preferences: ReadonlyArray<(row: E, line: IncomingLineKey) => boolean | null> = [
    (row, line) => {
      const group = sameGroup(row, line);
      const quantity = sameQuantity(row, line);
      return group === null || quantity === null ? null : group && quantity;
    },
    sameGroup,
    sameQuantity,
    () => true,
  ];

  /** One pass: every line its preferred row first, then the next preference. */
  const pass = (applies: (line: IncomingLineKey) => boolean, accept: (row: E, line: IncomingLineKey) => boolean): void => {
    for (const prefer of preferences) {
      incoming.forEach((line, lineIndex) => {
        if (!applies(line)) return;
        claim(lineIndex, (row) => accept(row, line) && prefer(row, line) === true);
      });
    }
  };

  // 1. By id — admin only, and only for a row of the same product.
  if (mode === 'admin') {
    incoming.forEach((line, lineIndex) => {
      if (line.id === undefined) return;
      claim(lineIndex, (row) => row.id === line.id && row.productId === line.productId);
    });
  }

  // 2a. Same product and variant, the same packaging unit id (feature 155,
  //     FR-031 (b)) — a unit renamed in the catalogue since the line was
  //     stored is still the same unit. Both sides must carry an id.
  pass(
    (line) => (line.packagingUnitId ?? null) !== null,
    (row, line) =>
      row.productId === line.productId && sameVariant(row, line) && (row.packagingUnitId ?? null) === line.packagingUnitId,
  );

  // 2b. Same product and variant, equal packaging name — run over every line
  //     before any positional fallback, so an exact match is never stolen by an
  //     earlier line that would have settled for position.
  pass(
    (line) => line.packagingUnitName !== undefined,
    (row, line) =>
      row.productId === line.productId &&
      sameVariant(row, line) &&
      (row.packagingUnitName ?? null) === (line.packagingUnitName ?? null),
  );

  // 3. Same product and variant, by stored order.
  pass(
    () => true,
    (row, line) => row.productId === line.productId && sameVariant(row, line),
  );

  // 4. Admin, variant key absent: any variant of the product ("absent = keep").
  pass(wildcardVariant, (row, line) => row.productId === line.productId);

  return { paired, removed: existing.filter((_, index) => !taken.has(index)) };
}

/**
 * The proposal a rewritten line stores (threat model T5): an omitted
 * `desiredUnitPrice` keeps the paired row's stored proposal — otherwise a
 * locked owner, who may not send one, could erase a proposal stored before the
 * lock by resending the line (FR-024). An explicit value replaces it.
 */
export function carriedProposal(
  sent: number | undefined,
  paired: { desiredUnitPrice?: string | null } | null,
): string | null {
  // Half-up on its decimal digits (issue #417): `toFixed(2)` stored 1.005 as 1.00.
  if (sent !== undefined) return roundHalfUp(sent);
  return paired?.desiredUnitPrice ?? null;
}

/** What a reference price was resolved for. */
export interface ReferenceInputs {
  productId: string;
  variantId?: string | null | undefined;
  quantity: number;
  /** Feature 155 — when both sides carry one, the unit's identity (its name may since have changed). */
  packagingUnitId?: string | null | undefined;
  packagingUnitName?: string | null | undefined;
  packagingUnitBaseQuantity?: number | null | undefined;
}

/**
 * Whether a paired line keeps its stored reference: only when product,
 * variant, quantity and packaging unit are all unchanged — any of them can move
 * the price bracket (spec Assumption). A change of proposal or line note alone
 * keeps it.
 *
 * The packaging unit is the same unit when both sides carry the same unit id
 * (feature 155, FR-031 (b) — a unit renamed in the catalogue is not a change
 * the buyer made), otherwise when the names are equal; the base quantity must
 * be equal either way.
 */
export function referenceInputsUnchanged(stored: ReferenceInputs, next: ReferenceInputs): boolean {
  const storedUnitId = stored.packagingUnitId ?? null;
  const nextUnitId = next.packagingUnitId ?? null;
  const sameUnit =
    storedUnitId !== null && nextUnitId !== null
      ? storedUnitId === nextUnitId
      : (stored.packagingUnitName ?? null) === (next.packagingUnitName ?? null);
  return (
    stored.productId === next.productId &&
    (stored.variantId ?? null) === (next.variantId ?? null) &&
    stored.quantity === next.quantity &&
    sameUnit &&
    (stored.packagingUnitBaseQuantity ?? null) === (next.packagingUnitBaseQuantity ?? null)
  );
}
