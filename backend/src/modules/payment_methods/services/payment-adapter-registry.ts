import type { PaymentAdapter } from '@b2b/contracts';

/**
 * PaymentAdapterRegistry (feature 034) — in-memory map of adapter key →
 * implementation. A module is recognised as a payment-method adapter iff it
 * registers a `PaymentAdapter` here (FR-001). The existing bank_transfer /
 * pickup / gateway drivers are the first entries; external modules register
 * their own adapter from their lifecycle install hook.
 *
 * Collision policy mirrors the CMS PageBuilderRegistry: last-writer-wins with
 * a warning, so a re-registration during a hot reload or re-enable does not
 * throw.
 */
export interface RegistryLogger {
  warn(message: string): void;
}

const consoleLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
};

export class PaymentAdapterRegistry {
  private readonly adapters = new Map<string, PaymentAdapter>();

  constructor(private readonly log: RegistryLogger = consoleLogger) {}

  register(adapter: PaymentAdapter): void {
    if (this.adapters.has(adapter.adapterKey)) {
      this.log.warn(
        `PaymentAdapterRegistry: adapter "${adapter.adapterKey}" re-registered; overwriting previous registration.`,
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
  get(adapterKey: string): PaymentAdapter | undefined {
    return this.adapters.get(adapterKey);
  }

  /** Returns the adapter or throws when not registered. */
  resolve(adapterKey: string): PaymentAdapter {
    const adapter = this.adapters.get(adapterKey);
    if (!adapter) {
      throw new Error(`PaymentAdapterRegistry: no adapter registered for key "${adapterKey}".`);
    }
    return adapter;
  }

  /** Registered adapter keys (stable order of insertion). */
  list(): string[] {
    return [...this.adapters.keys()];
  }
}
