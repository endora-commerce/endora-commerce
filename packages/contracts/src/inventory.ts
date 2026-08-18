import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common.js';
import type { BulkImportReport } from './import-export.js';

/**
 * Inventory module contracts — feature 010 multi-warehouse rewrite.
 * Source of truth per Constitution Principle V; the backend re-uses
 * these schemas as route validators and the frontends consume the
 * inferred TS types.
 *
 * See specs/010-inventory-module/contracts/ for the HTTP contract docs.
 *
 * Foundation 001 schemas (`stockLevelSchema`, `adjustStockRequestSchema`,
 * `availabilityNotificationRequestSchema`) are preserved at the bottom
 * of the file for backward compatibility with the existing admin
 * inventory routes; new code should consume the feature-010 schemas.
 */

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const warehouseAddressSchema = z.object({
  street: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
});
export type WarehouseAddress = z.infer<typeof warehouseAddressSchema>;

export const warehouseContactSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type WarehouseContact = z.infer<typeof warehouseContactSchema>;

export const warehouseSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1).max(160),
  code: z.string().min(1).max(64),
  active: z.boolean(),
  description: z.string().nullable(),
  address: warehouseAddressSchema.nullable(),
  contact: warehouseContactSchema.nullable(),
  /**
   * Per-warehouse fallback low-stock threshold. Applied when the
   * Product itself has no `lowStockThreshold`. NULL means: no fallback
   * from this warehouse — system falls through to the global threshold.
   */
  defaultLowStockThreshold: z.number().int().nonnegative().nullable(),
  totals: z
    .object({
      products: z.number().int().nonnegative(),
      onHand: z.number().int().nonnegative(),
      isDefaultForChannelCount: z.number().int().nonnegative(),
    })
    .optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Warehouse = z.infer<typeof warehouseSchema>;

export const createWarehouseRequestSchema = z.object({
  name: z.string().min(1).max(160),
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z][a-z0-9_-]*[a-z0-9]$/),
  active: z.boolean().optional(),
  description: z.string().max(2000).nullable().optional(),
  address: warehouseAddressSchema.nullable().optional(),
  contact: warehouseContactSchema.nullable().optional(),
  defaultLowStockThreshold: z.number().int().nonnegative().nullable().optional(),
});
export type CreateWarehouseRequest = z.infer<typeof createWarehouseRequestSchema>;

export const updateWarehouseRequestSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    active: z.boolean().optional(),
    description: z.string().max(2000).nullable().optional(),
    address: warehouseAddressSchema.nullable().optional(),
    contact: warehouseContactSchema.nullable().optional(),
    defaultLowStockThreshold: z.number().int().nonnegative().nullable().optional(),
  })
  .strict();
export type UpdateWarehouseRequest = z.infer<typeof updateWarehouseRequestSchema>;

// ---------------------------------------------------------------------------
// Warehouse ↔ Sales channel assignment
// ---------------------------------------------------------------------------

