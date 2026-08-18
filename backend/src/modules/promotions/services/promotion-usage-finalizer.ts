import type { EntityManager } from '@mikro-orm/postgresql';
import type { FinalizeAppliedPromotion, UsageContext } from './promotion-usage-service.js';

/**
 * The co-transactional half of the promotion seam, typed by its owner (D-94.5).
 *
 * `orders` used to declare this method itself, on a `PromotionPort` interface
 * it wrote in `order-service.ts` and satisfied structurally. That is the shape
 * D-77 rejected: `lazyPort<T>` is an unchecked cast, so with `T` on the
 * consumer's side **nothing verifies that the provider still satisfies it** —
 * `PromotionService.finalizeUsage` could have changed its parameter shape and
 * `orders` would still have compiled. The interface therefore lives here,
 * beside the implementation, and `orders` imports it as a type: the provider's
 * own declaration is what `tsc` checks both ends against.
 *
 * It stays **out of `@b2b/contracts`** on purpose. The first parameter is the
 * caller's MikroORM `EntityManager`, and FR-034 forbids a MikroORM type in the
 * contracts package. That is not an oversight in the seam — it is the seam:
 * `promotion_usages_order_fk` (`promotion_usages.order_id` -> `orders.id`,
 * `on delete restrict`) means the redemption row cannot exist before the order
 * does, and the order does not commit until `placeOrder` returns. A port that
 * opened its own transaction could not satisfy a foreign key against a row it
 * cannot see, and a cap hit at the last moment could no longer roll the order
 * back with it. So the import from `orders` is a **permanent** entry in the
 * cross-module ledger rather than debt, and it names this constraint.
 *
 * The read half is not here. `applyToCart` is `PromotionApplyPort` in
 * `@b2b/contracts`, which `carts` already resolves under the same container
 * name; the consumer-declared duplicate of it was deleted with `PromotionPort`.
 */
export interface PromotionUsageFinalizer {
  /**
   * Finalize usage for a placed order. **Must** run on the placement
   * `EntityManager`: counters are bumped with `update … where count < limit`,
   * so two carts racing for the final use can never both succeed, and a cap
   * hit here throws 409 so the transaction rolls back.
   */
  finalizeUsage(
    em: EntityManager,
    input: {
      orderId: string;
      currency: string;
      ctx: UsageContext;
      applied: FinalizeAppliedPromotion[];
    },
  ): Promise<void>;
}
