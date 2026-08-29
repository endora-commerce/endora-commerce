import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Currencies module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'currencies',
  name: 'Currencies',
  description:
    'Currency reference data and per-channel currency configuration.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes added on 2026-08-29
  // are gated by. It is the only entry, and the list stays otherwise empty for
  // its original reason: `currencies` announces a change on the EventBus and
  // `dictionaries` reacts by dropping its caches — a **notification**, not a
  // query, which `contracts/module-context.md` says needs no dependency edge.
  // Declaring one produced a real cycle (dictionaries → currencies →
  // dictionaries) and the cycle was the design telling us the direction was
  // wrong: a currency has no business knowing a dictionary cache exists.
  dependencies: ['auth'],
  /**
   * The module's own authority (2026-08-29).
   *
   * `/api/v1/admin/currencies`, `/:code`, `/:code/default` and the delete were
   * registered by `languages` and enforced `catalog:write` — all four, the list
   * read included. So whoever could edit a product description could add a
   * currency, deactivate one, delete one and **promote one to the shop's
   * default**, which is the denomination every price, cart, order and invoice
   * is stated in.
   *
   * Nothing could see it. `catalog:write` is real, declared and enforced, so
   * the permission inventory's two directions were clean; D-173's `foreign-gate`
   * sweep passes the site deliberately, because `catalog` is `nonDeactivatable`
   * and the availability coupling that sweep asks about can never bite; and
   * `check:action-route-permissions` never looked at all, neither this module
   * nor `languages` declaring a manifest action. None of them asks whether
   * `catalog:write` is the right authority for changing what a shop charges in,
   * which is a judgement rather than a derivation, so the answer is pinned in a
   * contract test rather than in a new check.
   *
   * A pair and no third code, spelled `<module id>:<read|write>` like
   * `payment_methods`, `delivery_methods`, `taxes`, `returns` and `invoices`. A
   * prefix that is not its owner's id is the mistake `PERMISSION_CATALOGUE`
   * comments on twice (`integrations:manage`, `audit_log:read`), both frozen
   * because they are persisted in role rows; getting it right on a code that
   * does not exist yet is free.
   *
   * The read half is a capability that did not exist rather than a rename of
   * one: every one of the four routes carried the write code, so listing the
   * currencies required the authority to delete one.
   *
   * The **other** door to this table is `dictionaries`'
   * `/api/v1/admin/dictionary/currencies/*`, gated on `dictionary.write`. It is
   * out of this repair's scope and is reported rather than changed: that is the
   * screen an operator actually uses, it is a code `dictionaries` owns rather
   * than a borrowed one, and re-gating it is the same question asked of the
   * whole reference-data registry (countries and languages alike) rather than
   * of currencies.
   *
   * No data migration: see `test/contract/currencies/permission-authority.test.ts`.
   */
  permissions: [
    { code: 'currencies:read', label: 'View currencies' },
    { code: 'currencies:write', label: 'Configure currencies' },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. The
  // declaration used to carry the manifest graph as its second half ("and
  // `dictionaries` declares this module, two edges from the tenancy root");
  // ruling 2 withdraws that, and the business half was always the real one and
  // stands alone. Denomination is not a business decision anyone takes: there
  // is no price, cart, order or invoice without a currency, and no client for
  // whom "no currencies" is a smaller platform rather than a broken one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Every amount is denominated; there is no price, cart, order or invoice without a ' +
      'currency.',
  },
});
