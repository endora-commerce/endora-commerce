/**
 * The `./ports` subpath — the port interfaces this module publishes, and
 * **nothing that exists at runtime** (layout contract R8, D-169).
 *
 * `tsc` compiles this file to `export {};`, and that emitted empty module is the
 * `default` condition's target. A `types`-only `exports` entry type-checks and
 * then answers `ERR_PACKAGE_PATH_NOT_EXPORTED` to any consumer whose toolchain
 * emits the import, which is every consumer that cannot prove the import is a
 * type. The implementation stays in `../backend/services/promotion-service.ts`
 * and is reached through the container name `promotionUsageFinalizer`, never
 * through this subpath.
 *
 * No entity class leaves by this door either, type-only included: D-168 shut
 * that door on `./backend` precisely so that a stranger's
 * `import type { Promotion } from '<pkg>/backend'` is a compile error in the
 * stranger's own tree, and erasure would make re-opening it free at runtime and
 * permanent at compile time.
 *
 * `backend/test/unit/packages/module-package-ports-surface.test.ts` holds this
 * file to all of that, over the real package.
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Who redeemed a promotion, as the usage row records it.
 *
 * It lives here rather than beside the implementation because
 * {@link PromotionUsageFinalizer.finalizeUsage} names it: a published signature
 * whose argument type is only reachable at a private path is a method a
 * consumer cannot write a variable for. It carries no ORM type of its own and
 * would be perfectly at home in `@endora-commerce/contracts` — it is here
 * because the interface that names it cannot be, and splitting one signature
 * across two packages buys nothing.
 */
export interface UsageContext {
  organizationId: string | null;
  customerAccountId: string | null;
  customerGroupId: string | null;
  /**
   * The channel the order was placed through. Non-nullable (D-48): the one
   * caller is `placeOrder`, which stamps the same id onto the order, and
   * `promotion_usages.sales_channel_id` is `uuid not null`. It used to be
   * `string | null` with a `?? randomUUID()` at the insert — issue #85's shape,
   * one table over: a fabricated id in a column the statistics aggregates
   * group by, so a usage row could never be joined back to a channel.
   */
  salesChannelId: string;
}

/** One promotion the placement applied, as the redemption row records it. */
export interface FinalizeAppliedPromotion {
  promotionId: string;
  couponId: string | null;
  amount: number;
}

/**
 * The co-transactional half of the promotion seam, typed by its owner (D-94.5).
 *
 * `orders` used to declare this method itself, on a `PromotionPort` interface
 * it wrote in `order-service.ts` and satisfied structurally. That is the shape
 * D-77 rejected: `lazyPort<T>` is an unchecked cast, so with `T` on the
 * consumer's side **nothing verifies that the provider still satisfies it** —
 * `PromotionService.finalizeUsage` could have changed its parameter shape and
 * `orders` would still have compiled. The interface therefore belongs to the
 * provider, and until this module became a package "the provider" meant a
 * relative import into `promotions/services/`, which is a reach into internals
 * the owner never offered. It is the same interface on a subpath its owner
 * declared: contract surface (D-171), which is what retires the
 * `permanent: true` ledger entry that stood for it.
 *
 * It stays **out of `@endora-commerce/contracts`** on purpose. The first
 * parameter is the caller's MikroORM `EntityManager`, and FR-034 forbids a
 * MikroORM type in the contracts package — `admin` and `storefront` both
 * compile it, which is why it holds zero `@mikro-orm` imports. That is what
 * qualifies this interface for `./ports` rather than for the contracts package:
 * the test is not *"is this a real published port"* but *"does this signature
 * stop the interface living in `packages/contracts`"* (D-171).
 *
 * The seam is not a defect in the design, it *is* the design:
 * `promotion_usages_order_fk` (`promotion_usages.order_id` -> `orders.id`,
 * `on delete restrict`) means the redemption row cannot exist before the order
 * does, and the order does not commit until `placeOrder` returns. A port that
 * opened its own transaction could not satisfy a foreign key against a row it
 * cannot see, and a cap hit at the last moment could no longer roll the order
 * back with it. A foreign key needs the **table** and never the class (D-169),
 * so that constraint stands while `./backend` publishes no entity class by
 * name.
 *
 * The read half is not here. `applyToCart` is `PromotionApplyPort` in
 * `@endora-commerce/contracts`, which `carts` already resolves under the same
 * container name; the consumer-declared duplicate of it was deleted with
 * `PromotionPort`.
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
