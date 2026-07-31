import type {
  PaymentAdapter,
  PaymentEligibilityContext,
  ReceivePaymentContext,
  PaymentOutcome,
  StartPaymentResult,
} from '@b2b/contracts';

/**
 * Built-in payment adapters (feature 034). These formalise the pre-existing
 * `payments/drivers/*` logic as `PaymentAdapter` implementations registered in
 * the PaymentAdapterRegistry. All bundled adapters are offline (no external
 * integration) except `gateway`, which delegates to the GatewayAdapterPort
 * wired by the integrations module.
 *
 * Validators default to `() => true` (FR-011). `onReceivePayment` echoes the
 * outcome the ingress already validated — the offline adapters do not
 * independently verify a payment; the gateway adapter overrides this in a
 * follow-up vendor module.
 */

const orderReference = (orderId: string): string => `ORDER-${orderId.slice(0, 8).toUpperCase()}`;

abstract class BaseAdapter implements PaymentAdapter {
  abstract readonly adapterKey: string;
  abstract readonly type: PaymentAdapter['type'];

  async validateUseOnStorefront(_ctx: PaymentEligibilityContext): Promise<boolean> {
    return true;
  }
  async validateUseOnAdmin(_ctx: PaymentEligibilityContext): Promise<boolean> {
    return true;
  }
  async validateUseInApi(_ctx: PaymentEligibilityContext): Promise<boolean> {
    return true;
  }

  abstract onStorefrontOrderCreated(ctx: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
  }): Promise<StartPaymentResult>;

  /**
   * Default: the ingress is the source of truth for the outcome (offline
   * methods are settled by an admin / out-of-band). Provider details and the
   * external reference flow straight through onto the Payment row.
   */
  async onReceivePayment(ctx: ReceivePaymentContext): Promise<PaymentOutcome> {
    return {
      result: 'success',
      externalReference: ctx.externalReference ?? null,
      ...(ctx.providerDetails ? { providerDetails: ctx.providerDetails } : {}),
    };
  }
}

/** Bank transfer (Przelew bankowy) — awaits an out-of-band transfer. */
export class BankTransferAdapter extends BaseAdapter {
  readonly adapterKey = 'bank_transfer';
  readonly type = 'bank_transfer' as const;

  async onStorefrontOrderCreated(ctx: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
  }): Promise<StartPaymentResult> {
    return { kind: 'awaiting_transfer', iban: null, reference: orderReference(ctx.orderId) };
  }
}

/** Cash on delivery / pickup (`Płatność przy odbiorze`) — settled on receipt. */
export class PickupAdapter extends BaseAdapter {
  readonly adapterKey = 'pickup';
  readonly type = 'pickup' as const;

  async onStorefrontOrderCreated(): Promise<StartPaymentResult> {
    return { kind: 'none' };
  }
}

/** Credit limit (`Limit kredytowy`) — reservation handled inline by OrderService. */
export class CreditLimitAdapter extends BaseAdapter {
  readonly adapterKey = 'credit_limit';
  readonly type = 'credit_limit' as const;

  async onStorefrontOrderCreated(): Promise<StartPaymentResult> {
    return { kind: 'none' };
  }
}

/**
 * Payment gateway (`Bramka płatności`) — a vendor adapter ships separately and
 * overrides `onStorefrontOrderCreated` to return a redirect. The bundled
 * placeholder returns `none`; the real redirect comes from the wired
 * GatewayAdapterPort.
 */
export class GatewayAdapter extends BaseAdapter {
  readonly adapterKey = 'gateway';
  readonly type = 'gateway' as const;

  async onStorefrontOrderCreated(): Promise<StartPaymentResult> {
    return { kind: 'none' };
  }
}

/** The adapters registered for the platform's built-in payment kinds. */
export function builtInPaymentAdapters(): PaymentAdapter[] {
  return [
    new BankTransferAdapter(),
    new PickupAdapter(),
    new CreditLimitAdapter(),
    new GatewayAdapter(),
  ];
}
