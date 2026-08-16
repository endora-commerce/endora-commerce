import type { ShippingAdapter } from '@b2b/contracts';
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

export class ShippingAdapterRegistry {
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
