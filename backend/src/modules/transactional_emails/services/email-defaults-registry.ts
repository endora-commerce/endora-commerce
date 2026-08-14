/**
 * EmailDefaultsRegistry — feature 047 (R6).
 *
 * In-process registry where each owning module registers the default subject +
 * content for the transactional emails it declares in its manifest. Kept out of
 * the static manifest because content envelopes are large. The reconciler reads
 * this at boot to seed `transactional_emails.default_*`.
 */

export interface EmailDefaults {
  /** Per-language subject: { lang: string }. */
  defaultSubject: Record<string, string>;
  /** Content envelope: { schema_version, languages: { lang: tree } }. */
  defaultContent: Record<string, unknown>;
}

export class EmailDefaultsRegistry {
  private readonly byCode = new Map<string, EmailDefaults>();
  private readonly ownerByCode = new Map<string, string>();

  /**
   * `ownerModuleId` is recorded from T143a, when the fourteen registrations
   * moved out of the composition root and into the modules that declare the
   * codes in their own manifests. It is not read yet: the reconciler decides
   * what to seed from the resolved manifest list, and narrowing that to
   * *effective* presence would change which definitions exist in a database
   * when an operator switches a module off — a behavioural decision that
   * belongs in its own change, not smuggled into a relocation. The ownership
   * is captured here so that decision has something to key on.
   */
  register(code: string, defaults: EmailDefaults, ownerModuleId?: string): void {
    this.byCode.set(code, defaults);
    if (ownerModuleId !== undefined) this.ownerByCode.set(code, ownerModuleId);
  }

  ownerOf(code: string): string | undefined {
    return this.ownerByCode.get(code);
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
