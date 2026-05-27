import type { ShippingAdapter } from '@b2b/contracts';

/**
 * ShippingAdapterRegistry (feature 035) — in-memory map of adapter key →
 * implementation. A module is recognised as a shipping-method adapter iff it
 * registers a `ShippingAdapter` here (FR-001). The bundled offline adapters
 * (manual_courier / personal_pickup) are the first entries; external modules
 * register their own adapter from their lifecycle install hook.
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

export class ShippingAdapterRegistry {
  private readonly adapters = new Map<string, ShippingAdapter>();

  constructor(private readonly log: RegistryLogger = consoleLogger) {}

  register(adapter: ShippingAdapter): void {
    if (this.adapters.has(adapter.adapterKey)) {
      this.log.warn(
        `ShippingAdapterRegistry: adapter "${adapter.adapterKey}" re-registered; overwriting previous registration.`,
      );
    }
    this.adapters.set(adapter.adapterKey, adapter);
  }

  unregister(adapterKey: string): void {
    this.adapters.delete(adapterKey);
  }

  isRegistered(adapterKey: string): boolean {
    return this.adapters.has(adapterKey);
  }

  /** Returns the adapter or `undefined` when not registered. */
  get(adapterKey: string): ShippingAdapter | undefined {
    return this.adapters.get(adapterKey);
  }

  /** Returns the adapter or throws when not registered. */
  resolve(adapterKey: string): ShippingAdapter {
    const adapter = this.adapters.get(adapterKey);
    if (!adapter) {
      throw new Error(`ShippingAdapterRegistry: no adapter registered for key "${adapterKey}".`);
    }
    return adapter;
  }

  /** Registered adapter keys (stable order of insertion). */
  list(): string[] {
    return [...this.adapters.keys()];
  }
}
