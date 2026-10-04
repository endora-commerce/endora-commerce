import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CreditLimitReadPort, InventoryStockReadPort } from '@endora-commerce/contracts';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { ownerOfEffect, type OwedEffect } from '../domain/transition-effects.js';
import type {
  EffectAttemptSummary,
  OrderTransitionEffectService,
} from './order-transition-effect-service.js';

/**
 * Finds the orders an earlier version left holding stock or credit they should
 * have given back, and repairs them (`specs/142-order-transition-atomicity/`,
 * D9, FR-016–FR-018).
 *
 * Before order transitions recorded what they owe, a cancellation whose release
 * failed, was refused or was skipped left the order `cancelled` with its stock
 * allocations or its credit reservation still held — and nothing could run the
 * release afterwards, because repeating the cancellation is a no-op. The same
 * happened to the credit of an order marked paid. Those orders have no row in
 * `order_transition_effects`; this is what gives them one.
 *
 * **It lists before it writes.** A repair changes reserved-stock counters and
 * available credit, and an operator who corrected either by hand should see
 * what would be released first. So the default is a dry run that writes
 * nothing, and applying is a separate, explicit act — never a side effect of
 * an upgrade.
 *
 * **It repairs through the mechanism, not beside it.** Applying inserts the
 * same rows a live transition writes (`origin = 'repair'`) and drains them, so
 * the release is the owner's own, it is retried like any other if it fails,
 * and a second run finds nothing left to do.
 *
 * **`orders` asks; the owners answer.** Which orders are cancelled or paid is
 * read from this module's own tables. What they still hold is asked of
 * `inventory` and `credit_limits` through their read ports — this module reads
 * neither `stock_allocations` nor `credit_limit_reservations`. An owner that is
 * switched off cannot be asked, and the report says its holdings were not
 * examined rather than reporting them as none.
 *
 * Callers establish a system scope: this reads every organization's orders,
 * and `CommandBus.run` refuses to run without a tenant context.
 */

export const REPAIR_COMMAND_ACTION = 'order.transition_effects_repair';
export const REPAIR_DEFAULT_PAGE_SIZE = 200;

export interface StrandedOrder {
  readonly orderId: string;
  readonly businessId: string;
  readonly organizationId: string;
  readonly status: string;
  readonly paymentStatus: string;
  /** Allocations still held, as `inventory` answered them. Empty when none. */
  readonly stock: ReadonlyArray<{ orderItemId: string; warehouseId: string; quantity: number }>;
  /** The active reservation, as `credit_limits` answered it. `null` when none. */
  readonly credit: { readonly amount: string; readonly currency: string } | null;
}

export interface RepairReport {
  /** Whether rows were written (`--apply`) or this was a dry run. */
  readonly applied: boolean;
  /** Orders that could be stranded and were looked at. */
  readonly examined: number;
  /** Orders found holding something. */
  readonly stranded: readonly StrandedOrder[];
  /** Modules that are switched off, whose holdings were therefore not examined. */
  readonly notExamined: readonly string[];
  /** Follow-up rows written. Always 0 in a dry run. */
  readonly recorded: number;
  /** What the immediate attempt at those rows did. All zeroes in a dry run. */
  readonly attempts: EffectAttemptSummary;
}

export interface OrderTransitionEffectRepairDeps {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly effects: OrderTransitionEffectService;
  readonly isPresent: (moduleId: string) => boolean;
  /** Accessors, so a gated port is not resolved until presence has answered yes. */
  readonly stockRead: () => Pick<InventoryStockReadPort, 'unreleasedAllocationsForOrderItems'>;
  readonly creditRead: () => Pick<CreditLimitReadPort, 'activeReservationsForOrders'>;
}

interface CandidateRow {
  id: string;
  business_id: string;
  organization_id: string;
  status: string;
  payment_status: string;
  wants_stock: boolean;
  wants_credit: boolean;
}

