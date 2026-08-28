import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Gateway adapter port (T141 / FR-009).
 *
 * Per-vendor payment-gateway adapters implement this interface in
 * follow-up specs (Stripe, Przelewy24, PayU, …). The port stays in the
 * core so the order-placement transaction has a stable contract to
 * dispatch through, and so a gateway adapter can be swapped without
 * touching `order-service.ts`.
 *
 * Until a real adapter ships, `GatewayAdapterPortNotWired` returns
 * `501 NOT_IMPLEMENTED` from any reserve/settle call. Order placement
 * with a `gateway`-kind PaymentMethod therefore fails fast with a clear
 * error rather than silently 500'ing.
 */

export type Currency = string; // ISO 4217

export interface GatewayReserveInput {
  orderId: string;
  organizationId: string;
  amount: number;
  currency: Currency;
  /** Per-payment-method config; opaque to the port. */
  vendorConfig: Record<string, unknown>;
  tx: EntityManager;
}

export interface GatewaySettleInput {
  orderId: string;
  paymentRef: string;
  vendorConfig: Record<string, unknown>;
  tx: EntityManager;
}

export type GatewayReserveResult =
  | { ok: true; paymentRef: string; nextAction: { kind: 'redirect'; url: string } | { kind: 'none' } }
  | { ok: false; code: string; message: string };

export interface GatewayAdapterPort {
  /** Vendor identifier, e.g. `stripe`. Matches the adapter's own module. */
  readonly vendor: string;
  reserve(input: GatewayReserveInput): Promise<GatewayReserveResult>;
  settle(input: GatewaySettleInput): Promise<{ ok: true } | { ok: false; code: string }>;
}

/**
 * Default placeholder until a per-vendor adapter is wired by the
 * integrations module's composition root. Implements the contract
 * surface so type-checking passes everywhere; throws at runtime when
 * the order-placement transaction tries to use it.
 */
export class GatewayAdapterPortNotWired implements GatewayAdapterPort {
  readonly vendor = 'unwired';

  async reserve(_input: GatewayReserveInput): Promise<GatewayReserveResult> {
    throw new HttpError(
      501,
      ERROR_CODES.INTERNAL,
      'No payment-gateway adapter is configured. Configure a vendor under /admin/integrations or use a non-gateway PaymentMethod.',
    );
  }

  async settle(_input: GatewaySettleInput): Promise<{ ok: false; code: string }> {
    throw new HttpError(
      501,
      ERROR_CODES.INTERNAL,
      'No payment-gateway adapter is configured.',
    );
  }
}
