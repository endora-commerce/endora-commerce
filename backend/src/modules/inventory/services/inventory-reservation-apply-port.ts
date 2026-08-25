import { LockMode } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { StockAllocation } from '../entities/stock-allocation.entity.js';
import { StockLevel } from '../entities/stock-level.entity.js';
import type {
  InventoryReservationApplyPort,
  PlacementStockSnapshot,
} from '../ports/index.js';

/**
 * `inventoryReservationApplyPort` — the stock reservation order placement
 * performs, written on the caller's `EntityManager` (feature 080, T048; D-169).
 *
 * `orders` held this module's `StockLevel` and `StockAllocation` classes for it
 * until T048, and held them **twice**: statically at the top of
 * `order-service.ts` for the reservation, and through an `await import()`
 * inside `releaseAllocations` for the release. The header comment above those
 * static imports claimed D-94.4 had removed the dynamic pair; it had not, and a
 * dynamic import is invisible to a reviewer scanning the block, which is
 * exactly the property a boundary exception must not have. Both spellings are
 * gone with this file.
 *
 * **The transaction is unchanged, and that is the point of the conversion.**
 * The `PESSIMISTIC_WRITE` is still taken on placement's own `EntityManager` and
 * still held until the order commits; the allocation rows are still written
 * after the order items are flushed, because
 * `stock_allocations_order_item_fk` is `on delete restrict`; the release still
 * runs in the transaction `releaseAllocations` opens. What changed is that the
 * statements are written by the module that owns the two tables, and that what
 * crosses the boundary is `PlacementStockSnapshot` — published records —
 * instead of managed rows the consumer could move any column of (D-77's first
 * narrowing).
 *
 * The port's own doc block, in `../ports/index.js`, states the constraint, the
 * lock and the off-state answer.
 */
export class InventoryReservationApplyService implements InventoryReservationApplyPort {
  async lockAvailabilityForPlacement(
    em: EntityManager,
    input: {
      productId: string;
      variantId: string | null;
      warehouseIds: readonly string[];
    },
  ): Promise<PlacementStockSnapshot[]> {
    const snapshot: PlacementStockSnapshot[] = [];
    // One row at a time, so the lock is fine-grained — a single `$in` query
    // would take a write lock on every candidate warehouse's row for the line
    // whether or not the plan ends up touching it. On `em`, so every lock is
    // held by the caller's transaction until the order commits.
    for (const warehouseId of input.warehouseIds) {
      const row = await em.findOne(
        StockLevel,
        { productId: input.productId, variantId: input.variantId, warehouseId },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      // A published record, never the managed entity (D-77's first narrowing).
      // An absent row answers `0`, which is the same promise a row at zero
      // makes; whether the write below inserts or updates is this module's to
      // know and not the caller's.
      snapshot.push({ warehouseId, available: row ? row.onHand - row.reserved : 0 });
    }
    return snapshot;
  }

  async reserveForPlacement(
    em: EntityManager,
    input: {
      productId: string;
      variantId: string | null;
      allocations: ReadonlyArray<{ warehouseId: string; quantity: number }>;
    },
  ): Promise<void> {
    // command-coverage-ignore: the stock half of an order placement, inside the
    // caller's transaction. `orders` audits the placement as one operation
    // through its own Command, and a stock movement this module records
    // separately would attribute the same decision twice; the audited stock
    // writes are the admin adjustments in `StockLevelService`, which are
    // decisions in their own right.
    for (const allocation of input.allocations) {
      // The row this transaction locked a moment ago, back out of the identity
      // map. Re-reading it rather than carrying the managed instance across the
      // seam is the whole content of D-77's first narrowing: a consumer that
      // holds the row can move any column of it.
      const row = await em.findOne(StockLevel, {
        productId: input.productId,
        variantId: input.variantId,
        warehouseId: allocation.warehouseId,
      });
      if (row) {
        row.reserved += allocation.quantity;
        continue;
      }
      // No row for this line in this warehouse: open one so the reserved
      // counter has somewhere to live. Still no on-hand — nothing has arrived,
      // it is only promised.
      const fresh = em.create(StockLevel, {
        productId: input.productId,
        ...(input.variantId ? { variantId: input.variantId } : {}),
        warehouseId: allocation.warehouseId,
        onHand: 0,
        reserved: allocation.quantity,
      });
      em.persist(fresh);
    }
    // Deliberately not flushed: the caller's transaction flushes this beside
    // the order items whose foreign key holds the allocation rows, which is the
    // statement order the reservation has always had.
  }

  async recordAllocationsForOrderItems(
    em: EntityManager,
    input: {
      allocations: ReadonlyArray<{
        orderItemId: string;
        warehouseId: string;
        quantity: number;
        isBackorder: boolean;
      }>;
    },
  ): Promise<void> {
    // command-coverage-ignore: the provenance rows of an audited order
    // placement, inside that placement's own transaction — the same reasoning
    // `reserveForPlacement` above carries.
    for (const allocation of input.allocations) {
      em.persist(
        em.create(StockAllocation, {
          orderItemId: allocation.orderItemId,
          warehouseId: allocation.warehouseId,
          quantity: allocation.quantity,
          isBackorder: allocation.isBackorder,
        }),
      );
    }
    await em.flush();
  }

  async releaseForOrderItems(
    em: EntityManager,
    input: {
      items: ReadonlyArray<{
        orderItemId: string;
        productId: string;
        variantId: string | null;
      }>;
    },
  ): Promise<{ released: number }> {
    // command-coverage-ignore: the stock side of an audited cancellation. The
    // `order.status_transition` Command owns the audit trail for the decision;
    // this is its lifecycle side effect, and mirrors `credit_limits`'
    // reserve/release pair.
    if (input.items.length === 0) return { released: 0 };
    const allocations = await em.find(StockAllocation, {
      orderItemId: { $in: input.items.map((i) => i.orderItemId) },
      releasedAt: null,
    });
    if (allocations.length === 0) return { released: 0 };

    const lineByOrderItemId = new Map(input.items.map((i) => [i.orderItemId, i]));
    const now = new Date();
    for (const allocation of allocations) {
      const line = lineByOrderItemId.get(allocation.orderItemId);
      if (!line) continue;
      const row = await em.findOne(StockLevel, {
        productId: line.productId,
        variantId: line.variantId,
        warehouseId: allocation.warehouseId,
      });
      // `Math.max(0, …)` rather than a bare subtraction: a counter that has
      // already been corrected by hand must not be driven negative by a release
      // it no longer accounts for.
      if (row) row.reserved = Math.max(0, row.reserved - allocation.quantity);
      allocation.releasedAt = now;
    }
    await em.flush();
    return { released: allocations.length };
  }
}
