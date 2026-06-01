import { orderStatusSchema, type OrderStatusOption } from '@b2b/contracts';

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

/** Default enum-backed implementation. Seed set = the order `status` enum. */
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
