import type {
  InvoicePdfBlockRegistration,
  InvoicePdfBlockRegistryPort,
} from '@endora-commerce/contracts';

/** Two different contributions for one block name. */
export class InvoicePdfBlockConflictError extends Error {
  constructor(name: string, existingModuleId: string, moduleId: string) {
    super(
      `invoicePdfBlockRegistry: block "${name}" is already contributed by module ` +
        `"${existingModuleId}"; module "${moduleId}" cannot register a second one.`,
    );
    this.name = 'InvoicePdfBlockConflictError';
  }
}

/** A registration this registry refuses on its shape, before it is stored. */
export class InvoicePdfBlockRegistrationError extends Error {
  constructor(message: string) {
    super(`invoicePdfBlockRegistry: ${message}`);
    this.name = 'InvoicePdfBlockRegistrationError';
  }
}

/**
 * Invoice template blocks another module renders onto the PDF
 * (`specs/134-paid-module-extraction/` T063 and T126; `research.md` D11, D12
 * and D16 §2(e)).
 *
 * **Why the seam exists.** `ksef.InvoiceSection` is declared by `ksef`, and
 * until T063 this module seeded, rendered and described it, while the data its
 * QR code needs reached the renderer only where a composition root called
 * `setKsefVerificationResolver`. Both halves read as working for as long as
 * both modules were in the tree, and the second did not work at all on an
 * instance composed through the platform alone. The declaring module now
 * renders, describes and enriches its own block, and registers all three here
 * from its composition root; this module names no contributor.
 *
 * **A contribution registry in D-39's sense**, and a plain `di.register`: a
 * contributor pushes from a boot hook whatever this module's effective state
 * is, so a gate here would stop the backend from starting for an operator who
 * switched invoicing off.
 *
 * **The policy it states: skip an absent contributor's block.** While the
 * declaring module is not present its block is not described to the builder,
 * not resolved and not rendered — the same answer a stored block of an
 * uninstalled module gets (`specs/096-page-builder-block-ownership/` FR-019,
 * FR-020): the PDF simply has no such section, and the stored props are
 * untouched. Presence is read on every call, so switching the contributor back
 * on takes effect on the next render with no restart.
 *
 * Three more rules, each stated because the alternative is plausible:
 *
 *  1. **The owner segment is the contributor.** A block name is
 *     `<moduleId>.<LocalName>` and is persisted in every template that places
 *     it, so a module may contribute only under its own id — the rule
 *     `check:block-names` holds manifests to.
 *  2. **`invoices`' own blocks are not contributable.** This module renders its
 *     ten itself; a contribution under `invoices.` could only shadow one.
 *  3. **A second contributor for one name is refused**, not ordered, so which
 *     module renders a block never depends on which composed last. The
 *     identical registration twice is accepted.
 */
export class InvoicePdfBlockRegistry implements InvoicePdfBlockRegistryPort {
  private readonly registrations = new Map<string, InvoicePdfBlockRegistration>();

  /**
   * @param isModulePresent the effective-state probe. Defaults to
   *   always-present, so a registry a unit test builds answers about what that
   *   test registered; the module's composition wires it to the kernel's
   *   effective state.
   */
  constructor(private readonly isModulePresent: (moduleId: string) => boolean = () => true) {}

  register(registration: InvoicePdfBlockRegistration): void {
    const { name, moduleId } = registration;
    if (moduleId === 'invoices' || name.startsWith('invoices.')) {
      throw new InvoicePdfBlockRegistrationError(
        `"${name}" is under \`invoices\`' own namespace — this module renders its own blocks itself.`,
      );
    }
    if (!name.startsWith(`${moduleId}.`) || name.length <= moduleId.length + 1) {
      throw new InvoicePdfBlockRegistrationError(
        `"${name}" does not carry "${moduleId}" as its owner segment — a module contributes ` +
          'only the blocks its own manifest declares.',
      );
    }
    const existing = this.registrations.get(name);
    if (existing) {
      if (existing === registration) return;
      throw new InvoicePdfBlockConflictError(name, existing.moduleId, moduleId);
    }
    this.registrations.set(name, registration);
  }

  /** The contributed block of that name, or `undefined` while its contributor is absent. */
  find(name: string): InvoicePdfBlockRegistration | undefined {
    const registration = this.registrations.get(name);
    return registration && this.isModulePresent(registration.moduleId) ? registration : undefined;
  }

  /** Every contributed block whose contributor is present, in registration order. */
  present(): InvoicePdfBlockRegistration[] {
    return [...this.registrations.values()].filter((registration) =>
      this.isModulePresent(registration.moduleId),
    );
  }
}
