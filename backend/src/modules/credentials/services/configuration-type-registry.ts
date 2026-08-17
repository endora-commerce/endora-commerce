import type {
  ConfigurationTypeDescriptor,
  ConfigurationTypeRegistryPort,
} from '@b2b/contracts';
import { ERROR_CODES } from '@b2b/contracts';
import { ModuleDisabledError } from '../../../kernel/lifecycle/plugin-helpers.js';

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
 *
 * **The absent-contributor policy this registry states (issue #129): skip.**
 * The push is ungated — a contributor declares its type from a boot hook, which
 * runs whatever the module's effective state is, and gating the push would turn
 * a deactivation into a permanently missing type — so the presence question is
 * answered here, at enumeration, keyed on `descriptor.ownerModule`.
 *
 * A configuration type is a *surface*: it is what the credentials screen offers
 * to configure and what a write is validated against, so a capability an
 * operator switched off must not be on offer and must not be creatable
 * (Principle XVII). `get`, `resolve`, `list` and `describe` therefore answer as
 * if an absent contributor's type were not registered.
 *
 * `entry`, `ownerOf`, `isRegistered` and `listAll` deliberately do not filter.
 * Switching a module off is not uninstalling it: the configurations an operator
 * already stored keep their rows, so the paths that *render* one and the paths
 * that redact one into an audit snapshot need the field shape whatever the
 * contributor's state, and the admin surface needs the owner's id to say which
 * module is off. Dropping the descriptor there would report a stored credential
 * as having lost its type — the state `unregister` produces, and a different
 * thing entirely.
 *
 * The probe is deliberately **tri-state**, and that is not a convenience: this
 * registry is the seam an overlay or external module pushes a type through, so
 * `ownerModule` may be a string no manifest declares. `isPresent` collapses
 * "switched off" and "not a module" into one `false` — right for a gating seam,
 * wrong here, where it would delete the extension point. `undefined` means the
 * platform says nothing about that id, and the entry is honoured.
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

/**
 * Whether the platform holds `moduleId` present. `undefined` when the id is not
 * a module the platform knows anything about — see the class doc comment.
 */
export type ModulePresenceProbe = (moduleId: string) => boolean | undefined;

/**
 * `implements` the shape feature 075's Phase P published — the two integration
 * modules read the published type, and `tsc` refuses the day a method here
 * stops matching.
 */
export class ConfigurationTypeRegistry implements ConfigurationTypeRegistryPort {
  private readonly types = new Map<string, ConfigurationTypeDescriptor>();

  /**
   * @param log         duplicate-code warnings.
   * @param presenceOfModule the effective-state probe. Defaults to "the platform
   *   says nothing", so a registry built for a unit test or a bare harness
   *   behaves exactly as it did before this filter existed; the process
   *   singleton wires it to the kernel's effective state.
   */
  constructor(
    private readonly log: RegistryLogger = consoleLogger,
    private readonly presenceOfModule: ModulePresenceProbe = () => undefined,
  ) {}

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

  /** Whether any module has contributed this code — presence-blind. */
  isRegistered(code: string): boolean {
    return this.types.has(code);
  }

  /** The contributed descriptor, presence-blind. Admin rendering and audit read this. */
  entry(code: string): ConfigurationTypeDescriptor | undefined {
    return this.types.get(code);
  }

  /** The module that contributed `code`, or `null` when nobody did. */
  ownerOf(code: string): string | null {
    return this.types.get(code)?.ownerModule ?? null;
  }

  /** Registered AND its contributor effectively present. */
  isAvailable(code: string): boolean {
    const descriptor = this.types.get(code);
    return descriptor !== undefined && !this.contributorAbsent(descriptor);
  }

  /** Every contributed descriptor, presence-blind (stable order of insertion). */
  listAll(): ConfigurationTypeDescriptor[] {
    return [...this.types.values()];
  }

  /** The descriptor, or `undefined` when unregistered or its contributor is absent. */
  get(code: string): ConfigurationTypeDescriptor | undefined {
    const descriptor = this.types.get(code);
    if (!descriptor || this.contributorAbsent(descriptor)) return undefined;
    return descriptor;
  }

  /**
   * The descriptor, or a throw. An unregistered code is a client error and stays
   * {@link ConfigurationTypeUnknown}; a registered one whose contributor is
   * absent is the ordinary 503 envelope, so an operator is told which module is
   * off rather than that a type they can see has become unknown.
   */
  resolve(code: string): ConfigurationTypeDescriptor {
    const descriptor = this.types.get(code);
    if (!descriptor) {
      throw new ConfigurationTypeUnknown(code);
    }
    if (this.contributorAbsent(descriptor)) {
      throw new ModuleDisabledError(descriptor.ownerModule);
    }
    return descriptor;
  }

  /** Descriptors whose contributor is present (stable order of insertion). */
  list(): ConfigurationTypeDescriptor[] {
    return this.listAll().filter((descriptor) => !this.contributorAbsent(descriptor));
  }

  /** Admin-safe view powering `GET /api/v1/admin/credentials/types`. */
  describe(): ConfigurationTypeDescriptor[] {
    return this.list();
  }

  /** Absent only when the platform knows the contributor and holds it off. */
  private contributorAbsent(descriptor: ConfigurationTypeDescriptor): boolean {
    return this.presenceOfModule(descriptor.ownerModule) === false;
  }
}
