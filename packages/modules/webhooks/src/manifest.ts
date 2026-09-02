import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Webhooks module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'webhooks',
  name: 'Webhooks',
  description:
    'Outbound webhook subscription registry and dispatcher.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T098).
  // `webhooks.organization_id` scopes a subscription to a tenant — a real
  // foreign key, surfaced by feature 072 exporting this module's entities.
  dependencies: ['auth', 'organizations'],
  settings: {
    moduleCode: 'webhooks',
    groups: [{ code: 'webhooks', name: 'Webhooks' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'webhooks.enabled',
        name: 'Webhooks enabled',
        description:
          'Switches outbound webhook delivery and its admin screens on or off. While off no event is bridged and no delivery is attempted; events emitted during that time are not delivered retroactively. Nothing is deleted — subscriptions and delivery history are preserved and resume when you switch it back on.',
        groupCode: 'webhooks',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Issue #213 — `integrations:manage` is a **shared** gate: it guards this
  // module's admin surface and `api_keys`', and the core `PERMISSION_CATALOGUE`
  // row that carries its label names `api_keys` alone. Declaring it here makes
  // this module a second *owner*, so the presence filter on `/admin-roles` keeps
  // it grantable while either surface is on. Without this line, switching
  // `api_keys` off would take the code off the role editor while every route in
  // `webhooks/routes.ts` went on enforcing it — a gate nobody can be granted.
  permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
  /**
   * The module's command-palette entry — feature 091, Phase 4 (the plan's
   * batch 6), and one of the fifteen Principle XVI entries
   * `specs/deferred-defects.md` records as owed.
   *
   * It arrives with the drain rather than before it, by the mechanism that
   * register predicts: the batch owes an off-state proof over every surface the
   * module contributes, and until this declaration existed the `AppShell.tsx`
   * `PALETTE_ITEMS` row that advertised /webhooks was the admin's own — a
   * hand-written copy no server-side presence check was ever asked about, so it
   * went on offering the screen to an operator who had switched the module off.
   * The Actions group is resolved by `AdminActionsService` against the effective
   * enabled-set, which is what makes the withdrawal real.
   *
   * `requiredPermission` is the code the target route enforces, which
   * `check:action-route-permissions` compares against the registration on
   * `GET /api/v1/admin/webhooks` itself. It is `integrations:manage` and not a
   * `webhooks:`-prefixed code because that is the gate the module actually
   * has: issue #213 records why both owners declare it.
   */
  actions: [
    {
      id: 'open-webhooks',
      labelKey: 'actions.openWebhooks.label',
      descriptionKey: 'actions.openWebhooks.description',
      icon: 'Webhook',
      targetRoute: '/webhooks',
      requiredPermission: 'integrations:manage',
      keywords: ['webhook', 'webhooks', 'webhooki', 'events', 'zdarzenia', 'signing secret', 'integration', 'integracja'],
      weight: 800,
    },
  ],
  activation: { settingCode: 'webhooks.enabled', default: true },
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 5.
   *
   * It exists because a **declaring** module that contributes no bundle file is
   * `check:error-translations` exit 2 for the whole tree rather than a finding
   * (`specs/090-module-owned-error-codes/contracts/error-translation-population.md`
   * §2.1, §2.3; `d129-sweep.md` §3.4). The bundle lives at the **package
   * root**, not under `dist`: `manifest-locations.ts` resolves a packaged
   * module's `manifestPath` to its `package.json`, so `dirname` is the package
   * directory. The file is a **flat** `{"a.b.c": "text"}` map, because a nested
   * object fails `TranslationBundleEntriesSchema` and the boot reconciler logs
   * and skips it — silently.
   */
  i18n: { bundlesDir: 'i18n' },
  /**
   * `WEBHOOK_DELIVERY_NOT_REPLAYABLE` — D-129's remaining sweep, Tier B
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 5).
   *
   * It was declared by `_i18n` until this merge request, not because anybody
   * judged it the platform's but because the deleted prefix chain had no rule
   * for it and its last line was `return 'core'`. **D-121 T1 puts it here**:
   * the noun is a webhook delivery, this module's own `webhook_deliveries` row,
   * and the refusal is an invariant of that row's status — only `failed` and
   * `dead_lettered` can be re-queued. This module is also the only one that
   * raises it, from `services/webhook-service.ts`.
   *
   * **It arrives with a sentence.** It carried a placeholder in `_i18n`'s
   * bundle — `"Webhook Delivery Not Replayable."` /
   * `"Błąd: webhook delivery not replayable."` — which D-186 §2 deletes rather
   * than carries, because in this module's own bundle it would read as this
   * module's answer. §5.4 keeps writing the prose available and is not a
   * re-opening of that ruling, and this is the case for taking it: the reader
   * is an operator looking at the delivery row on the Webhooks screen, so the
   * one thing the raise site's message carries that a fixed sentence cannot —
   * `status=<status>` — is already on the screen beside the button they
   * pressed.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none: the one raise is a bare
   * `HttpError(409, code, message)` with no `details` argument, measured by
   * balanced-paren extraction of the call's own arguments.
   */
  errorCodes: [{ code: 'WEBHOOK_DELIVERY_NOT_REPLAYABLE' }],
});
