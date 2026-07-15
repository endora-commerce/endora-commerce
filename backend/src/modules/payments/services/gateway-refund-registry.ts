import type {
  PaymentRefundInput,
  PaymentRefundResult,
} from '../../returns/ports/payment-refund.port.js';

/**
 * GatewayRefundRegistry (feature 049) — the generic seam through which a PSP
 * vendor module (e.g. Stripe) fulfils refunds for `kind === 'gateway'` payments.
 *
 * Mirrors the PaymentAdapterRegistry pattern: the module lifecycle install-hook
 * context cannot carry services, so a vendor module registers its refund handler
 * into this process-wide singleton on enable. `PaymentRefundProvider` consults
 * it for gateway payments and falls back to `pending_manual` when no handler is
 * registered — keeping the `payments` and `returns` modules provider-agnostic.
 */
export interface GatewayRefundHandler {
  /** The payment adapter key this handler serves (e.g. `stripe`). */
  readonly adapterKey: string;
  refund(input: PaymentRefundInput): Promise<PaymentRefundResult>;
}

export class GatewayRefundRegistry {
  private readonly handlers = new Map<string, GatewayRefundHandler>();

  register(handler: GatewayRefundHandler): void {
    this.handlers.set(handler.adapterKey, handler);
  }

  unregister(adapterKey: string): void {
    this.handlers.delete(adapterKey);
  }

  get(adapterKey: string): GatewayRefundHandler | undefined {
    return this.handlers.get(adapterKey);
  }

  /**
   * Resolve the handler for a gateway payment. Today a single gateway vendor is
   * expected at a time, so an `adapterKey`-less lookup returns the sole
   * registered handler; when the adapter is known, it is preferred.
   */
  resolve(adapterKey?: string | null): GatewayRefundHandler | undefined {
    if (adapterKey) {
      const exact = this.handlers.get(adapterKey);
      if (exact) return exact;
    }
    const [only] = this.handlers.values();
    return only;
  }

  list(): string[] {
    return [...this.handlers.keys()];
  }
}

/** Process-wide singleton — the cross-module registration seam. */
export const gatewayRefundRegistry = new GatewayRefundRegistry();
