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

  register(code: string, defaults: EmailDefaults): void {
    this.byCode.set(code, defaults);
  }

  get(code: string): EmailDefaults | undefined {
    return this.byCode.get(code);
  }

  has(code: string): boolean {
    return this.byCode.has(code);
  }
}

/** Singleton — owning modules register at composition time before reconcile. */
export const emailDefaultsRegistry = new EmailDefaultsRegistry();