export const warehouseChannelAssignmentSchema = z.object({
  id: uuidSchema,
  warehouseId: uuidSchema,
  warehouseName: z.string(),
  warehouseCode: z.string(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  assignedAt: isoDateTimeSchema,
});
export type WarehouseChannelAssignment = z.infer<typeof warehouseChannelAssignmentSchema>;

export const assignWarehouseToChannelRequestSchema = z.object({
  warehouseId: uuidSchema,
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
});
export type AssignWarehouseToChannelRequest = z.infer<typeof assignWarehouseToChannelRequestSchema>;

export const patchWarehouseChannelAssignmentRequestSchema = z
  .object({
    isDefault: z.boolean().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
  })
  .strict();
export type PatchWarehouseChannelAssignmentRequest = z.infer<
  typeof patchWarehouseChannelAssignmentRequestSchema
>;

// ---------------------------------------------------------------------------
// Stock levels + Inventory landing
// ---------------------------------------------------------------------------

export const inventoryLandingKpisSchema = z.object({
  totalProductsTracked: z.number().int().nonnegative(),
  totalOnHand: z.number().int().nonnegative(),
  outOfStockCount: z.number().int().nonnegative(),
  lowStockCount: z.number().int().nonnegative(),
  perWarehouseTotals: z.array(
    z.object({
      warehouseId: uuidSchema,
      warehouseCode: z.string(),
      onHand: z.number().int().nonnegative(),
    }),
  ),
});
export type InventoryLandingKpis = z.infer<typeof inventoryLandingKpisSchema>;

export const stockDisplayBandSchema = z.enum([
  'high',
  'medium',
  'low',
  'out_of_stock',
  'available',
]);
export type StockDisplayBand = z.infer<typeof stockDisplayBandSchema>;

export const stockLevelRowSchema = z.object({
  productId: uuidSchema,
  productSku: z.string(),
  productName: z.string(),
  manageStock: z.boolean(),
  backorderEnabled: z.boolean(),
  lowStockThreshold: z.number().int().nullable(),
  lowStockThresholdMode: z.enum(['cumulative', 'per_warehouse']),
  perWarehouse: z.array(
    z.object({
      warehouseId: uuidSchema,
      warehouseCode: z.string(),
      onHand: z.number().int().nonnegative(),
      reserved: z.number().int().nonnegative(),
      /**
       * Effective low-stock threshold for this (product, warehouse).
       * Resolved via: explicit row in `product_warehouse_low_stock_thresholds`
       * → `warehouses.default_low_stock_threshold` fallback → null.
       * Surfaced regardless of mode so the admin UI can render it.
       */
      lowStockThreshold: z.number().int().nullable(),
    }),
  ),
  cumulativeOnHand: z.number().int().nonnegative(),
  displayBand: stockDisplayBandSchema,
  isLowStock: z.boolean(),
  isOutOfStock: z.boolean(),
});
export type StockLevelRow = z.infer<typeof stockLevelRowSchema>;

/**
 * Bulk replace per-warehouse low-stock thresholds for one product.
 * The submitted set is the new truth: any (product, warehouse) row not
 * mentioned here is deleted. Pass `threshold: null` in an entry to
 * delete that single entry while keeping others.
 */
export const setProductWarehouseLowStockThresholdsRequestSchema = z.object({
  productId: uuidSchema,
  thresholds: z.array(
    z.object({
      warehouseId: uuidSchema,
      threshold: z.number().int().nonnegative().nullable(),
    }),
  ),
});
export type SetProductWarehouseLowStockThresholdsRequest = z.infer<
  typeof setProductWarehouseLowStockThresholdsRequestSchema
>;

export const setStockLevelRequestSchema = z.object({
  productId: uuidSchema,
  warehouseId: uuidSchema,
  variantId: uuidSchema.optional(),
  onHand: z.number().int().nonnegative(),
});
export type SetStockLevelRequest = z.infer<typeof setStockLevelRequestSchema>;

// ---------------------------------------------------------------------------
// Thresholds + display mode
// ---------------------------------------------------------------------------

export const inventoryDisplayModeSchema = z.enum([
  'exact',
  'band',
  'available_or_not',
]);
export type InventoryDisplayMode = z.infer<typeof inventoryDisplayModeSchema>;

export const thresholdTripleSchema = z.object({
  high: z.number().int().nullable(),
  medium: z.number().int().nullable(),
  low: z.number().int().nullable(),
});
export type ThresholdTriple = z.infer<typeof thresholdTripleSchema>;

export const inventoryThresholdsSchema = z.object({
  global: thresholdTripleSchema,
  perCategory: z.array(
    z.object({ categoryId: uuidSchema }).merge(thresholdTripleSchema),
  ),
  perProduct: z.array(
    z.object({ productId: uuidSchema }).merge(thresholdTripleSchema),
  ),
});
export type InventoryThresholds = z.infer<typeof inventoryThresholdsSchema>;

export const patchInventoryThresholdsRequestSchema = z
  .object({
    global: thresholdTripleSchema.partial().optional(),
    perCategory: z
      .array(
        z.object({ categoryId: uuidSchema }).merge(thresholdTripleSchema.partial()),
      )
      .optional(),
    perProduct: z
      .array(
        z.object({ productId: uuidSchema }).merge(thresholdTripleSchema.partial()),
      )
      .optional(),
  })
  .strict();
export type PatchInventoryThresholdsRequest = z.infer<
  typeof patchInventoryThresholdsRequestSchema
>;

// Storefront-public stock read

export const storefrontProductStockSchema = z.object({
  productId: uuidSchema,
  manageStock: z.boolean(),
  backorderEnabled: z.boolean(),
  displayMode: inventoryDisplayModeSchema,
  displayBand: stockDisplayBandSchema,
  exactOnHand: z.number().int().nullable(),
  isOutOfStock: z.boolean(),
  showNotifyButton: z.boolean(),
});
export type StorefrontProductStock = z.infer<typeof storefrontProductStockSchema>;

// ---------------------------------------------------------------------------
// Notify when available
// ---------------------------------------------------------------------------

export const availabilityNotificationStatusSchema = z.enum([
  'queued',
  'notified',
  'cancelled',
]);
export type AvailabilityNotificationStatus = z.infer<
  typeof availabilityNotificationStatusSchema
>;

export const availabilityNotificationSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  productName: z.string().optional(),
  productSku: z.string().optional(),
  customerAccountId: uuidSchema.nullable(),
  email: z.string().email(),
  status: availabilityNotificationStatusSchema,
  queuedAt: isoDateTimeSchema,
  notifiedAt: isoDateTimeSchema.nullable(),
});
export type AvailabilityNotification = z.infer<typeof availabilityNotificationSchema>;

