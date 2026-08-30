import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Addresses module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'addresses',
  name: 'Addresses',
  description:
    'Reusable address entities used by organizations, customers, and order fulfilment.',
  version: '1.0.0',
  // `addresses.organization_id` foreign-keys `organizations`. The edge was
  // found by the FK-drift validator (feature 065) and is genuinely declarable:
  // quick_order → addresses → organizations → settings stays acyclic.
  //
  // `dictionaries` added with the conversion (feature 072, T090): the one
  // `AddressService` resolves `dictionaryValidator` to check country and region
  // codes, so the edge is real and was previously invisible to the lifecycle.
  dependencies: ['dictionaries', 'organizations'],
  // Feature 074 (Constitution XVII), test C2 — functional base. The flag was
  // previously carried by a port edge: `organizations` resolves this module's
  // `addressService`, and that reached this manifest through the other one's
  // declaration. Ruling 2 withdraws that authority — a module a criterion
  // module happens to resolve is not thereby core — so the ground here is now
  // this module's own. Every B2B document is addressed: an order ships
  // somewhere, an invoice is billed somewhere, a shipment has a destination.
  // A platform that cannot record where is not a smaller commerce platform,
  // it is one that cannot complete a transaction.
  activation: {
    nonDeactivatable: true,
    reason:
      'Every B2B document — order, invoice, shipment — is addressed; there is no transaction ' +
      'without one.',
  },
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 5.
   *
   * It exists because a **declaring** module that contributes no bundle file is
   * `check:error-translations` exit 2 for the whole tree rather than a finding
   * (`specs/090-module-owned-error-codes/contracts/error-translation-population.md`
   * §2.1, §2.3; `d129-sweep.md` §3.4). The bundle lives at the **package
   * root**, not under `dist`: `manifest-locations.ts` resolves a packaged
   * module's `manifestPath` to its `package.json`, so `dirname` is the package
   * directory. The files are a **flat** `{"a.b.c": "text"}` map, because a
   * nested object fails `TranslationBundleEntriesSchema` and the boot
   * reconciler logs and skips it — silently.
   */
  i18n: { bundlesDir: 'i18n' },
  /**
   * The two `ADDRESS_*` codes — D-129's remaining sweep, Tier B
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 5).
   *
   * Both were declared by `_i18n` until this merge request, not because anybody
   * judged them the platform's but because the deleted prefix chain had no rule
   * for them and its last line was `return 'core'`. **D-121 T1 puts them
   * here**: the noun in both is an address, which is this module's entity, and
   * both refusals are about that row — who owns it, and whether anything still
   * points at it.
   *
   * `ADDRESS_NOT_OWNED` is the sweep's cleanest disagreement between the noun
   * and the raise-site count: `orders` is the only module that raises it, and it
   * does so having asked this module's read port for the address and got
   * nothing back. That is the caller reporting the absence of the owner's row —
   * D-95.2's `INVOICE_NOT_READY` shape — and T1 does not ask who throws.
   * `ADDRESS_IN_USE` is raised by nothing at all, which T1 also does not ask
   * about (T10).
   *
   * **One of the two arrives with a sentence.** Each carried a placeholder in
   * `_i18n`'s bundle — `"Address Not Owned."` / `"Błąd: address not owned."` —
   * which D-186 §2 deletes rather than carries, because in this module's own
   * bundle it would read as this module's answer. §5.4 keeps writing the prose
   * available and is not a re-opening of that ruling, so the decision was taken
   * per code: `ADDRESS_NOT_OWNED` is written, because a buyer meets it at
   * checkout and the refusal has one remedy to offer; `ADDRESS_IN_USE` is
   * deleted and joins `UNTRANSLATED_ERROR_CODES` under this module, because
   * with no raise site there is no refusal to describe and a sentence could
   * only be invented from the code's own name.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: the one raise is a bare
   * `HttpError(403, code, message)` with no `details` argument, measured by
   * balanced-paren extraction of the call's own arguments.
   */
  errorCodes: [{ code: 'ADDRESS_IN_USE' }, { code: 'ADDRESS_NOT_OWNED' }],
});
