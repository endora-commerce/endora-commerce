import { orderStatusSchema, type OrderStatusOption } from '@b2b/contracts';

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
 */
export interface OrderStatusRegistry {
  /** The selectable Order-status options (code + human label). */
  list(): OrderStatusOption[];
  /** True when `code` is a known Order status. */
  has(code: string): boolean;
  /** Throws when `code` is not a known Order status. */
  assertValid(code: string): void;
}

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
