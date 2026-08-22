import type { PromotionAction } from '@endora-commerce/contracts';
import type { CartApplyContext, DiscountResult, PromotionActionDefinition } from '../actions/types.js';
import { freeDeliveryAction } from '../actions/free-delivery.js';
import { percentageOffCartAction } from '../actions/percentage-off-cart.js';
import { amountOffCartAction } from '../actions/amount-off-cart.js';
import { buyXGetYFreeAction } from '../actions/buy-x-get-y-free.js';
import { spendXPercentOffAction } from '../actions/spend-x-percent-off.js';
import { spendXAmountOffAction } from '../actions/spend-x-amount-off.js';
import { everyNthProductPercentOffAction } from '../actions/every-nth-product-percent-off.js';
import { buyXUnitsYFreeAction } from '../actions/buy-x-units-y-free.js';
import { buyXUnitsPercentOffAction } from '../actions/buy-x-units-percent-off.js';
import { buyXUnitsAmountOffAction } from '../actions/buy-x-units-amount-off.js';

/**
 * Registry of promotion actions (FR-012). The 10 built-ins register at
 * construction; other modules contribute additional action types via
 * `register(...)` during composition — the same extension-point shape used
 * by the payment / shipping adapter registries.
 */
export class PromotionActionRegistry {
  private readonly defs = new Map<string, PromotionActionDefinition>();

  register<C extends PromotionAction>(def: PromotionActionDefinition<C>): void {
    // Definitions are keyed by their action `type`. The cast widens the
    // per-variant config back to the union so heterogeneous definitions can
    // live in one map; `apply` is only ever invoked with the matching variant.
    this.defs.set(def.type, def as unknown as PromotionActionDefinition);
  }

  get(type: string): PromotionActionDefinition | null {
    return this.defs.get(type) ?? null;
  }

  list(): PromotionActionDefinition[] {
    return [...this.defs.values()];
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  /** Apply a configured action against a cart context. Throws on unknown type. */
  apply(action: PromotionAction, ctx: CartApplyContext): DiscountResult {
    const def = this.defs.get(action.type);
    if (!def) throw new Error(`unknown_promotion_action: ${action.type}`);
    return def.apply(action, ctx);
  }
}

/** Build a registry pre-loaded with all built-in actions. */
export function createPromotionActionRegistry(): PromotionActionRegistry {
  const registry = new PromotionActionRegistry();
  registry.register(freeDeliveryAction);
  registry.register(percentageOffCartAction);
  registry.register(amountOffCartAction);
  registry.register(buyXGetYFreeAction);
  registry.register(spendXPercentOffAction);
  registry.register(spendXAmountOffAction);
  registry.register(everyNthProductPercentOffAction);
  registry.register(buyXUnitsYFreeAction);
  registry.register(buyXUnitsPercentOffAction);
  registry.register(buyXUnitsAmountOffAction);
  return registry;
}
