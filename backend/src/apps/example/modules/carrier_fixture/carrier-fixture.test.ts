import { describe, expect, it } from 'vitest';
import type {
  DeliveryMethodAdmin,
  ShippingAdapter,
  ShippingAdapterRegistryPort,
  ShippingEligibilityContext,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import {
  CARRIER_FIXTURE_SETTING_CODES,
  manifest,
} from './manifest.js';
import {
  CARRIER_FIXTURE_ADAPTER_KEYS,
  CARRIER_FIXTURE_MODULE_ID,
  carrierFixtureAdapters,
  registerModule,
} from './backend.js';

/**
 * `carrier_fixture` — the example deployment's stand-in carrier (feature 134,
 * FR-021; `contracts/extraction-procedure.md` W3).
 *
 * ## Why it exists, which is not "coverage"
 *
 * Wave 1 takes `inpost` and `dhl_parcel` out of this repository, and with them
 * the **only** cross-module contributors to `shippingAdapterRegistry` and the
 * only implementors of `ShippingAdapter`'s two optional members. What is left
 * is `delivery_methods`' own pair of offline built-ins, registered by
 * `delivery_methods` under its own id: they never exercise the contribution
 * seam, never opt into auto-creation on paid, and declare no renderer.
 *
 * So the port would be *published with no foreign implementor*, and a breaking
 * change to it would type-check green here and red in another repository days
 * later (`spec.md` §6, FR-063). This module is what keeps that an ordinary
 * local type error, so it implements the **whole** contract — every required
 * member and both optional ones — rather than the subset today's tests happen
 * to read. `Required<ShippingAdapter>` in `backend.ts` is the half `tsc`
 * enforces; the assertions below are the half it cannot.
 *
 * ## The off state, and where each half of it is proved
 *
 * The module contributes no route, no permission, no admin surface and no
 * storefront element, so item 6 of `specs/conventions/module-activation.md`
 * reduces here to the one seam it does own — and that seam has two halves with
 * two owners, which is why this file does not assert both:
 *
 *  * **this module's half** is that the push names *itself* as the contributor,
 *    because the contributor name is the only datum the owner's filter keys on.
 *    That is asserted below, on both axes: the push lands under
 *    `carrier_fixture` and it lands *even while the module is absent*, because a
 *    contribution hook must never probe (D-67/D-68) or an operator's activation
 *    flip would need a restart;
 *  * **`delivery_methods`' half** is that `isAvailable` / `get` / `list` /
 *    `resolve` / `absentOwnerFor` filter on that name's effective state. That is
 *    the owner's behaviour and the owner already tests it, beside its own
 *    subject in `shipping-adapter-registry.test.ts`.
 *
 * **Do not "complete" this file by importing `ShippingAdapterRegistry`.** It was
 * written that way first and `check:module-boundary` refused it, correctly: this
 * file is `backend/src` code, so it is *module* code, and a relative import into
 * `delivery_methods`' internals is the reach Constitution I forbids — the remedy
 * for which is the published type, not a ledger entry. Asserting the owner's
 * filtering here as well would also be two answers to one question, which is the
 * shape this repository keeps paying for. The double below implements
 * `ShippingAdapterRegistryPort` in full, so the contribution seam's *type* is
 * still exercised from this side.
 */

/**
 * The published contribution seam, implemented as a recorder.
 *
 * `implements ShippingAdapterRegistryPort` is load-bearing rather than tidy: it
 * is the assertion that this module still compiles against the whole port after
 * a change to it, from the consumer side, which is half of what FR-063 buys.
 */
class RecordingAdapterRegistry implements ShippingAdapterRegistryPort {
  readonly pushes: { adapterKey: string; module: string }[] = [];
  private readonly entries = new Map<string, { adapter: ShippingAdapter; module: string }>();

  register(adapter: ShippingAdapter, module: string): void {
    this.pushes.push({ adapterKey: adapter.adapterKey, module });
    this.entries.set(adapter.adapterKey, { adapter, module });
  }
  unregister(adapterKey: string): void {
    this.entries.delete(adapterKey);
  }
  isRegistered(adapterKey: string): boolean {
    return this.entries.has(adapterKey);
  }
  /** Presence is the owner's question; this double answers the blind half only. */
  isAvailable(adapterKey: string): boolean {
    return this.entries.has(adapterKey);
  }
  get(adapterKey: string): ShippingAdapter | undefined {
    return this.entries.get(adapterKey)?.adapter;
  }
  resolve(adapterKey: string): ShippingAdapter {
    const adapter = this.get(adapterKey);
    if (!adapter) throw new Error(`no adapter for "${adapterKey}"`);
    return adapter;
  }
  list(): string[] {
    return [...this.entries.keys()];
  }
  listAll(): string[] {
    return [...this.entries.keys()];
  }
  ownerOf(adapterKey: string): string | null {
    return this.entries.get(adapterKey)?.module ?? null;
  }
  absentOwnerFor(): string | null {
    return null;
  }
}

/** A `ModuleContext` shaped exactly as far as a contribution hook reaches. */
function contextStub(registry: unknown): {
  readonly ctx: ModuleContext;
  runBootHooks(): void;
} {
  const bootHooks: (() => void)[] = [];
  const ctx = {
    module: { id: CARRIER_FIXTURE_MODULE_ID },
    cradle: () => ({ shippingAdapterRegistry: registry }),
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
  overrides: Partial<ShippingEligibilityContext> = {},
): ShippingEligibilityContext => ({
  deliveryMethod: {
    id: '00000000-0000-4000-8000-000000000001',
    code: 'carrier_fixture_courier',
    name: { default: 'Fixture courier' },
    adapter: CARRIER_FIXTURE_ADAPTER_KEYS.COURIER,
    cost: '10.00',
    currency: 'PLN',
    status: 'active',
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
  } as unknown as DeliveryMethodAdmin,
  salesChannelId: null,
  organizationId: null,
  customerAccountId: null,
  surface: 'storefront',
  ...overrides,
});

describe('carrier_fixture — the manifest', () => {
  it('declares an activation control and the dependency its contribution needs', () => {
    expect(manifest.id).toBe(CARRIER_FIXTURE_MODULE_ID);
    expect(manifest.activation).toEqual({
      settingCode: CARRIER_FIXTURE_SETTING_CODES.ACTIVATION,
      default: true,
    });
    // Both presence axes apply to an overlay module unchanged (Principle XVII),
    // and the off-state cases below are only meaningful if the module can be
    // switched off at all. `activation` is a union — a setting code, or a
    // `nonDeactivatable` declaration — so the narrowing *is* the assertion: a
    // fixture declaring the second variant would have no absent state for the
    // seam cases below to drive.
    expect(manifest.activation !== undefined && 'nonDeactivatable' in manifest.activation).toBe(
      false,
    );
    // `shippingAdapterRegistry` is `delivery_methods`', reached from the boot
    // hook — a binding dependency, exactly as `dhl_parcel` declares it.
    expect(manifest.dependencies).toContain('delivery_methods');
  });
});

describe('carrier_fixture — the port surface it restores', () => {
  it('implements every member of ShippingAdapter, including both optional ones', () => {
    const adapters = carrierFixtureAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(2);

    for (const adapter of adapters) {
      // The required half. Written out rather than derived, because an
      // interface has no runtime reflection — the point is that this list is
      // the contract's, not "what the other tests happen to call".
      for (const member of [
        'validateUseOnStorefront',
        'validateUseOnAdmin',
        'validateUseInApi',
        'onOrderCreated',
        'onShipmentCreated',
        'onReceiveShipment',
      ] as const) {
        expect(typeof adapter[member], `${adapter.adapterKey}.${member}`).toBe('function');
      }
      // The two members that go to **zero** implementors when the wave lands:
      // `delivery_methods`' offline built-ins declare neither.
      expect(typeof adapter.shouldAutoCreateOnPaid, adapter.adapterKey).toBe('function');
      expect(adapter.renderers?.storefront, adapter.adapterKey).toBeTypeOf('string');
    }
  });

  it('covers both settled and pending generation, and both receive outcomes', async () => {
    const [courier, pickup] = carrierFixtureAdapters();

    // `pending` — the carrier was asked and will answer later, the shape the
    // webhook-settled carriers used.
    await expect(
      courier!.onShipmentCreated({
        orderId: 'o-1',
        shipmentId: 's-1',
        deliveryMethodId: 'd-1',
        attemptNo: 1,
      }),
    ).resolves.toMatchObject({ kind: 'pending' });

    // `generated` — settled in the create transaction, with a tracking number.
    const generated = await pickup!.onShipmentCreated({
      orderId: 'o-1',
      shipmentId: 's-2',
      deliveryMethodId: 'd-2',
      attemptNo: 1,
    });
    expect(generated.kind).toBe('generated');

    // `receive_shipment` maps the ingress both ways — a fixture that could only
    // answer `success` would leave `statusOnFailure` unexercised.
    await expect(
      courier!.onReceiveShipment({ orderId: 'o-1', shipmentId: 's-1', externalReference: 'REF-1' }),
    ).resolves.toEqual({ result: 'success', externalReference: 'REF-1' });
    await expect(
      courier!.onReceiveShipment({
        orderId: 'o-1',
        shipmentId: 's-1',
        providerDetails: { outcome: 'failure', reason: 'fixture_refused' },
      }),
    ).resolves.toMatchObject({ result: 'failure', failureReason: 'fixture_refused' });
  });

  it('answers the three eligibility surfaces from the method it is handed', async () => {
    const [courier] = carrierFixtureAdapters();
    const active = eligibilityContext();
    const inactive = eligibilityContext({
      deliveryMethod: {
        ...active.deliveryMethod,
        status: 'inactive',
      } as unknown as DeliveryMethodAdmin,
    });

    for (const surface of ['storefront', 'admin', 'api'] as const) {
      const context = { ...active, surface };
      const validate = {
        storefront: courier!.validateUseOnStorefront,
        admin: courier!.validateUseOnAdmin,
        api: courier!.validateUseInApi,
      }[surface].bind(courier!);
      await expect(validate(context), surface).resolves.toBe(true);
    }

    await expect(courier!.validateUseOnStorefront(inactive)).resolves.toBe(false);
  });

  it('opts into auto-creation on paid for the courier only', async () => {
    // `!` on the member, not only on the element: `shouldAutoCreateOnPaid` is
    // **optional** on the published contract, which is exactly why this fixture
    // implements it — after wave 1 nothing else in this repository does. The
    // non-null assertion is the shape of the claim.
    const [courier, pickup] = carrierFixtureAdapters();
    await expect(courier!.shouldAutoCreateOnPaid!()).resolves.toBe(true);
    await expect(pickup!.shouldAutoCreateOnPaid!()).resolves.toBe(false);
  });
});

describe('carrier_fixture — the contribution seam', () => {
  it('registers every adapter under its own module id, from a boot hook', () => {
    const registry = new RecordingAdapterRegistry();
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    // Nothing is pushed during composition — the hook is what pushes. This is
    // the half that matters for a *runtime* activation flip: a push at
    // composition would be a push the operator's switch cannot reach.
    expect(registry.pushes).toEqual([]);

    runBootHooks();

    // **The contributor name is the assertion.** It is the only datum
    // `delivery_methods` filters its enumeration on, so a push naming anything
    // else — `delivery_methods`, an adapter key, a blank — would make this
    // fixture unfilterable while looking registered.
    expect(registry.pushes).toEqual([
      { adapterKey: CARRIER_FIXTURE_ADAPTER_KEYS.COURIER, module: CARRIER_FIXTURE_MODULE_ID },
      { adapterKey: CARRIER_FIXTURE_ADAPTER_KEYS.PICKUP, module: CARRIER_FIXTURE_MODULE_ID },
    ]);
  });

  it('does not probe its own presence in the contributing hook', () => {
    // D-67/D-68, and the off-state case that is genuinely this module's
    // (Principle XVII item 5): a hook that contributes an inert descriptor must
    // **not** probe, or an operator's activation flip would need a restart.
    //
    // Driving it is what makes the assertion real rather than a reading of the
    // source: the context here answers no presence question at all, so an
    // implementation that probed would throw or read `undefined` instead of
    // pushing. The push landing proves the absence of the probe.
    const registry = new RecordingAdapterRegistry();
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    runBootHooks();

    expect(registry.pushes.map((push) => push.adapterKey)).toEqual([
      ...Object.values(CARRIER_FIXTURE_ADAPTER_KEYS),
    ]);
  });

  it('pushes each adapter key once per hook run, and collides with nothing', () => {
    // Two runs is what a re-composition looks like. The owner's policy is
    // last-writer-wins with a warning **when the contributor differs**, so the
    // property this module owes is that its own second push carries the same
    // contributor as its first — a re-registration under a drifting name is
    // what would make the owner warn and what would strand the entry.
    const registry = new RecordingAdapterRegistry();
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    runBootHooks();
    runBootHooks();

    expect(registry.listAll()).toEqual([...Object.values(CARRIER_FIXTURE_ADAPTER_KEYS)]);
    expect(new Set(registry.pushes.map((push) => push.module))).toEqual(
      new Set([CARRIER_FIXTURE_MODULE_ID]),
    );
  });
});

describe('carrier_fixture — the type gate FR-063 buys', () => {
  it('is assignable to the published port type', () => {
    // The assertion `tsc` makes; kept as a runtime line so the file names it.
    const adapters: readonly ShippingAdapter[] = carrierFixtureAdapters();
    expect(adapters.every((adapter) => typeof adapter.adapterKey === 'string')).toBe(true);
  });
});
