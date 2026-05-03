import type { FulfilmentStrategy } from '@b2b/contracts';

/**
 * Fulfilment-strategy resolver — pure function (feature 010 / FR-029
 * to FR-033, research §R4).
 *
 * Picks a list of `(warehouseId, quantity)` allocations for a single
 * order line given the available candidate warehouses and the
 * resolved strategy. Tie-break on equal `available` quantities is
 * warehouse code lex order — deterministic and documented.
 *
 * Of the five strategies, only `default_first` SPLITS a line across
 * warehouses; the others pick a single warehouse per line and refuse
 * the line if that warehouse cannot fully satisfy the requested
 * quantity.
 */
export interface CandidateWarehouse {
  warehouseId: string;
  warehouseCode: string;
  available: number; // onHand - reserved
  isDefault: boolean;
}

export interface AllocationDecision {
  warehouseId: string;
  quantity: number;
  /** True when this allocation is going through with insufficient
   *  stock because the product has `backorderEnabled = true`. */
  isBackorder: boolean;
}

export interface ResolveAllocationsInput {
  quantity: number;
  candidateWarehouses: CandidateWarehouse[];
  strategy: FulfilmentStrategy;
  /** When `defined_order`, the configured warehouse ID list to walk. */
  warehouseOrder?: string[];
  /** When the product allows backorder, lines that cannot be fully
   *  fulfilled still go through; the unfulfilled remainder is
   *  flagged as a backorder against the first-choice warehouse. */
  backorderEnabled: boolean;
}

export type AllocationOutcome =
  | { ok: true; allocations: AllocationDecision[] }
  | { ok: false; reason: 'insufficient_stock' };

export function resolveAllocations(input: ResolveAllocationsInput): AllocationOutcome {
  const { quantity, strategy, candidateWarehouses, backorderEnabled } = input;
  if (candidateWarehouses.length === 0) {
    return backorderEnabled
      ? { ok: false, reason: 'insufficient_stock' } // no warehouses → cannot allocate even backorder
      : { ok: false, reason: 'insufficient_stock' };
  }

  switch (strategy) {
    case 'any':
      return pickFirstWhole(quantity, sortByCode(candidateWarehouses), backorderEnabled);

    case 'default_first': {
      const def = candidateWarehouses.find((w) => w.isDefault);
      const others = sortByCode(candidateWarehouses.filter((w) => !w.isDefault));
      const ordered = def ? [def, ...others] : others;
      return splitAcross(quantity, ordered, backorderEnabled);
    }

    case 'lowest_stock_first': {
      const candidates = candidateWarehouses
        .filter((w) => w.available >= quantity)
        .sort(
          (a, b) =>
            a.available - b.available ||
            a.warehouseCode.localeCompare(b.warehouseCode),
        );
      return pickFirstWhole(quantity, candidates, backorderEnabled);
    }

    case 'highest_stock_first': {
      const candidates = candidateWarehouses
        .filter((w) => w.available >= quantity)
        .sort(
          (a, b) =>
            b.available - a.available ||
            a.warehouseCode.localeCompare(b.warehouseCode),
        );
      return pickFirstWhole(quantity, candidates, backorderEnabled);
    }

    case 'defined_order': {
      const order = input.warehouseOrder ?? [];
      const byId = new Map(candidateWarehouses.map((w) => [w.warehouseId, w]));
      const ordered = order
        .map((id) => byId.get(id))
        .filter((w): w is CandidateWarehouse => Boolean(w));
      return pickFirstWhole(quantity, ordered, backorderEnabled);
    }
  }
}

// --- helpers --------------------------------------------------------

function sortByCode(list: CandidateWarehouse[]): CandidateWarehouse[] {
  return [...list].sort((a, b) => a.warehouseCode.localeCompare(b.warehouseCode));
}

function pickFirstWhole(
  quantity: number,
  ordered: CandidateWarehouse[],
  backorderEnabled: boolean,
): AllocationOutcome {
  for (const w of ordered) {
    if (w.available >= quantity) {
      return { ok: true, allocations: [{ warehouseId: w.warehouseId, quantity, isBackorder: false }] };
    }
  }
  if (backorderEnabled && ordered.length > 0) {
    return {
      ok: true,
      allocations: [{ warehouseId: ordered[0]!.warehouseId, quantity, isBackorder: true }],
    };
  }
  return { ok: false, reason: 'insufficient_stock' };
}

function splitAcross(
  quantity: number,
  ordered: CandidateWarehouse[],
  backorderEnabled: boolean,
): AllocationOutcome {
  const allocations: AllocationDecision[] = [];
  let remaining = quantity;
  for (const w of ordered) {
    if (remaining <= 0) break;
    if (w.available <= 0) continue;
    const take = Math.min(w.available, remaining);
    allocations.push({ warehouseId: w.warehouseId, quantity: take, isBackorder: false });
    remaining -= take;
  }
  if (remaining === 0) return { ok: true, allocations };
  if (backorderEnabled && ordered.length > 0) {
    const first = ordered[0]!;
    const existing = allocations.find((a) => a.warehouseId === first.warehouseId);
    if (existing) {
      existing.quantity += remaining;
      existing.isBackorder = true;
    } else {
      allocations.push({ warehouseId: first.warehouseId, quantity: remaining, isBackorder: true });
    }
    return { ok: true, allocations };
  }
  return { ok: false, reason: 'insufficient_stock' };
}
