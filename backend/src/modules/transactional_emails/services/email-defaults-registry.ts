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

/**
 * Enumeration policy: **honoured** while the contributing module is absent
 * (feature 072, D-39).
 *
 * D-39's default is the opposite — an entry belonging to a switched-off module
 * is skipped — and honouring one needs a written reason. This is it.
 *
 * The definition *rows* this registry feeds are created from the **platform**
 * axis: `TransactionalEmailReconciler` walks `resolvedModuleRegistry`, so a row
 * exists because the module is installed, not because an operator activated it.
 * Skipping a deactivated contributor's entry would not remove that row — it
 * would create it with an empty `defaultSubject` and an empty content envelope
 * (`manifest-reconciler.ts:69-81`), so an activation flip would silently rewrite
 * persisted content. Constitution XVII is explicit that off drops no data and no
 * configuration; a policy whose effect is "blank the seeded template" fails that
 * on the one axis it was supposed to protect.
 *
 * The genuine Constitution XVII question here is a different one — whether a
 * switched-off module's email should appear in the admin list at all — and it
 * belongs to the reconciler's *manifest source*, not to this table. Narrowing
 * that source is destructive: the reconciler prunes every row whose code is not
 * currently declared, and the FK cascade takes the admin customizations with it.
 * That is its own change, with its own test, and it is not this one.
 */
export class EmailDefaultsRegistry {
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
