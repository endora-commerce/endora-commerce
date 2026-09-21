import { describe, expect, it } from 'vitest';
import type {
  PaymentAdapter,
  PaymentAdapterRegistryPort,
  PaymentEligibilityContext,
  PaymentMethodAdmin,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { manifest, PAYMENT_GATEWAY_FIXTURE_SETTING_CODES } from './manifest.js';
import {
  PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS,
  PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
  PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL,
  paymentGatewayFixtureAdapters,
  registerModule,
} from './backend.js';

/**
 * `payment_gateway_fixture` — the example deployment's stand-in payment gateway
 * (feature 134, FR-021; `contracts/extraction-procedure.md` W3).
 *
 * ## Why it exists, which is not "coverage"
 *
 * Wave 2 leaves this workspace with **no** cross-module contributor to
 * `paymentAdapterRegistry` and **no** implementor of the three things only a
 * vendor gateway does: `autopay`, `paypal`, `payu`, `stripe` and `tpay` are the
 * only modules that push a `PaymentAdapter` in from outside `payment_methods`,
 * and they leave. What is left is `payments`' four offline built-ins, registered
 * by `payments` under its own id — and reading them is what makes the gap
 * precise rather than asserted:
 *
 *  * they never return `StartPaymentResult`'s **`redirect`** arm, which is the
 *    only arm a hosted gateway ever returns;
 *  * they declare no **`renderers`**, the contract's one optional member;
 *  * their `onReceivePayment` cannot answer `PaymentOutcome`'s **`failure`**
 *    arm — `BaseAdapter` echoes the ingress as a success unconditionally — so
 *    `statusOnFailure` would have no adapter able to reach it;
 *  * and their validators `return true` without reading the context, so no
 *    implementor of `PaymentEligibilityContext` remains that can answer *no*.
 *
 * So the port would be *published with no foreign implementor in this
 * workspace*, and a breaking change to it would type-check green here and red in
 * a consumer's build days later (`spec.md` §6, FR-063). This module is what
 * keeps that an ordinary local type error, so it implements the **whole**
 * contract rather than the subset today's tests happen to read.
 * `Required<PaymentAdapter>` in `backend.ts` is the half `tsc` enforces; the
 * assertions below are the half it cannot.
 *
 * ## The off state, and where each half of it is proved
 *
 * The module contributes no route, no permission, no admin surface and no
 * storefront element, so item 6 of `specs/conventions/module-activation.md`
 * reduces here to the one seam it owns — and that seam has two halves with two
 * owners, exactly as `carrier_fixture`'s does:
 *
 *  * **this module's half** is that the push names *itself* as the contributor,
 *    because the contributor name is the only datum the owner's filter keys on,
 *    and that it lands *even while the module is absent*, because a contribution
 *    hook must never probe (D-67/D-68) or an operator's activation flip would
 *    need a restart. Both are asserted below;
 *  * **`payment_methods`' half** is that `get` / `list` / `isAvailable` /
 *    `ownerOf` filter on that name's effective state. That is the owner's
 *    behaviour, it is driven over this module by
 *    `backend/test/integration/payment_methods/gateway-presence.test.ts`, and it
 *    is not re-asserted here.
 *
 * **Do not "complete" this file by importing `PaymentAdapterRegistry`.**
 * `carrier_fixture`'s twin paragraph records why `check:module-boundary` refuses
 * it: this file is `backend/src` code, so a relative import into
 * `payment_methods`' internals is the reach Constitution I forbids, and the
 * remedy is the published type rather than a ledger entry.
 */

/**
 * The published contribution seam, implemented as a recorder.
 *
 * `implements PaymentAdapterRegistryPort` is load-bearing rather than tidy: it
 * is the assertion that this module still compiles against the whole port after
 * a change to it, from the consumer side, which is half of what FR-063 buys.
 */
class RecordingPaymentAdapterRegistry implements PaymentAdapterRegistryPort {
  readonly pushes: { adapterKey: string; module: string }[] = [];
  private readonly entries = new Map<string, { adapter: PaymentAdapter; module: string }>();

  register(adapter: PaymentAdapter, module: string): void {
    this.pushes.push({ adapterKey: adapter.adapterKey, module });
    this.entries.set(adapter.adapterKey, { adapter, module });
  }
  get(adapterKey: string): PaymentAdapter | undefined {
    return this.entries.get(adapterKey)?.adapter;
  }
  ownerOf(adapterKey: string): string | null {
    return this.entries.get(adapterKey)?.module ?? null;
  }
}

/** A `ModuleContext` shaped exactly as far as a contribution hook reaches. */
function contextStub(registry: unknown): {
  readonly ctx: ModuleContext;
  runBootHooks(): void;
} {
  const bootHooks: (() => void)[] = [];
  const ctx = {
    module: { id: PAYMENT_GATEWAY_FIXTURE_MODULE_ID },
    cradle: () => ({ paymentAdapterRegistry: registry }),
    onBoot: (hook: () => void) => bootHooks.push(hook),
  } as unknown as ModuleContext;
  return {
    ctx,
    runBootHooks: () => {
      for (const hook of bootHooks) hook();
    },
  };
}

const eligibilityContext = (
  overrides: Partial<PaymentEligibilityContext> = {},
): PaymentEligibilityContext => ({
  paymentMethod: {
    id: '00000000-0000-4000-8000-000000000001',
    code: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
    name: { default: 'Fixture redirect gateway' },
    kind: 'gateway',
    adapter: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
    status: 'active',
    additionalPrice: '0',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'on_hold',
  } as unknown as PaymentMethodAdmin,
  salesChannelId: null,
  organizationId: null,
  customerAccountId: null,
  surface: 'storefront',
  ...overrides,
});

const ORDER_ID = '11111111-2222-4333-8444-555555555555';
const PAYMENT_ID = '99999999-8888-4777-8666-555555555555';

const startContext = {
  orderId: ORDER_ID,
  paymentId: PAYMENT_ID,
  amount: 100,
  currency: 'PLN',
};

describe('payment_gateway_fixture — the manifest', () => {
  it('declares an activation control and the dependency its contribution needs', () => {
    expect(manifest.id).toBe(PAYMENT_GATEWAY_FIXTURE_MODULE_ID);
    expect(manifest.activation).toEqual({
      settingCode: PAYMENT_GATEWAY_FIXTURE_SETTING_CODES.ACTIVATION,
      default: true,
    });
    // Both presence axes apply to an overlay module unchanged (Principle XVII),
    // and the off-state cases are only meaningful if the module can be switched
    // off at all. `activation` is a union — a setting code, or a
    // `nonDeactivatable` declaration — so the narrowing *is* the assertion.
    expect(manifest.activation !== undefined && 'nonDeactivatable' in manifest.activation).toBe(
      false,
    );
    // `paymentAdapterRegistry` is `payment_methods`', reached from the boot
    // hook — a binding dependency, exactly as `stripe` declares it.
    expect(manifest.dependencies).toContain('payment_methods');
  });

  it('joins no capability family, because the payment gateways are not one', () => {
    // Derived rather than copied: `payments` discovers a gateway through the
    // **contribution seam** — a push naming its contributor, filtered by that
    // contributor's effective state — and not through
    // `declaredMembersOfCapability`. There is no gateway mutex and no exclusive
    // family, so a `capabilities` entry here would mint a family of one and
    // FR-016's shipped-off rule would then bind for no reason.
    expect(manifest.capabilities ?? []).toEqual([]);
  });
});

describe('payment_gateway_fixture — the port surface it restores', () => {
  it('implements every member of PaymentAdapter, including the optional one', () => {
    const adapters = paymentGatewayFixtureAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(2);

    for (const adapter of adapters) {
      // The required half. Written out rather than derived, because an
      // interface has no runtime reflection — the point is that this list is
      // the contract's, not "what the other tests happen to call".
      for (const member of [
        'validateUseOnStorefront',
        'validateUseOnAdmin',
        'validateUseInApi',
        'onStorefrontOrderCreated',
        'onReceivePayment',
      ] as const) {
        expect(typeof adapter[member], `${adapter.adapterKey}.${member}`).toBe('function');
      }
      expect(adapter.type, adapter.adapterKey).toBe('gateway');
      // The member that goes to **zero** implementors when the wave lands:
      // `payments`' four built-ins declare none.
      expect(adapter.renderers?.storefront, adapter.adapterKey).toBeTypeOf('string');
    }
  });

  it('covers the redirect arm and the hosted arm of StartPaymentResult', async () => {
    const [redirect, hosted] = paymentGatewayFixtureAdapters();

    const started = await redirect!.onStorefrontOrderCreated(startContext);
    expect(started.kind).toBe('redirect');

    // The hosted arm is `none`: the buyer is settled by a notification that
    // arrives later, with nothing for the storefront to follow at placement.
    expect(await hosted!.onStorefrontOrderCreated(startContext)).toEqual({ kind: 'none' });
  });

  it('hands the buyer back to the resolving landing, never to the success page', async () => {
    // Issue #287's rule, and the only subject it has in this repository once the
    // five gateways leave. `storefrontPaymentReturnUrl` is the free contract
    // helper every gateway hook builds its return URL from; what the rule
    // forbids is a hook naming `/checkout/success`, because that page fires the
    // purchase conversion and a buyer can replay the URL before the settlement
    // notification lands.
    const [redirect] = paymentGatewayFixtureAdapters();
    const started = await redirect!.onStorefrontOrderCreated(startContext);
    expect(started.kind).toBe('redirect');
    const url = (started as { kind: 'redirect'; url: string }).url;
    expect(url).toBe(
      `${PAYMENT_GATEWAY_FIXTURE_STOREFRONT_BASE_URL}/checkout/return?id=${ORDER_ID}&outcome=returned`,
    );
    expect(url).not.toContain('/checkout/success');
  });

  it('answers both arms of PaymentOutcome, which the built-ins cannot', async () => {
    const [redirect] = paymentGatewayFixtureAdapters();

    expect(
      await redirect!.onReceivePayment({
        orderId: ORDER_ID,
        paymentId: PAYMENT_ID,
        externalReference: 'PGF-1',
        providerDetails: { outcome: 'failure', reason: 'declined_by_issuer' },
      }),
    ).toEqual({
      result: 'failure',
      failureReason: 'declined_by_issuer',
      providerDetails: { outcome: 'failure', reason: 'declined_by_issuer' },
    });

    expect(
      await redirect!.onReceivePayment({
        orderId: ORDER_ID,
        paymentId: PAYMENT_ID,
        externalReference: 'PGF-2',
      }),
    ).toEqual({ result: 'success', externalReference: 'PGF-2' });
  });

  it('has validators that can answer no, on all three surfaces', async () => {
    // A validator hard-coded to `true` exercises none of the three call sites
    // that read it. The answer is derived from the method the platform is
    // asking about, so the fixture needs nothing configured to say no.
    for (const adapter of paymentGatewayFixtureAdapters()) {
      const active = eligibilityContext({
        paymentMethod: { ...eligibilityContext().paymentMethod, status: 'active' },
      });
      const inactive = eligibilityContext({
        paymentMethod: { ...eligibilityContext().paymentMethod, status: 'inactive' },
      });
      for (const surface of [
        'validateUseOnStorefront',
        'validateUseOnAdmin',
        'validateUseInApi',
      ] as const) {
        expect(await adapter[surface](active), `${adapter.adapterKey}.${surface}`).toBe(true);
        expect(await adapter[surface](inactive), `${adapter.adapterKey}.${surface}`).toBe(false);
      }
    }
  });
});

describe('payment_gateway_fixture — the contribution seam', () => {
  it('pushes both adapters naming itself as the contributor', () => {
    const registry = new RecordingPaymentAdapterRegistry();
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    // Nothing is pushed before the boot hook runs: the registry is read at use
    // time and never captured into a singleton at registration.
    expect(registry.pushes).toEqual([]);

    runBootHooks();
    expect(registry.pushes).toEqual([
      {
        adapterKey: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT,
        module: PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
      },
      {
        adapterKey: PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.HOSTED,
        module: PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
      },
    ]);
    expect(registry.ownerOf(PAYMENT_GATEWAY_FIXTURE_ADAPTER_KEYS.REDIRECT)).toBe(
      PAYMENT_GATEWAY_FIXTURE_MODULE_ID,
    );
  });

  it('contributes without probing its own presence (D-67/D-68)', () => {
    // The push must land whatever this module's effective state is: the owner
    // filters the enumeration by contributor at every read, per request, so a
    // probe here would make an operator's activation flip need a restart. The
    // context stub offers no presence probe at all, so a hook that asked for
    // one would throw rather than quietly read `undefined`.
    const registry = new RecordingPaymentAdapterRegistry();
    const { ctx, runBootHooks } = contextStub(registry);
    registerModule(ctx);
    expect(() => runBootHooks()).not.toThrow();
    expect(registry.pushes).toHaveLength(2);
  });
});