export const subscribeAvailabilityNotificationRequestSchema = z.object({
  productId: uuidSchema,
  email: z.string().email(),
});
export type SubscribeAvailabilityNotificationRequest = z.infer<
  typeof subscribeAvailabilityNotificationRequestSchema
>;

export const patchAvailabilityNotificationRequestSchema = z.object({
  status: z.literal('cancelled'),
});
export type PatchAvailabilityNotificationRequest = z.infer<
  typeof patchAvailabilityNotificationRequestSchema
>;

// ---------------------------------------------------------------------------
// Fulfilment strategy
// ---------------------------------------------------------------------------

export const fulfilmentStrategySchema = z.enum([
  'any',
  'default_first',
  'lowest_stock_first',
  'highest_stock_first',
  'defined_order',
]);
export type FulfilmentStrategy = z.infer<typeof fulfilmentStrategySchema>;

// ---------------------------------------------------------------------------
// Stock import
// ---------------------------------------------------------------------------

export const stockImportErrorSchema = z.object({
  row: z.number().int().positive(),
  sku: z.string(),
  reason: z.enum(['product_not_found', 'invalid_quantity', 'malformed_row']),
});
export type StockImportError = z.infer<typeof stockImportErrorSchema>;

export const stockImportResultSchema = z.object({
  rowsRead: z.number().int().nonnegative(),
  rowsApplied: z.number().int().nonnegative(),
  rowsSkipped: z.number().int().nonnegative(),
  errors: z.array(stockImportErrorSchema),
});
export type StockImportResult = z.infer<typeof stockImportResultSchema>;

// ---------------------------------------------------------------------------
// Foundation 001 backward-compat schemas (preserved)
// ---------------------------------------------------------------------------

export const stockLevelSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  variantId: uuidSchema.nullable(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  updatedAt: isoDateTimeSchema,
});
export type StockLevel = z.infer<typeof stockLevelSchema>;

export const adjustStockRequestSchema = z.object({
  productId: uuidSchema,
  variantId: uuidSchema.optional(),
  /** Signed delta — positive for receipts, negative for write-offs. */
  delta: z.number().int(),
  reason: z.string().optional(),
});
export type AdjustStockRequest = z.infer<typeof adjustStockRequestSchema>;

export const availabilityNotificationRequestSchema = z.object({
  variantId: uuidSchema.optional(),
});
export type AvailabilityNotificationRequest = z.infer<
  typeof availabilityNotificationRequestSchema
>;