export class OrderTransitionEffectRepairService {
  constructor(private readonly deps: OrderTransitionEffectRepairDeps) {}

  /**
   * `only` restricts the run to the named orders; `except` leaves the named
   * orders out — for an order whose stock counter an operator has already
   * corrected by hand, which the dry run lists like any other because its
   * allocation row is still unreleased.
   */
  async run(options: {
    apply: boolean;
    pageSize?: number;
    only?: readonly string[];
    except?: readonly string[];
  }): Promise<RepairReport> {
    const only = options.only ?? [];
    const except = options.except ?? [];
    const pageSize = options.pageSize ?? REPAIR_DEFAULT_PAGE_SIZE;
    const stockOwner = ownerOfEffect('stock.release');
    const creditOwner = ownerOfEffect('credit.release');
    // Asked once for the whole run: an operator command is one decision, and a
    // module flipped half-way through should not produce half a report.
    const stockExaminable = this.deps.isPresent(stockOwner);
    const creditExaminable = this.deps.isPresent(creditOwner);

    const stranded: StrandedOrder[] = [];
    const attempts: EffectAttemptSummary = { done: 0, blocked: 0, failed: 0, skipped: 0 };
    let examined = 0;
    let recorded = 0;
    let after = '00000000-0000-0000-0000-000000000000';

    if (stockExaminable || creditExaminable) {
      for (;;) {
        const page = await this.candidates(after, pageSize, stockExaminable, creditExaminable, {
          only,
          except,
        });
        if (page.length === 0) break;
        after = page[page.length - 1]!.id;
        examined += page.length;

        const found = await this.holdingsOf(page);
        stranded.push(...found);

        if (options.apply && found.length > 0) {
          recorded += await this.record(found);
          for (const order of found) {
            const summary = await this.deps.effects.drainForOrder(order.orderId);
            attempts.done += summary.done;
            attempts.blocked += summary.blocked;
            attempts.failed += summary.failed;
            attempts.skipped += summary.skipped;
          }
        }
        if (page.length < pageSize) break;
      }
    }

    return {
      applied: options.apply,
      examined,
      stranded,
      notExamined: [
        ...(stockExaminable ? [] : [stockOwner]),
        ...(creditExaminable ? [] : [creditOwner]),
      ],
      recorded,
      attempts,
    };
  }

  /**
   * One page of orders that *could* be stranded, from this module's own tables.
   *
   * A candidate for an effect is an order whose status owes it and that has
   * **no row for it at all**: an order with a row is already the mechanism's —
   * outstanding rows are retried by the sweep, completed ones are done. The two
   * effects are judged separately, so an order cancelled before the upgrade and
   * marked paid after it is still a candidate for its stock.
   *
   * Keyset-paged by id, so applying — which gives candidates a row and removes
   * them from the predicate — cannot make a page skip or repeat an order.
   */
  private candidates(
    after: string,
    pageSize: number,
    stock: boolean,
    credit: boolean,
    filter: { readonly only: readonly string[]; readonly except: readonly string[] },
  ): Promise<CandidateRow[]> {
    const marks = (ids: readonly string[]): string => ids.map(() => '?').join(', ');
    const onlyClause = filter.only.length > 0 ? `and o."id" in (${marks(filter.only)})` : '';
    const exceptClause =
      filter.except.length > 0 ? `and o."id" not in (${marks(filter.except)})` : '';
    return this.deps.emFactory().execute<CandidateRow[]>(
      `select * from (
         select o."id", o."business_id", o."organization_id", o."status", o."payment_status",
                (? and o."status" = 'cancelled' and not exists (
                   select 1 from "order_transition_effects" e
                    where e."order_id" = o."id" and e."effect" = 'stock.release'
                 )) as "wants_stock",
                (? and (o."status" = 'cancelled' or o."payment_status" = 'paid')
                   and o."payment_method_snapshot"->>'kind' = 'credit_limit'
                   and not exists (
                   select 1 from "order_transition_effects" e
                    where e."order_id" = o."id" and e."effect" = 'credit.release'
                 )) as "wants_credit"
           from "orders" o
          where o."id" > ?
            and (o."status" = 'cancelled' or o."payment_status" = 'paid')
            ${onlyClause}
            ${exceptClause}
       ) c
       where c."wants_stock" or c."wants_credit"
       order by c."id"
       limit ?`,
      [stock, credit, after, ...filter.only, ...filter.except, pageSize],
    );
  }

