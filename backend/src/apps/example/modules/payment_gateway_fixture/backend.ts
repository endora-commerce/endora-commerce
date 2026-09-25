import {
  storefrontPaymentReturnUrl,
  type GatewayRefundHandler,
  type GatewayRefundRegistryPort,
  type PaymentAdapter,
  type PaymentAdapterRegistryPort,
  type PaymentEligibilityContext,
  type PaymentOutcome,
  type PaymentRefundInput,
  type PaymentRefundResult,
  type ReceivePaymentContext,
  type StartPaymentResult,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../../../kernel/index.js';
import { lazyPort } from '../../../../kernel/index.js';

/**
 * `payment_gateway_fixture` — the example deployment's stand-in payment gateway
 * (feature 134, FR-021/FR-063).
 *
 * ## What it implements, and why it is the whole contract
 *
 * `Required<PaymentAdapter>`, not `PaymentAdapter`. The difference is the point
 * of the module: `PaymentAdapter` makes `renderers` optional, `payments`' four
 * built-ins declare none, and the only implementors of it are the five gateway
 * modules wave 2 removes. An adapter that satisfied the *required* half would
 * leave that member published with no implementor here — the exact state FR-021
 * exists to prevent, arriving through the fixture written to prevent it. So it
 * is implemented, and `Required<…>` is what refuses a fixture that quietly drops
 * it later.
 *
 * Three more things go to zero implementors with the wave, and none of them is
 * an optional member, so `tsc` cannot ask for them — the assertions in
 * `payment-gateway-fixture.test.ts` do:
 *
 *  * **`StartPaymentResult`'s `redirect` arm.** `BankTransferAdapter` answers
 *    `awaiting_transfer`; `Pickup`, `CreditLimit` and the placeholder
 *    `GatewayAdapter` answer `none`. Nothing free returns a redirect.
 *  * **`PaymentOutcome`'s `failure` arm.** `payments`' `BaseAdapter` echoes the
 *    ingress as a success unconditionally, so a method's `statusOnFailure`
 *    mapping would have no adapter able to reach it.
 *  * **A validator that can answer no.** All four built-ins `return true`
 *    without reading the context, so no implementor of
 *    `PaymentEligibilityContext` would be left that consults it.
 *
 * ## What it does not implement
 *
 * No settings read, no credential, no HTTP client, no persistence, no route, no
 * permission and no admin or storefront surface. Every answer below is derived
 * from the context it is handed, so the module composes in any deployment with
 * nothing configured — a fixture that needed setting up would not be one. It
 * owns no table and no migration, which an overlay module may contribute anyway
 * (`specs/conventions/overlay-modules.md`, D-106) and which it needs neither of:
 * the `payment_methods` row a gateway is offered through belongs to
 * `payment_methods`, exactly as it does for the five real gateways.
 *
 * ## The boot hook contributes and does not probe
 *
 * D-67/D-68: a hook that pushes an inert descriptor into another module's
 * registry must **not** ask whether its own module is present. `payment_methods`
 * filters by contributor at every read, per request, so an operator switching
 * this module on or off takes effect immediately; a probe here would make the
 * flip need a restart. There is no work beside the contribution, so there is
 * nothing to split out.
 */

export const PAYMENT_GATEWAY_FIXTURE_MODULE_ID = 'payment_gateway_fixture';

export const PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS = {
  REDIRECT: 'payment_gateway_fixture_redirect',
  HOSTED: 'payment_gateway_fixture_hosted',
} as const;

/**
 * The origin the redirect adapter builds its landing on.
 *
 * A constant rather than `process.env['STOREFRONT_BASE_URL']`, which is what the
 * five real gateways read. Two reasons, and the second is the one that decides
 * it: this module must compose with nothing configured, and an environment read
 * in `backend/src` is an input `check:env-inputs` requires the **application**
 * tree to declare — putting a fixture's knob into the prompt a client's operator
 * answers and into the `.env` their shop runs on. The rule under test is which
 * *path* a gateway hands the buyer back to, and the origin is not part of it.
 */
export const PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL = 'https://storefront.example';

/**
 * Eligibility, for both adapters: the method the platform is asking about has to
 * be active. It is deliberately derived from the context rather than hard-coded
 * to `true` — a validator that cannot say no exercises none of the three call
 * sites that read it, and after wave 2 nothing else in this repository can.
 */
function methodIsUsable(ctx: PaymentEligibilityContext): boolean {
  return ctx.paymentMethod.status === 'active';
}

/**
 * The shared half of both adapters. Split out rather than repeated so that a
 * member added to the contract is implemented once and `tsc` still names this
 * file when it is not implemented at all.
 */
abstract class BasePaymentGatewayFixtureAdapter implements Required<PaymentAdapter> {
  abstract readonly adapterKey: string;
  abstract readonly renderers: { storefront?: string; admin?: string; email?: string };

  /**
   * Every fixture adapter is a `gateway`, and that is the classification under
   * test: the three other `PaymentMethodKind` values are the offline kinds
   * `payments` already owns, and a fixture claiming one of them would stand in
   * for a built-in rather than for the vendor modules that leave.
   */
  readonly type = 'gateway' as const;

  async validateUseOnStorefront(ctx: PaymentEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  async validateUseOnAdmin(ctx: PaymentEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  async validateUseInApi(ctx: PaymentEligibilityContext): Promise<boolean> {
    return methodIsUsable(ctx);
  }

  abstract onStorefrontOrderCreated(ctx: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
  }): Promise<StartPaymentResult>;

  /**
   * Maps the ingress to an outcome, **both ways**.
   *
   * A fixture that could only answer `success` would leave a payment method's
   * `statusOnFailure` mapping with no adapter able to reach it, which is half of
   * what the receive path is for. `providerDetails.outcome === 'failure'` is this
   * fixture's own ingress vocabulary — a real gateway reads its notification
   * body here — and `providerDetails.reason` carries the reason through.
   */
  async onReceivePayment(ctx: ReceivePaymentContext): Promise<PaymentOutcome> {
    const details = ctx.providerDetails;
    if (details?.['outcome'] === 'failure') {
      const reason = details['reason'];
      return {
        result: 'failure',
        failureReason:
          typeof reason === 'string' ? reason : 'payment_gateway_fixture_failure',
        providerDetails: details,
      };
    }
    return {
      result: 'success',
      externalReference: ctx.externalReference ?? null,
      ...(details ? { providerDetails: details } : {}),
    };
  }
}

/**
 * The redirect half of the contract — the shape a hosted paywall uses: the buyer
 * leaves for the provider and is handed back to the platform's own landing.
 *
 * **The landing is built through `storefrontPaymentReturnUrl` and never names
 * `/checkout/success`** (issue #287). That rule belongs to the platform rather
 * than to any one gateway, which is why the helper is a free contract; after
 * wave 2 this adapter is its only implementor in this repository, and
 * `backend/test/unit/payments/gateway-return-urls.test.ts` drives it here.
 */
export class PaymentGatewayFixtureRedirectAdapter extends BasePaymentGatewayFixtureAdapter {
  readonly adapterKey = PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT;
  readonly renderers = { storefront: 'payment_gateway_fixture.redirect' };

  async onStorefrontOrderCreated(ctx: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
  }): Promise<StartPaymentResult> {
    return {
      kind: 'redirect',
      url: storefrontPaymentReturnUrl(
        PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL,
        ctx.orderId,
        'returned',
      ),
    };
  }
}

/**
 * The hosted half — nothing for the storefront to follow at placement, the
 * outcome arriving later on the ingress. Between the two adapters every arm a
 * `gateway`-kind method can take is reachable, and the pair is what makes the
 * receive path's success and failure branches both drivable from this module.
 */
export class PaymentGatewayFixtureHostedAdapter extends BasePaymentGatewayFixtureAdapter {
  readonly adapterKey = PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.HOSTED;
  readonly renderers = { storefront: 'payment_gateway_fixture.hosted' };

  async onStorefrontOrderCreated(): Promise<StartPaymentResult> {
    return { kind: 'none' };
  }
}

/** The adapters this module contributes, in registration order. */
export function paymentGatewayFixtureAdapters(): PaymentAdapter[] {
  return [new PaymentGatewayFixtureRedirectAdapter(), new PaymentGatewayFixtureHostedAdapter()];
}

/**
 * A deterministic refund implementation for the free host's contribution
 * seam. It contacts no provider and records no state; an enabled fixture
 * reports a failed provider refund, while the registry must refuse the same
 * request before this method is called when the fixture is absent.
 */
export class PaymentGatewayFixtureRefundHandler implements GatewayRefundHandler {
  readonly adapterKey = PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT;

  async refund(_input: PaymentRefundInput): Promise<PaymentRefundResult> {
    return {
      state: 'failed',
      failureReason: 'The payment gateway fixture does not issue external refunds.',
    };
  }
}

export function registerModule(ctx: ModuleContext): void {
  // Contribution only — the registry is read at use time and never captured
  // into a singleton, and the push names its contributor so that
  // `payment_methods` can filter it by this module's effective state.
  ctx.onBoot(() => {
    const registry = lazyPort<PaymentAdapterRegistryPort>(ctx, 'paymentAdapterRegistry');
    for (const adapter of paymentGatewayFixtureAdapters()) {
      registry.register(adapter, PAYMENT_GATEWAY_FIXTURE_MODULE_ID);
    }
    lazyPort<GatewayRefundRegistryPort>(ctx, 'gatewayRefundRegistry').register(
      new PaymentGatewayFixtureRefundHandler(),
      PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
    );
  });
}
