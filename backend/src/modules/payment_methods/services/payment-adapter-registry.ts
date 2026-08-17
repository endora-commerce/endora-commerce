import type { PaymentAdapter, PaymentAdapterRegistryPort } from '@b2b/contracts';
import { ModuleDisabledError } from '../../../kernel/lifecycle/plugin-helpers.js';

/**
 * PaymentAdapterRegistry (feature 034) — in-memory map of adapter key →
 * implementation. A module is recognised as a payment-method adapter iff it
 * registers a `PaymentAdapter` here (FR-001). `payments` contributes the four
 * built-in adapters from its boot hook; each gateway module contributes its own.
 *
 * **Every entry names the module that contributed it (issue #96).** This is a
 * contribution registry in D-39's sense: the push is ungated — a boot hook runs
 * whatever the module's effective state is, and gating the push would make a
 * deactivation survive as a permanently missing entry — so the presence
 * question is answered *here*, at enumeration, keyed on the owner recorded with
 * the entry.
 *
 * The policy this registry states, per D-39's requirement that each host state
 * one: an adapter whose owner is not effectively present is **skipped**. A
 * payment method is a surface-like contribution — the product ruling of
 * 2026-08-15 is that a buyer never sees a method that cannot take their money —
 * so `get`, `resolve` and `list` answer as if the adapter were not registered.
 * `entry`, `ownerOf`, `isRegistered` and `listAll` deliberately do not filter:
 * they are what the admin surface reads to keep showing the method *and* the
 * reason it is unavailable, and switching a module off is not uninstalling it.
 *
 * Collision policy mirrors the CMS PageBuilderRegistry: last-writer-wins with
 * a warning, so a re-registration during a hot reload or re-enable does not
 * throw. Re-registration by the *same* owner is a re-composition rather than a
 * collision (the test suite performs several hundred against this one process
 * singleton) and is silent.
 */
export interface RegistryLogger {
  warn(message: string): void;
}

const consoleLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
};

/** One contributed adapter, with the module that contributed it. */
export interface PaymentAdapterEntry {
  readonly adapter: PaymentAdapter;
  readonly module: string;
}

/**
 * `implements` the shape feature 075's Phase P published, which is what stops
 * the registry and its contract drifting: the four gateway modules will read
 * the published type, and `tsc` refuses the day a method here stops matching.
 */
export class PaymentAdapterRegistry implements PaymentAdapterRegistryPort {
  private readonly entries = new Map<string, PaymentAdapterEntry>();

  /**
   * @param log            collision warnings.
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present so a registry built for a unit test or a bare harness
   *   behaves exactly as it did before this filter existed; the process
   *   singleton wires it to the kernel's effective state.
   */
  constructor(
    private readonly log: RegistryLogger = consoleLogger,
    private readonly isModulePresent: (moduleId: string) => boolean = () => true,
  ) {}

  register(adapter: PaymentAdapter, moduleId: string): void {
    const existing = this.entries.get(adapter.adapterKey);
    if (existing && existing.module !== moduleId) {
      this.log.warn(
        `PaymentAdapterRegistry: adapter "${adapter.adapterKey}" re-registered by ` +
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
  entry(adapterKey: string): PaymentAdapterEntry | undefined {
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
  get(adapterKey: string): PaymentAdapter | undefined {
    const entry = this.entries.get(adapterKey);
    if (!entry || !this.isModulePresent(entry.module)) return undefined;
    return entry.adapter;
  }

  /**
   * The adapter, or a throw. An unregistered key is a programming error; a
   * registered one whose owner is absent is the ordinary 503 envelope, so a
   * caller reached through a service boundary learns the capability is off
   * rather than that the platform is broken.
   */
  resolve(adapterKey: string): PaymentAdapter {
    const entry = this.entries.get(adapterKey);
    if (!entry) {
      throw new Error(`PaymentAdapterRegistry: no adapter registered for key "${adapterKey}".`);
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
