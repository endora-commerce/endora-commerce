import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * API Keys module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'api_keys',
  name: 'API Keys',
  description:
    'Programmatic API keys (Bearer tokens) used by integrations and webhooks.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  dependencies: ['customer_accounts', 'organizations', 'sales_channels', 'auth'],
  settings: {
    moduleCode: 'api_keys',
    groups: [{ code: 'api_keys', name: 'API keys' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'api_keys.enabled',
        name: 'API keys enabled',
        description:
          'Switches machine-to-machine API keys on or off: the admin screens that issue them and the gates that authenticate them on the external catalog namespace. Switched off, existing keys stop authenticating but are not revoked — they work again exactly as issued when you switch it back on.',
        groupCode: 'api_keys',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Issue #213 — `integrations:manage` is a **shared** gate: it guards this
  // module's admin surface and `webhooks`', and the core `PERMISSION_CATALOGUE`
  // row that carries its label can name only one module. Both owners declare it,
  // so the presence filter on `/admin-roles` keeps the code grantable while
  // either surface is on. This half is what the core row already says; it is
  // written out anyway, because a shared code owned by one manifest and one
  // hard-coded core row is the arrangement that produced the asymmetry.
  permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
  /**
   * The module's command-palette entry — feature 091, Phase 4 (the plan's
   * batch 6), and one of the fifteen Principle XVI entries
   * `specs/deferred-defects.md` records as owed.
   *
   * It arrives with the drain rather than before it, by the mechanism that
   * register predicts: the batch owes an off-state proof over every surface the
   * module contributes, and until this declaration existed the `AppShell.tsx`
   * `PALETTE_ITEMS` row that advertised /api-keys was the admin's own — a
   * hand-written copy no server-side presence check was ever asked about, so it
   * went on offering the screen to an operator who had switched the module off.
   * The Actions group is resolved by `AdminActionsService` against the effective
   * enabled-set, which is what makes the withdrawal real.
   *
   * `requiredPermission` is the code the target route enforces, which
   * `check:action-route-permissions` compares against the registration on
   * `GET /api/v1/admin/api-keys` itself. It is `integrations:manage` and not a
   * `api_keys:`-prefixed code because that is the gate the module actually
   * has: issue #213 records why both owners declare it.
   */
  actions: [
    {
      id: 'open-api-keys',
      labelKey: 'actions.openApiKeys.label',
      descriptionKey: 'actions.openApiKeys.description',
      icon: 'KeyRound',
      targetRoute: '/api-keys',
      requiredPermission: 'integrations:manage',
      keywords: ['api', 'api keys', 'klucze api', 'bearer', 'token', 'integration', 'integracja'],
      weight: 700,
    },
  ],
  activation: { settingCode: 'api_keys.enabled', default: true },
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 5 — and it
   * installs **no entries**.
   *
   * It exists because a **declaring** module that contributes no bundle file is
   * `check:error-translations` exit 2 for the whole tree rather than a finding
   * (`specs/090-module-owned-error-codes/contracts/error-translation-population.md`
   * §2.1, §2.3; `d129-sweep.md` §3.4), and all three codes below are ledgered
   * rather than written — so `{}` is what the two files hold. That is the
   * default §5.4 describes for this position, and it is the first time the
   * platform has carried it. What a module in that state does at boot is not
   * decidable from a source-tree check, so the merge request that shipped it
   * ran `bash scripts/boot-gate.sh --with-negatives` and read the answer off a
   * real image: **`installed`**, with two `translation_bundles` rows carrying
   * zero entries — `[i18n] reconcile complete — installed=54 skipped=15
   * failed=0` over the 69 modules the platform composes, none left over.
   * `loadModuleBundles` returns a `Map` of both languages here, not an empty
   * one; §5.4's `{"byLanguage":{}}` is what `JSON.stringify` prints for any
   * `Map` and says nothing about its size.
   *
   * The bundle lives at the **package root**, not under `dist`:
   * `manifest-locations.ts` resolves a packaged module's `manifestPath` to its
   * `package.json`, so `dirname` is the package directory. When a sentence is
   * written here it must be a **flat** `{"a.b.c": "text"}` map, because a nested
   * object fails `TranslationBundleEntriesSchema` and the boot reconciler logs
   * and skips it — silently.
   */
  i18n: { bundlesDir: 'i18n' },
  /**
   * The `API_KEY_*` codes — D-129's remaining sweep, Tier B
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 5).
   *
   * All three were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain had
   * no rule for them and its last line was `return 'core'`. **D-121 T1 puts
   * them here**: the noun in each is the API key, which is this module's
   * entity, and its scopes and its distributor binding are columns on that row.
   * T1 does not ask who throws, which matters twice over here — `API_KEY_NOT_BOUND`
   * is raised by three modules (this one, `catalog` and `orders`, each gating
   * its own external namespace) and `API_KEY_CHANNEL_MISMATCH` is raised by the
   * **platform**, in the sales-channel resolver middleware.
   *
   * **That last one is D-186 §3, taken deliberately and with a condition.** A
   * platform raise site now depends on a switchable module's bundle surviving,
   * which is a coupling Phase 3 never created. The ruling accepts it so the
   * family lands in one bundle, and the merge request carries the assertion that
   * makes it safe: the raise is unreachable while `api_keys` is absent, because
   * it needs `request.actor.kind === 'api_key'` and the only thing that produces
   * such an actor is `auth`'s request hook calling this module's gated
   * `apiKeyResolver` — which its own presence probe answers `null` for while
   * this module is off. `test/integration/_lifecycle/non-binding-degradation.integration.test.ts`
   * asserts it with a bound key and a mismatching `x-sales-channel` header.
   *
   * **None of the three arrives with a sentence.** `API_KEY_CHANNEL_MISMATCH`
   * and `API_KEY_NOT_BOUND` never had one and stay on
   * `UNTRANSLATED_ERROR_CODES`, under this module instead of under `_i18n`.
   * `API_KEY_OUT_OF_SCOPE` carried a placeholder — `"Api Key Out Of Scope."` /
   * `"Błąd: api key out of scope."` — which D-186 §2 deletes rather than
   * carries, and it is **not** rewritten: it is the first code in the sweep
   * ledgered despite a live raise site. Two reasons, and the second is the one
   * that decides it. Its reader is an integration rather than a person, so a
   * translation is answered to a program. And the raise names the scope the key
   * is missing — `API key lacks the required scope: <scope>.` — which a fixed
   * sentence would replace with a vaguer one, because
   * `localizeErrorEnvelope` substitutes the message wholesale and the raise
   * passes no `details` for a placeholder to be filled from. Writing one here
   * would take information away from the only audience that meets it.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: every raise is a bare
   * `HttpError(403, code, message)` with no `details` argument, measured by
   * balanced-paren extraction of each call's own arguments.
   */
  errorCodes: [
    { code: 'API_KEY_CHANNEL_MISMATCH' },
    { code: 'API_KEY_NOT_BOUND' },
    { code: 'API_KEY_OUT_OF_SCOPE' },
  ],
});
