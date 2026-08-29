import {
  orderStatusSchema,
  type OrderStatusOption,
  type OrderStatusRegistry,
} from '@endora-commerce/contracts';

/**
 * OrderStatusRegistry port (feature 035 — research.md R3).
 *
 * `statusOnSuccess` / `statusOnFailure` on a delivery method reference *Order
 * Statuses*. Those will eventually be an admin-configurable registry owned by
 * the Orders module; until then this port is backed by the current hard-coded
 * order `status` enum. Consumers (admin upsert validation, receive-shipment
 * handler) depend only on this interface, so the future configurable registry
 * drops in with no change to `delivery_methods`.
 *
 * Deliberately a small, isolated duplicate of the payment_methods port rather
 * than a deep import across modules (constitution Principle I). The port does
 * NOT touch the Order entity — applying a status is the caller's job.
 *
 * The interface moved to `@endora-commerce/contracts` in feature 075's Phase P. It was
 * declared twice — once here and once in `payment_methods`, in the same words
 * — because both modules map an outcome onto an order status; one declaration
 * is what stops the two drifting. Re-exported here for the length of Phase P,
 * which cuts no consumer.
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
 * reason is that there is nothing to skip.** The delivery twin of
 * `payment_methods/services/order-status-registry.port.ts`, and the argument is
 * the same one: no module contributes to it, the option set is
 * `orderStatusSchema` fixed at compile time, and `shipments` reads `has` as a
 * guard before moving an order into the status a dispatched shipment names. A
 * skip would silently leave a shipped order in its old status; every code here
 * is one live orders are already in, and a status an order is in has to stay
 * nameable while the module holding this table is off.
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
