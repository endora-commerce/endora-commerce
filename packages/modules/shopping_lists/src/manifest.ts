import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';

export const shoppingListsSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'shopping_lists',
  groups: [{ code: 'shopping_lists', name: 'Shopping lists' }],
  settings: [
    {
      code: 'shopping_lists.enabled',
      name: 'Shopping lists enabled',
      description:
        'Switches customer shopping lists on or off: creating and sharing lists, saving a cart line to one, and converting a list into a quote request. Nothing is dropped — every list, its items and its sharing state stay in the database.',
      groupCode: 'shopping_lists',
      valueType: 'boolean',
      defaultValue: true,
    },
  ],
});

/**
 * Shopping Lists module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'shopping_lists',
  name: 'Shopping Lists',
  description:
    'Customer-owned saved shopping lists.',
  version: '1.0.0',
  // Feature 072 (T133) — the edges were always there; the conversion is what
  // made them declarations.
  //
  // `carts` joins them in feature 075 Phase C. It was absent on the grounds
  // that "the service handed back through `shoppingListServiceSink` points
  // outward, and declaring the consumer would invert the direction" — true of
  // the sink, and not of the other edge: `convertToCart` resolves `carts`'
  // `cartWritePort` and calls it, which points inward. The check accepted it
  // only through the transitive path `orders` -> `carts`, so the declaration
  // was a property of a neighbour's manifest. No cycle: nothing in the tree
  // depends on `shopping_lists`.
  dependencies: [
    'auth',
    'carts',
    'catalog',
    'orders',
    'organizations',
    'quote_requests',
    'settings',
  ],
  settings: shoppingListsSettingsManifest,
  // Feature 073 (Constitution XVII) — the operator's activation control. It
  // covered the quick-order surfaces too while this module hosted them; T139
  // separated the two, so this now switches shopping lists and nothing else.
  activation: { settingCode: 'shopping_lists.enabled', default: true },
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 3.
   *
   * It ships two keys and nothing else, and it exists because a **declaring**
   * module that contributes no bundle file is `check:error-translations` exit
   * 2 for the whole tree rather than a finding
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
   * The `SHOPPING_LIST_*` codes — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * Both were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain
   * had no rule for them and its last line was `return 'core'`. **D-121 T1
   * puts them here**: the noun in both is a shopping list, which is this
   * module's own entity, and both refusals are invariants of it — the default
   * list is the customer's permanent anchor and cannot be deleted, and an
   * account always keeps at least one list. This module is also the only one
   * that raises them, from `services/shopping-list-service.ts`.
   *
   * **Unlike the rest of Tier A, these two arrive with a sentence.** They had
   * none in either language anywhere in the tree and were on
   * `UNTRANSLATED_ERROR_CODES` under `_i18n`; §5.4's default for a receiver
   * with nothing to put in its new bundle is an empty `{}` plus a ledger entry
   * under the receiver's group, and it says in terms that writing the prose
   * instead is always available and is not a re-opening of D-186 §2 — that
   * ruling refuses *carrying* a placeholder, not *writing* a sentence. Two
   * codes is four strings, both refusals are read by a **buyer** on the
   * storefront rather than by an operator, and each sentence written deletes a
   * ledger entry instead of adding one. So they are written, and this module's
   * bundle is not an empty one.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: both raises are a bare
   * `HttpError(409, code, message)` with no `details`.
   */
  errorCodes: [
    { code: 'SHOPPING_LIST_CANNOT_DELETE_DEFAULT' },
    { code: 'SHOPPING_LIST_CANNOT_DELETE_LAST' },
  ],
});
