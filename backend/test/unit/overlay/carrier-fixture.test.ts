import { describe, expect, it, vi } from 'vitest';
import type {
  ShippingAdapter,
  ShippingEligibilityContext,
  DeliveryMethodAdmin,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { ShippingAdapterRegistry } from '../../../../packages/modules/delivery_methods/src/backend/services/shipping-adapter-registry.js';
import {
  CARRIER_FIXTURE_SETTING_CODES,
  manifest,
} from '../../../src/apps/example/modules/carrier_fixture/manifest.js';
import {
  CARRIER_FIXTURE_ADAPTER_KEYS,
  CARRIER_FIXTURE_MODULE_ID,
  carrierFixtureAdapters,
  registerModule,
} from '../../../src/apps/example/modules/carrier_fixture/backend.js';

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
 * ## The off state
 *
 * The module contributes no route, no permission, no admin surface and no
 * storefront element, so item 6 of `specs/conventions/module-activation.md`
 * reduces here to the one seam it does own: the registry must stop answering
 * with this adapter the moment the module is not effectively present, while
 * still being able to say **which** module went (`absentOwnerFor`), and must
 * restore it unchanged when it comes back — with no re-registration, because a
 * contribution hook runs once at composition and an operator's flip must not
 * need a restart (D-67/D-68).
 */

const registryFor = (present: ReadonlySet<string>): ShippingAdapterRegistry =>
  new ShippingAdapterRegistry({ warn: () => {} }, (moduleId) => present.has(moduleId));

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
    const registry = registryFor(new Set([CARRIER_FIXTURE_MODULE_ID, 'delivery_methods']));
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    // Nothing is pushed during composition — the hook is what pushes.
    expect(registry.listAll()).toEqual([]);

    runBootHooks();

    for (const key of Object.values(CARRIER_FIXTURE_ADAPTER_KEYS)) {
      expect(registry.isRegistered(key), key).toBe(true);
      expect(registry.ownerOf(key), key).toBe(CARRIER_FIXTURE_MODULE_ID);
    }
  });

  it('does not probe its own presence in the contributing hook', () => {
    // D-67/D-68: a hook that contributes an inert descriptor must not probe, or
    // an operator's activation flip would need a restart. The probe a wrong
    // implementation would use is the registry's `isModulePresent`, so drive it
    // with the module **absent** and assert the push landed anyway.
    const registry = registryFor(new Set(['delivery_methods']));
    const { ctx, runBootHooks } = contextStub(registry);

    registerModule(ctx);
    runBootHooks();

    expect(registry.listAll()).toEqual([...Object.values(CARRIER_FIXTURE_ADAPTER_KEYS)]);
  });

  it('registers nothing twice when the hook runs twice', () => {
    const warn = vi.fn();
    const counted = new ShippingAdapterRegistry({ warn }, () => true);
    const { ctx, runBootHooks } = contextStub(counted);

    registerModule(ctx);
    runBootHooks();
    runBootHooks();

    expect(counted.listAll()).toEqual([...Object.values(CARRIER_FIXTURE_ADAPTER_KEYS)]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('carrier_fixture — the off state (Principle XVII item 5)', () => {
  const contributed = (present: readonly string[]): ShippingAdapterRegistry => {
    const registry = registryFor(new Set(present));
    const { ctx, runBootHooks } = contextStub(registry);
    registerModule(ctx);
    runBootHooks();
    return registry;
  };

  const courierKey = CARRIER_FIXTURE_ADAPTER_KEYS.COURIER;

  it('is available while the module is effectively present', () => {
    const registry = contributed([CARRIER_FIXTURE_MODULE_ID, 'delivery_methods']);
    // The positive control first: an absence proves nothing until a presence
    // has been seen.
    expect(registry.isAvailable(courierKey)).toBe(true);
    expect(registry.get(courierKey)).toBeDefined();
    expect(registry.list()).toContain(courierKey);
    expect(registry.absentOwnerFor(courierKey)).toBeNull();
  });

  it('withdraws the adapter while the module is off, and names who went', () => {
    const registry = contributed(['delivery_methods']);
    expect(registry.isAvailable(courierKey)).toBe(false);
    expect(registry.get(courierKey)).toBeUndefined();
    expect(registry.list()).not.toContain(courierKey);
    // Still contributed — the admin has to keep showing the method *and* the
    // reason it is unavailable.
    expect(registry.isRegistered(courierKey)).toBe(true);
    expect(registry.absentOwnerFor(courierKey)).toBe(CARRIER_FIXTURE_MODULE_ID);
    expect(() => registry.resolve(courierKey)).toThrow(ModuleDisabledError);
  });

  it('restores the adapter when the module comes back, with no second push', () => {
    const present = new Set(['delivery_methods']);
    const registry = new ShippingAdapterRegistry({ warn: () => {} }, (id) => present.has(id));
    const { ctx, runBootHooks } = contextStub(registry);
    registerModule(ctx);
    runBootHooks();

    expect(registry.isAvailable(courierKey)).toBe(false);
    present.add(CARRIER_FIXTURE_MODULE_ID);
    // No re-composition, no re-registration: the same table answers differently
    // because the read is per-operation.
    expect(registry.isAvailable(courierKey)).toBe(true);
    expect(registry.absentOwnerFor(courierKey)).toBeNull();
  });
});

describe('carrier_fixture — the type gate FR-063 buys', () => {
  it('is assignable to the published port type', () => {
    // The assertion `tsc` makes; kept as a runtime line so the file names it.
    const adapters: readonly ShippingAdapter[] = carrierFixtureAdapters();
    expect(adapters.every((adapter) => typeof adapter.adapterKey === 'string')).toBe(true);
  });
});