// ---------------------------------------------------------------------------
// --- ports -----------------------------------------------------------------
//
// The in-process surface `inventory` publishes to the three modules that read
// it (feature 075, Phase P) — `orders` at placement, `import_export` for the
// stock adapter, and the dev seed.
// ---------------------------------------------------------------------------

/**
 * The deterministic id of the warehouse every install seeds.
 *
 * Published as a **constant, not a port** (FR-013): switching `inventory` off
 * does not change what the seeded id is, and `orders` compares against it when
 * a line names no warehouse.
 */
export const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

/**
 * A warehouse as it crosses a module boundary — never the ORM entity.
 *
 * `address` reuses {@link WarehouseAddress}, declared above for the HTTP
 * surface: the column stores exactly that JSONB shape, so a second
 * declaration would be two names for one blob.
 */
export interface WarehouseRecord {
  id: string;
  name: string;
  code: string;
  active: boolean;
  description: string | null;
  address: WarehouseAddress | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  defaultLowStockThreshold: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One product's stock in one warehouse. `available` is `onHand - reserved`. */
export interface StockLevelRecord {
  id: string;
  productId: string;
  variantId: string | null;
  warehouseId: string;
  onHand: number;
  reserved: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One **active** warehouse bound to a sales channel, in the order placement
 * walks them. See {@link InventoryStockReadPort.listChannelWarehouses}.
 */
export interface ChannelWarehouse {
  warehouseId: string;
  warehouseCode: string;
  isDefault: boolean;
}

/** Which warehouses serve which sales channel, and in what order. */
export interface WarehouseChannelAssignmentRecord {
  id: string;
  warehouseId: string;
  salesChannelId: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
}

/**
 * Container name: `inventoryStockReadPort`. Owner: `inventory`.
 *
 * `orders` reads stock at placement to pick warehouses, and `import_export`
 * reads it to export a stock sheet. Both reach the `StockLevel` entity today,
 * and `orders` does so through a **dynamic** import inside a method body —
 * invisible to a reviewer scanning the import block, which is why the boundary
 * check was taught to see one.
 *
 * `candidatesFor` answers the question `orders` actually asks: which
 * warehouses can serve this line on this channel, with how much available,
 * already shaped for {@link resolveAllocations}. Assembling that from three
 * tables is this module's business, and it was being assembled in `orders`.
 */
export interface InventoryStockReadPort {
  listStockForProducts(
    productIds: readonly string[],
    options?: { warehouseId?: string },
  ): Promise<StockLevelRecord[]>;
  listWarehouses(options?: { activeOnly?: boolean }): Promise<WarehouseRecord[]>;
  listChannelAssignments(salesChannelId: string): Promise<WarehouseChannelAssignmentRecord[]>;
  /**
   * The **active** warehouses bound to a channel, joined with their codes and
   * ordered the way placement walks them: `isDefault desc, sortOrder asc,
   * createdAt asc`. When the channel has no active warehouse bound, this
   * answers the seeded default warehouse — the fallback lives here rather than
   * in the caller, which is where it used to be spelled out of a UUID constant
   * copied from `warehouse.entity.ts` (D-94.4).
   *
   * Not a widening of {@link listChannelAssignments}: that one has a different
   * ordering and a different consumer, and both should keep saying what they
   * mean.
   *
   * **`candidatesFor` is not the method for the placement call site**, and the
   * distinction matters more than it looks. `candidatesFor` computes
   * availability through this module's own `EntityManager`, so it neither
   * takes nor holds the `PESSIMISTIC_WRITE` on `stock_levels` that stops two
   * concurrent placements allocating the same unit
   * (`test/contract/orders/place-stock-race.test.ts`). Placement therefore
   * takes the channel → warehouse binding from here and reads and locks the
   * stock rows itself, on its own transaction.
   */
  listChannelWarehouses(salesChannelId: string): Promise<ChannelWarehouse[]>;
  /**
   * Candidate warehouses for one product line on one channel, ordered by
   * warehouse code, with `available = onHand - reserved`. An empty answer
   * means the line cannot be allocated anywhere, which is not the same as an
   * error.
   *
   * Read outside any caller's transaction — see the warning on
   * {@link listChannelWarehouses}.
   */
  candidatesFor(input: {
    productId: string;
    variantId?: string | null;
    salesChannelId: string | null;
  }): Promise<CandidateWarehouse[]>;
}

// --- the bulk import surface -------------------------------------------------
//
// D-74, the second half of the same ruling `catalog` carries: `import_export`
// held this module's `StockLevel` class, wrote it inside its own transaction,
// and named the seeded warehouse by a UUID literal copied out of
// `warehouse.entity.ts`. All three go with the port — a caller has a SKU and a
// quantity, not a warehouse id.

/**
 * One row of a stock-level import.
 *
 * `productSku` rather than a product id: a spreadsheet addresses a product the
 * way an operator does, and resolving it is this module's business because it
 * is this module that decides a row addressing nothing is a rejected row.
 * `variantId` absent or `null` addresses the simple-product baseline level.
 *
 * The row names no warehouse. The import applies to the seeded default one —
 * the behaviour the CSV path has always had, kept explicit here rather than
 * left to a constant a caller copies.
 */
export interface StockLevelImportRow {
  productSku: string;
  variantId?: string | null;
  onHand: number;
}

/**
 * Container name: `inventoryStockImportPort`. Owner: `inventory`.
 *
 * All-or-nothing per call, one audit row — the same contract `catalog`'s bulk
 * import port carries, and for the same reason. With `inventory` off the call answers 503
 * `MODULE_DISABLED`; the caller is expected to decide presence before offering
 * the surface at all.
 */
export interface InventoryStockImportPort {
  importStockLevels(rows: readonly StockLevelImportRow[]): Promise<BulkImportReport>;
}

// --- the two pure allocation functions ---------------------------------------
//
// Relocated here from `inventory/services/` (feature 075, Phase P, FR-013).
// Both are pure over their arguments — candidate warehouses in, an allocation
// decision out — so switching `inventory` off cannot change the answer and a
// gated port answering 503 would be a bug rather than a degrade.
//
// `orders` calls both at placement, inside its own transaction, through a
// dynamic import. Publishing them removes the dynamic import rather than
// wrapping it.

export interface FulfilmentLayer {
  strategy: FulfilmentStrategy | null | undefined;
  warehouseOrder: string[] | null | undefined;
}

export interface EffectiveFulfilment {
  strategy: FulfilmentStrategy;
  warehouseOrder: string[];
}

/**
 * Effective fulfilment-strategy resolver (feature 010).
 *
 * The warehouse-picking strategy used to reserve stock at order placement is
 * configurable at three levels, resolved with precedence:
 *
 *   Product > Organization > Sales Channel (setting) > platform default
 *
 * Product and organisation each contribute an optional override layer; the
 * sales-channel layer, and the platform default behind it, are resolved
 * upstream by the settings module and arrive already collapsed into
 * `channelDefault`. The first layer with a non-null `strategy` wins and
 * supplies **both** its `strategy` and its `warehouseOrder` — the warehouse
 * walk for `defined_order` never mixes across layers.
 */
export function resolveEffectiveFulfilmentStrategy(
  product: FulfilmentLayer,
  organization: FulfilmentLayer,
  channelDefault: EffectiveFulfilment,
): EffectiveFulfilment {
  for (const layer of [product, organization]) {
    if (layer.strategy) {
      return { strategy: layer.strategy, warehouseOrder: layer.warehouseOrder ?? [] };
    }
  }
  return channelDefault;
}

export interface CandidateWarehouse {
  warehouseId: string;
  warehouseCode: string;
  /** `onHand - reserved`. */
  available: number;
  isDefault: boolean;
}

export interface AllocationDecision {
  warehouseId: string;
  quantity: number;
  /**
   * True when this allocation is going through with insufficient stock
   * because the product has `backorderEnabled = true`.
   */
  isBackorder: boolean;
}

export interface ResolveAllocationsInput {
  quantity: number;
  candidateWarehouses: CandidateWarehouse[];
  strategy: FulfilmentStrategy;
  /** When `defined_order`, the configured warehouse-id list to walk. */
  warehouseOrder?: string[];
  /**
   * When the product allows backorder, lines that cannot be fully fulfilled
   * still go through; the unfulfilled remainder is flagged as a backorder
   * against the first-choice warehouse.
   */
  backorderEnabled: boolean;
}

export type AllocationOutcome =
  | { ok: true; allocations: AllocationDecision[] }
  | { ok: false; reason: 'insufficient_stock' };

/**
 * Fulfilment-strategy resolver (feature 010 / FR-029…FR-033, research §R4).
 *
 * Picks a list of `(warehouseId, quantity)` allocations for a single order
 * line given the available candidate warehouses and the resolved strategy.
 * Tie-break on equal `available` quantities is warehouse-code lexical order —
 * deterministic and documented.
 *
 * Of the five strategies only `default_first` **splits** a line across
 * warehouses; the others pick a single warehouse per line and refuse the line
 * if that warehouse cannot fully satisfy the requested quantity.
 */
export function resolveAllocations(input: ResolveAllocationsInput): AllocationOutcome {
  const { quantity, strategy, candidateWarehouses, backorderEnabled } = input;
  if (candidateWarehouses.length === 0) {
    // No warehouses at all: even a backorder has nothing to be flagged against.
    return { ok: false, reason: 'insufficient_stock' };
  }

  switch (strategy) {
    case 'any':
      return pickFirstWhole(quantity, sortByCode(candidateWarehouses), backorderEnabled);

    case 'default_first': {
      const preferred = candidateWarehouses.find((w) => w.isDefault);
      const others = sortByCode(candidateWarehouses.filter((w) => !w.isDefault));
      const ordered = preferred ? [preferred, ...others] : others;
      return splitAcross(quantity, ordered, backorderEnabled);
    }

    case 'lowest_stock_first': {
      const candidates = candidateWarehouses
        .filter((w) => w.available >= quantity)
        .sort(
          (a, b) => a.available - b.available || a.warehouseCode.localeCompare(b.warehouseCode),
        );
      return pickFirstWhole(quantity, candidates, backorderEnabled);
    }

    case 'highest_stock_first': {
      const candidates = candidateWarehouses
        .filter((w) => w.available >= quantity)
        .sort(
          (a, b) => b.available - a.available || a.warehouseCode.localeCompare(b.warehouseCode),
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
      return {
        ok: true,
        allocations: [{ warehouseId: w.warehouseId, quantity, isBackorder: false }],
      };
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

/**
 * Container name: `inventoryFulfilmentPlanningPort`. Owner: `inventory`.
 *
 * The warehouse-picking **policy** placement runs, published (D-94.4).
 *
 * `orders` used to reach both halves through `await import(
 * '../../inventory/services/…')` inside the placement method body: a dynamic
 * import, invisible to a reviewer scanning the import block, of the rules that
 * decide which warehouse serves a line. Publishing them stops the policy being
 * something `orders` can re-implement by editing an import.
 *
 * Two methods and not two more on {@link InventoryStockReadPort}: a *read*
 * port that also decides policy makes its own name a lie. Both are **pure over
 * their arguments** — no `EntityManager`, no table, no clock — so the contract
 * stays FR-034-clean and the caller may run them inside its own transaction
 * without the owner ever touching it.
 */
export interface InventoryFulfilmentPlanningPort {
  /**
   * Product > Organization > Sales Channel (already collapsed into
   * `channelDefault`) > platform default. See
   * {@link resolveEffectiveFulfilmentStrategy}.
   */
  resolveEffectiveStrategy(
    product: FulfilmentLayer,
    organization: FulfilmentLayer,
    channelDefault: EffectiveFulfilment,
  ): EffectiveFulfilment;
  /**
   * One line's allocation plan over the candidate warehouses the caller has
   * already read **and locked**. See {@link resolveAllocations}.
   */
  planAllocations(input: ResolveAllocationsInput): AllocationOutcome;
}
