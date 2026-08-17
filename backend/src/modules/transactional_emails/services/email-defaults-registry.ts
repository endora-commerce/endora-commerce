import type { EmailDefaults, EmailDefaultsRegistryPort } from '@b2b/contracts';
/**
 * EmailDefaultsRegistry — feature 047 (R6).
 *
 * In-process registry where each owning module registers the default subject +
 * content for the transactional emails it declares in its manifest. Kept out of
 * the static manifest because content envelopes are large. The reconciler reads
 * this at boot to seed `transactional_emails.default_*`.
 */

/**
 * `EmailDefaults` moved to `@b2b/contracts` in feature 075's Phase P — seven
 * modules push one from their own boot hook, which makes it a boundary shape
 * rather than an internal. Re-exported here for the length of Phase P, which
 * cuts no consumer.
 */
export type { EmailDefaults };

/**
 * `implements` the shape Phase P published, which is what stops the registry
 * and its contract drifting: seven modules read the published type, and `tsc`
 * refuses the day a method here stops matching.
 */
export class EmailDefaultsRegistry implements EmailDefaultsRegistryPort {
  private readonly byCode = new Map<string, EmailDefaults>();
  private readonly ownerByCode = new Map<string, string>();

  /**
   * `ownerModuleId` is required since D-39: a contribution seam records who
   * contributed, so the honour/skip question above has something to key on and
   * so an entry can be attributed without guessing. It became required rather
   * than optional because an optional owner makes "nobody stated a policy for
   * this entry" indistinguishable from "this entry has no owner".
   */
  register(code: string, defaults: EmailDefaults, ownerModuleId: string): void {
    this.byCode.set(code, defaults);
    this.ownerByCode.set(code, ownerModuleId);
  }

  ownerOf(code: string): string | undefined {
    return this.ownerByCode.get(code);
  }

  /** Every registered code with its contributing module — the owner ledger. */
  owners(): ReadonlyMap<string, string> {
    return new Map(this.ownerByCode);
  }

  /**
   * The owning module's sentence for why this email may not be switched off,
   * or `null` when it may (issue #89).
   *
   * An **unregistered** code answers `null`, and that is not a fail-open: a
   * definition row exists only because a module declared the code in its
   * manifest, and a module that declares a protected email declares its
   * defaults in the same boot hook. A code with no entry here is one nobody
   * seeded content for — already the degenerate case, and switching it off
   * changes nothing that was going to be delivered.
   */
  nonDeactivatableReasonOf(code: string): string | null {
    return this.byCode.get(code)?.nonDeactivatable?.reason ?? null;
  }

  get(code: string): EmailDefaults | undefined {
    return this.byCode.get(code);
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }
}

/**
 * Process-wide singleton, kept only for callers that have not moved to the
 * container-scoped instance.
 *
 * **Prefer the `emailDefaultsPort` registration**, which `transactional_emails`
 * provides per composition. This one is shared by every composition in a
 * process — harmless for static content that every composition registers
 * identically, but it means a module absent from one composition can still have
 * its defaults present there, courtesy of another. With ~950 compositions in a
 * test run that is a real, if benign, cross-composition leak.
 */
export const emailDefaultsRegistry = new EmailDefaultsRegistry();
