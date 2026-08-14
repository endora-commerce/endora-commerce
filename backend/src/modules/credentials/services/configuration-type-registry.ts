import type { ConfigurationTypeDescriptor } from '@b2b/contracts';
import { ERROR_CODES } from '@b2b/contracts';

/**
 * ConfigurationTypeRegistry (feature 058) — in-memory map of configuration-type
 * code → descriptor. This is the documented extension point by which the
 * platform and other/overlay modules contribute configuration types WITHOUT
 * editing the credentials core (Principle XIV / XV).
 *
 * Shape copied from the payment/shipping adapter-registry pattern
 * (`payment_methods/services/payment-adapter-registry.ts`): `register` / `get` /
 * `resolve` / `list`, last-writer-wins + warn on a duplicate code so a
 * re-registration during a hot reload or re-enable does not throw.
 *
 * The credentials service reads a descriptor only to (a) render fields, (b)
 * derive the write-validator, (c) know which fields are `secret`. It MUST NOT
 * branch on a specific `code` / `providerCode` for business meaning — provider
 * meaning lives with the consumer (Principle XIV).
 */

export interface RegistryLogger {
  warn(message: string): void;
}

const consoleLogger: RegistryLogger = {
  warn: (message) => console.warn(message),
};

/** Thrown by `resolve` when a type code is not registered (maps to 400). */
export class ConfigurationTypeUnknown extends Error {
  override readonly name = 'ConfigurationTypeUnknown';
  readonly code = ERROR_CODES.CREDENTIAL_TYPE_UNKNOWN;
  constructor(typeCode: string) {
    super(`ConfigurationTypeRegistry: no configuration type registered for code "${typeCode}".`);
  }
}

export class ConfigurationTypeRegistry {
  private readonly types = new Map<string, ConfigurationTypeDescriptor>();

  constructor(private readonly log: RegistryLogger = consoleLogger) {}

  register(descriptor: ConfigurationTypeDescriptor): void {
    const existing = this.types.get(descriptor.code);
    // Re-registering the *same* descriptor overwrites nothing, so it warns
    // about nothing. That distinction started to matter in T143a, when the four
    // core registrations moved out of the composition roots and into the boot
    // hooks of the modules that own the types: this registry is process-wide
    // (it is the seam an overlay module's install hook imports), while a test
    // run composes it several hundred times, so each of those hooks re-declares
    // an identical descriptor once per composition. A genuine override — a
    // different descriptor under a code someone already claimed — still warns.
    if (existing === descriptor) return;
    if (existing !== undefined) {
      this.log.warn(
        `ConfigurationTypeRegistry: type "${descriptor.code}" re-registered; overwriting previous registration.`,
      );
    }
    this.types.set(descriptor.code, descriptor);
  }

  unregister(code: string): void {
    this.types.delete(code);
  }

  isRegistered(code: string): boolean {
    return this.types.has(code);
  }

  /** Returns the descriptor or `undefined` when not registered. */
  get(code: string): ConfigurationTypeDescriptor | undefined {
    return this.types.get(code);
  }

  /** Returns the descriptor or throws {@link ConfigurationTypeUnknown}. */
  resolve(code: string): ConfigurationTypeDescriptor {
    const descriptor = this.types.get(code);
    if (!descriptor) {
      throw new ConfigurationTypeUnknown(code);
    }
    return descriptor;
  }

  /** Registered descriptors (stable order of insertion). */
  list(): ConfigurationTypeDescriptor[] {
    return [...this.types.values()];
  }

  /** Admin-safe view powering `GET /api/v1/admin/credentials/types`. */
  describe(): ConfigurationTypeDescriptor[] {
    return this.list();
  }
}