  /** Ask the owners what the candidates still hold; keep the ones that hold something. */
  private async holdingsOf(page: readonly CandidateRow[]): Promise<StrandedOrder[]> {
    const stockCandidates = page.filter((c) => c.wants_stock).map((c) => c.id);
    const creditCandidates = page.filter((c) => c.wants_credit).map((c) => c.id);

    const stockByOrder = new Map<string, StrandedOrder['stock'][number][]>();
    if (stockCandidates.length > 0) {
      const items = await this.deps.emFactory().execute<Array<{ id: string; order_id: string }>>(
        `select "id", "order_id" from "order_items"
          where "order_id" in (${stockCandidates.map(() => '?').join(', ')})`,
        stockCandidates,
      );
      const orderOfItem = new Map(items.map((item) => [item.id, item.order_id]));
      const held = await this.deps
        .stockRead()
        .unreleasedAllocationsForOrderItems(items.map((item) => item.id));
      for (const allocation of held) {
        const orderId = orderOfItem.get(allocation.orderItemId);
        if (orderId === undefined) continue;
        const list = stockByOrder.get(orderId) ?? [];
        list.push(allocation);
        stockByOrder.set(orderId, list);
      }
    }

    const creditByOrder = new Map<string, { amount: string; currency: string }>();
    if (creditCandidates.length > 0) {
      const held = await this.deps.creditRead().activeReservationsForOrders(creditCandidates);
      for (const reservation of held) {
        creditByOrder.set(reservation.orderId, {
          amount: reservation.amount,
          currency: reservation.currency,
        });
      }
    }

    return page.flatMap((candidate) => {
      const stock = stockByOrder.get(candidate.id) ?? [];
      const credit = creditByOrder.get(candidate.id) ?? null;
      if (stock.length === 0 && credit === null) return [];
      return [
        {
          orderId: candidate.id,
          businessId: candidate.business_id,
          organizationId: candidate.organization_id,
          status: candidate.status,
          paymentStatus: candidate.payment_status,
          stock,
          credit,
        },
      ];
    });
  }

  /**
   * Write the follow-up rows of one page — an operator write, so it runs
   * through the Command Bus and leaves one audit entry naming the orders.
   */
  private record(found: readonly StrandedOrder[]): Promise<number> {
    return this.deps.commandBus.run<number>({
      action: REPAIR_COMMAND_ACTION,
      objectType: 'order_transition_effects',
      objectId: randomUUID(),
      run: async ({ em }) => {
        let written = 0;
        const orders: Array<{ orderId: string; effects: string[] }> = [];
        for (const order of found) {
          // An order still `cancelled` owes its releases for that reason; one
          // that is only paid owes the credit release an invoice payment owes.
          const reason = order.status === 'cancelled' ? 'order_cancelled' : 'invoice_paid';
          const owed: OwedEffect[] = [
            ...(order.stock.length > 0 ? [{ effect: 'stock.release', reason } as const] : []),
            ...(order.credit !== null ? [{ effect: 'credit.release', reason } as const] : []),
          ];
          written += await this.deps.effects.record(
            em,
            { id: order.orderId, organizationId: order.organizationId },
            owed,
            'repair',
          );
          orders.push({ orderId: order.orderId, effects: owed.map((o) => o.effect) });
        }
        return {
          result: written,
          before: null,
          after: { orders, recorded: written },
          // No write, no audit row.
          skipAudit: written === 0,
        };
      },
    });
  }
}
