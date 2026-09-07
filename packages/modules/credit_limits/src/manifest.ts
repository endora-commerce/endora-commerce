import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Credit Limits module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'credit_limits',
  name: 'Credit Limits',
  description:
    'Per-organization credit limits and credit-check enforcement at checkout.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port, the customer guard and the customer
  // context resolver this module now resolves from the container.
  //
  // D-94.1 adds `orders`, for the foreign key
  // `credit_limit_reservations_order_fk` (`credit_limit_reservations.order_id`
  // -> `orders.id`, `on delete restrict`). AGENTS.md § Migrations item 4: a
  // cross-module foreign key is declared here or the build fails, and an
  // `acknowledgedDependencies` entry does not satisfy it. The edge is mutual —
  // `placeOrder` calls `reserve({ tx })` on this module's service and this
  // module records a row against the order — so the cycle it closes is broken
  // on the *other* side: `orders` re-expresses `creditLimitService` as an
  // acknowledged edge, which drops the install ordering the constraint says is
  // backwards and keeps the bind (D-94.3).
  dependencies: ['organizations', 'auth', 'orders'],
  settings: {
    moduleCode: 'credit_limits',
    groups: [{ code: 'credit_limits', name: 'Credit limits' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'credit_limits.enabled',
        name: 'Credit limits enabled',
        description:
          'Switches deferred-payment credit limits on or off: the admin screens, the customer-facing balance and the reservation orders take against it. Nothing is dropped — configured limits and their history stay in the database and apply again when you switch it back on.',
        groupCode: 'credit_limits',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Feature 091 (Phase 4, batch 8) — the palette row `AppShell.tsx` carried by
  // hand, arriving as the declaration Principle XVI names. It was a
  // `PALETTE_ITEMS` literal, which is a copy of an advertisement the server was
  // never asked about: it went on offering this screen after an operator
  // switched the module off, because nothing filtered it by the effective
  // enabled-set. `credit_limits:manage` is what gates
  // `GET /api/v1/admin/credit-limits`, so the palette never advertises a 403.
  actions: [
    {
      id: 'open-credit-limits',
      labelKey: 'actions.openCreditLimits.label',
      descriptionKey: 'actions.openCreditLimits.description',
      icon: 'CreditCard',
      targetRoute: '/credit-limits',
      requiredPermission: 'credit_limits:manage',
      keywords: ['credit', 'limit', 'limits', 'balance', 'terms', 'limity kredytowe', 'saldo'],
      weight: 400,
    },
  ],
  activation: { settingCode: 'credit_limits.enabled', default: true },
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
  docs: { dir: 'docs' },
  /**
   * The credit-limit refusals — D-129's remaining sweep, Tier B
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 5).
   *
   * All five were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain had
   * no rule for them and its last line was `return 'core'`. **D-121 T1 puts
   * them here**: the noun in every one is the credit limit or a reservation
   * against it, and both are this module's entities (`credit_limits`,
   * `credit_limit_reservations`).
   *
   * Two of the five are places the noun and the raise-site count disagree, and
   * both are the shape D-95.2 ruled for `INVOICE_NOT_READY`. `LIMIT_INSUFFICIENT`
   * is raised only by `orders`, because this module's reserve seam *returns*
   * `{ ok: false, code: 'LIMIT_INSUFFICIENT' }` as a typed result and the caller
   * turns it into a 409 inside the placement transaction — a `readonly code`
   * claim is not a raise, and the limit the code names is this module's row.
   * `CREDIT_LIMIT_NOT_GRANTED` has six raise sites, five of them here and one in
   * `orders` for the same reason.
   *
   * **Four of the five arrive with a sentence, and the fifth does not.** Each
   * carried a placeholder in `_i18n`'s bundle — `"Limit Insufficient."` /
   * `"Błąd: limit insufficient."` — which D-186 §2 deletes rather than carries,
   * because in this module's own bundle it would read as this module's answer.
   * §5.4 keeps writing the prose available and is not a re-opening of that
   * ruling, so the decision was taken per code: the four with a live raise site
   * and a person who meets it are written here, and
   * `ACTIVE_RESERVATIONS_EXIST` — which **nothing in the tree raises** — is
   * deleted and joins `UNTRANSLATED_ERROR_CODES` under this module, because
   * with no raise site there is no refusal to describe.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: every raise is a bare
   * `HttpError(status, code, message)` with no `details` argument, measured by
   * balanced-paren extraction of each call's own arguments.
   */
  errorCodes: [
    { code: 'ACTIVE_RESERVATIONS_EXIST' },
    { code: 'ADJUSTMENT_BELOW_ACTIVE' },
    { code: 'CREDIT_LIMIT_ALREADY_GRANTED' },
    { code: 'CREDIT_LIMIT_NOT_GRANTED' },
    { code: 'LIMIT_INSUFFICIENT' },
  ],
});
