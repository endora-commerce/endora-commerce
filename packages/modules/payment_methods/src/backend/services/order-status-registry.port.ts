import {
  orderStatusSchema,
  type OrderStatusOption,
  type OrderStatusRegistry,
} from '@endora-commerce/contracts';

/**
 * OrderStatusRegistry port (feature 034 — research.md R2).
 *
 * `statusOnPending/Success/Failure` on a payment method reference *Order
 * Statuses*. Those will eventually be an admin-configurable registry owned by
 * the Orders module; until then this port is backed by the current hard-coded
 * order `status` enum. Consumers (admin upsert validation, order-service,
 * receive-payment handler) depend only on this interface, so the future
 * configurable registry drops in with no change to `payment_methods`.
 *
 * The port intentionally does NOT touch the Order entity — applying a status
 * to an order is done by the caller, which already owns the Order. This keeps
 * the module isolated (constitution Principle I).
 *
 * The interface moved to `@endora-commerce/contracts` in feature 075's Phase P — `orders`
 * and `payments` both read it. Re-exported here for the length of Phase P,
 * which cuts no consumer; the implementation below now `implements` the
 * published type, which is what keeps the two from drifting.
 */
export type { OrderStatusRegistry };

export class OrderStatusRegistryError extends Error {
  constructor(public readonly code: string) {
    super(`Unknown order status reference: "${code}".`);
    this.name = 'OrderStatusRegistryError';
  }
}

const humanize = (code: string): string =>
  code
    .split('_')
    .map((part) => (part.length > 0 ? part[0]!.toUpperCase() + part.slice(1) : part))
    .join(' ');

/**
 * Default enum-backed implementation. Seed set = the order `status` enum.
 *
 * **The absent-owner policy this registry states (issue #129): honour — and the
 * reason is that there is nothing to skip.** It is named a registry, and the
 * ledger classifies it as a contribution seam because `payments` reads it across
 * a module boundary, but no module contributes to it: the option set is
 * `orderStatusSchema`, fixed at compile time, so it holds no per-contributor
 * state that an operator's flip could invalidate and no entry that could outlive
 * the module that pushed it.
 *
 * Filtering would therefore not withdraw a stale answer, it would withdraw the
 * only answer — and the reads are guards rather than surfaces. `payments` asks
 * `has` before moving an order into the status a settled payment names, so a
 * skip would silently leave a paid order in its old status; a throw would make a
 * PSP webhook retry forever. Every status here is one live orders are already
 * in, and a status an order is in has to stay nameable while the module holding
 * this table is off. The buyer-facing consequence of that module being off is
 * carried where it belongs: `payment_methods` closes its own catalogue at its
 * own seam, and `orders` declares the sentence an operator is shown.
 *
 * The policy is structural rather than promised: the class takes no presence
 * input, so no read of it can be made to drop a status without changing the
 * policy first.
 */
export class EnumOrderStatusRegistry implements OrderStatusRegistry {
  private readonly codes: readonly string[] = orderStatusSchema.options;

  list(): OrderStatusOption[] {
    return this.codes.map((code) => ({ code, label: humanize(code) }));
  }

  has(code: string): boolean {
    return this.codes.includes(code);
  }

  assertValid(code: string): void {
    if (!this.has(code)) {
      throw new OrderStatusRegistryError(code);
    }
  }
}
