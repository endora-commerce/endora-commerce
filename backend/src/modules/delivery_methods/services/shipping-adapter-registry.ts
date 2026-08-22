import type { ShippingAdapter, ShippingAdapterRegistryPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../kernel/lifecycle/plugin-helpers.js';

/**
 * ShippingAdapterRegistry (feature 035) — in-memory map of adapter key →
 * implementation. A module is recognised as a shipping-method adapter iff it
 * registers a `ShippingAdapter` here (FR-001). The bundled offline adapters
 * (manual_courier / personal_pickup) are the first entries; a carrier module
 * contributes its own from its boot hook.
 *
 * Owner-stamped and presence-filtered, exactly like the payment twin — see
 * `payment_methods/services/payment-adapter-registry.ts` for the reasoning
 * (issue #96, D-39). The mechanism is identical; the exposure is not, because
 * today the only contributor is `delivery_methods` itself. Keeping the two
 * registries the same shape is what stops a carrier module from landing on the
 * defect the payment side just paid to remove.
 *
 * Collision policy mirrors the PaymentAdapterRegistry: last-writer-wins with a
 * warning, so a re-registration during a hot reload or re-enable does not throw.
 *
 * **The push happens once, during composition; every read happens later, per
 * operation.** That half was written down only for the payment twin, and the
 * omission is what a contributor infers a rule from: nothing here is read while
 * modules are being composed, so an adapter that is not in the table yet — or
 * whose owner is switched off — is not a fault a contributor can observe, let
 * alone react to. The reads are `ShippingMethodEligibilityService.filter` on
 * `GET /api/v1/delivery-methods`, the `isRegistered` guard on the admin upsert
 * `PUT /api/v1/admin/delivery-methods/:code`, `orders` re-validating the chosen
 * method and firing `onOrderCreated` at placement, `ShipmentService.create`
 * firing `onShipmentCreated`, and the order-confirmation e-mail resolving
 * `renderers.email`. Each of those runs inside a request, after every boot hook
 * has run.
 *
 * So a contributor's boot hook **pushes and returns**: it does not check that
 * the table already holds anything, does not verify that `delivery_methods` is
 * present, and never treats an absent adapter as fatal. A throw there is not a
 * delivery method dropping out — `runBootHooks` attributes the failure to the
 * module and re-throws `ModuleCompositionError`, and `index.ts` turns that into
 * `process.exit(1)`, so an operator's switch takes down the next start instead
 * of one adapter. Nor may the push probe presence (D-67/D-68): the enumeration
 * here already answers that question, per read, and a probe at the push would
 * make switching a carrier back on require a restart. A hook that also *does
 * work* is split in two before either rule applies — the working half probes,
 * the contributing half never does.
 *
 * There is likewise no order to get right between contributors. Every push
 * lands in one process-wide table (`registry-singleton.ts`) during composition,
 * and no read of it happens until a request does; an adapter a colleague
 * contributes is visible to the first read either way.
 */
export interface RegistryLogger {
  warn(message: string): void;
}

const consoleLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
};

/** One contributed adapter, with the module that contributed it. */
export interface ShippingAdapterEntry {
  readonly adapter: ShippingAdapter;
  readonly module: string;
}

/**
 * `implements` the shape feature 075's Phase P published, which is what stops
 * the registry and its contract drifting: `orders` and `shipments` read the
 * published type, and `tsc` refuses the day a method here stops matching.
 */
export class ShippingAdapterRegistry implements ShippingAdapterRegistryPort {
  private readonly entries = new Map<string, ShippingAdapterEntry>();

  constructor(
    private readonly log: RegistryLogger = consoleLogger,
    private readonly isModulePresent: (moduleId: string) => boolean = () => true,
  ) {}

  register(adapter: ShippingAdapter, moduleId: string): void {
    const existing = this.entries.get(adapter.adapterKey);
    if (existing && existing.module !== moduleId) {
      this.log.warn(
        `ShippingAdapterRegistry: adapter "${adapter.adapterKey}" re-registered by ` +
          `module "${moduleId}" (was "${existing.module}"); overwriting previous registration.`,
      );
    }
    this.entries.set(adapter.adapterKey, { adapter, module: moduleId });
  }

  unregister(adapterKey: string): void {
    this.entries.delete(adapterKey);
  }

  /** Whether any module has contributed this key — presence-blind. */
  isRegistered(adapterKey: string): boolean {
    return this.entries.has(adapterKey);
  }

  /** The contributed entry, presence-blind. Admin and diagnostics read this. */
  entry(adapterKey: string): ShippingAdapterEntry | undefined {
    return this.entries.get(adapterKey);
  }

  /** The module that contributed `adapterKey`, or `null` when nobody did. */
  ownerOf(adapterKey: string): string | null {
    return this.entries.get(adapterKey)?.module ?? null;
  }

  /**
   * The module that contributed `adapterKey` and is **not** effectively
   * present, or `null` when the adapter is available or was never contributed.
   *
   * The fourth reader, and the only one that answers the question instead of
   * exposing the table. `get()` returns `undefined` for two situations an
   * operator cannot act on identically — a key nobody ever contributed, and a
   * key whose carrier module is switched off — so `shipments` asks this one to
   * tell them apart before it decides what state to open the row in (issue
   * #250). Its payment twin is `GatewayRefundRegistry.absentOwnerFor` (D-71).
   */
  absentOwnerFor(adapterKey: string): string | null {
    const entry = this.entries.get(adapterKey);
    if (!entry || this.isModulePresent(entry.module)) return null;
    return entry.module;
  }

  /** Registered AND its owner effectively present. */
  isAvailable(adapterKey: string): boolean {
    const entry = this.entries.get(adapterKey);
    return entry !== undefined && this.isModulePresent(entry.module);
  }

  /** The adapter, or `undefined` when unregistered or its owner is absent. */
  get(adapterKey: string): ShippingAdapter | undefined {
    const entry = this.entries.get(adapterKey);
    if (!entry || !this.isModulePresent(entry.module)) return undefined;
    return entry.adapter;
  }

  /** The adapter, or a throw — see the payment twin for the two cases. */
  resolve(adapterKey: string): ShippingAdapter {
    const entry = this.entries.get(adapterKey);
    if (!entry) {
      throw new Error(`ShippingAdapterRegistry: no adapter registered for key "${adapterKey}".`);
    }
    if (!this.isModulePresent(entry.module)) {
      throw new ModuleDisabledError(entry.module);
    }
    return entry.adapter;
  }

  /** Adapter keys whose owner is present (stable insertion order). */
  list(): string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => this.isModulePresent(entry.module))
      .map(([key]) => key);
  }

  /** Every registered adapter key, presence-blind. */
  listAll(): string[] {
    return [...this.entries.keys()];
  }
}
