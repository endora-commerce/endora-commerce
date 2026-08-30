import {
  defineModuleManifest,
  defineModuleRecentActivity,
  defineModuleSettingsManifest,
} from '@endora-commerce/contracts';

/**
 * Prompt Actions module — feature 043.
 *
 * Natural-language prompt mode for the admin command palette: the operator
 * types an instruction (PL/EN), the backend interprets it with an LLM via
 * tool use / function calling against a curated, module-contributed tool
 * catalogue, presents a confirmable plan, and executes it through existing
 * module services under the operator's own permissions.
 *
 * Settings (research §R4; provider credentials via feature 058):
 *   - prompt_actions.enabled          — platform-wide kill switch (FR-015).
 *   - prompt_actions.llm_credentials  — reference to a reusable `llm` credential
 *                                       configuration (provider + model + API
 *                                       key). The single credential source.
 *   - prompt_actions.bulk_limit       — max affected records per prompt (FR-010).
 *
 * No palette `actions:` entry: feature 020 actions are navigation-only, and
 * the prompt mode has no standalone route — its entry point is the
 * capability-gated "Ask the assistant" row the admin shell pins inside the
 * palette itself.
 */

export const PROMPT_ACTIONS_SETTING_CODES = {
  /**
   * Feature 074 — the operator-activation control, and a **different switch**
   * from `ENABLED` below. The two answer different questions and neither can
   * stand in for the other:
   *
   *  - `ENABLED` is the assistant's own kill switch, default `false`. Off, the
   *    module is *present*: the capability endpoint answers `200 {status:
   *    'disabled'}` and a submission answers `409 ASSISTANT_DISABLED`, which is
   *    what the palette reads to learn it should not offer prompt mode.
   *  - `ACTIVATION` is the Constitution XVII axis, default `true`. Off, the
   *    module is *absent*: `ctx.routes` 503s the whole surface, including the
   *    probe above.
   *
   * Adopting `ENABLED` as the activation control — which D-44 §6 proposed —
   * would have done two things at once: taken the probe away from the palette,
   * and switched the module off in every existing deployment, because the row
   * resolves `false` by default. FR-012 forbids the second outright.
   */
  ACTIVATION: 'prompt_actions.activation',
  ENABLED: 'prompt_actions.enabled',
  // Feature 058 — the single credential source: a reusable `llm` credential
  // configuration supplying provider + model + API key.
  LLM_CREDENTIALS: 'prompt_actions.llm_credentials',
  BULK_LIMIT: 'prompt_actions.bulk_limit',
} as const;

export const PROMPT_ACTIONS_USE_PERMISSION = 'prompt_actions:use';

const settings = defineModuleSettingsManifest({
  moduleCode: 'prompt_actions',
  groups: [{ code: 'prompt_actions', name: 'Prompt actions (AI assistant)' }],
  settings: [
    {
      // Feature 074 — the operator's activation control. Platform-wide, and
      // never channel-scoped: activation stops at `global_value` →
      // `default_value` by construction.
      code: PROMPT_ACTIONS_SETTING_CODES.ACTIVATION,
      name: 'Prompt actions enabled',
      description:
        'Switches the whole module on or off: the prompt API, the plan preview and execution path, and the tools other modules contribute to it. This is the module switch; the assistant\'s own on/off, which leaves the palette able to say "not available", is the setting below. Nothing is dropped — every recorded plan, its audit trail and the LLM credential reference stay in the database.',
      groupCode: 'prompt_actions',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.ENABLED,
      name: 'Assistant enabled',
      description:
        'Platform-wide switch for the natural-language prompt mode in the admin command palette. When off, the palette behaves exactly as without the module.',
      groupCode: 'prompt_actions',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.LLM_CREDENTIALS,
      name: 'LLM credentials',
      description:
        'Reference a reusable LLM credential configuration (Credentials screen) providing the provider, model and API key. Required to enable the assistant.',
      groupCode: 'prompt_actions',
      valueType: 'credential_ref',
      configurationType: 'llm',
      defaultValue: '',
    },
    {
      code: PROMPT_ACTIONS_SETTING_CODES.BULK_LIMIT,
      name: 'Bulk operation limit',
      description:
        'Maximum number of records a single prompt may affect. Plans whose preview exceeds the limit are blocked before execution.',
      groupCode: 'prompt_actions',
      valueType: 'number',
      defaultValue: 500,
    },
  ],
});

/** Settings-only export consumed by the boot-time ManifestReconciler lists. */
export const promptActionsSettingsManifest = settings;

export const manifest = defineModuleManifest({
  id: 'prompt_actions',
  name: 'Prompt Actions',
  description:
    'Natural-language prompt mode for the admin command palette: interpret an operator instruction with an LLM, preview the plan, execute it through existing module services after explicit confirmation.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port and `admin_roles` owns
  // `permissionService`; both are resolved from the container, so both are
  // real dependencies of this module rather than of its composition root.
  dependencies: ['_i18n', '_lifecycle', 'admin_roles', 'auth', 'credentials', 'settings'],
  settings,
  // Feature 074 (Constitution XVII) — a control this module never had, so the
  // module was governed by the platform axis alone. `backend.ts` explains why
  // it was withheld: adopting `prompt_actions.enabled` would 503 the capability
  // probe the palette needs in order to *learn* the assistant is off. That
  // argument is answered by giving the module its own activation code rather
  // than by leaving it without a control — the two switches now sit side by
  // side and mean different things.
  //
  // Default `true`, superseding D-44 §6's `default: false`. The ground is
  // general and not a judgement about the assistant: merging must not change
  // the state of any existing deployment, and a module with no activation
  // declaration resolves as activated today. A client who does not want it
  // switches it off, like every other operator-controlled module — and the
  // assistant's own kill switch below still defaults to `false`, so nothing
  // starts talking to an LLM because of this.
  activation: { settingCode: PROMPT_ACTIONS_SETTING_CODES.ACTIVATION, default: true },
  i18n: { bundlesDir: 'i18n' },
  /**
   * The `ASSISTANT_*` and `PROMPT_*` codes — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * All six were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain
   * had no rule for them and its last line was `return 'core'`. **D-121 T1
   * puts them here**: the noun in each is either the prompt assistant — the
   * LLM capability this module configures, gates and calls — or a prompt
   * action request, the `PromptActionRequest` row this module owns and whose
   * whole state machine it runs. This module is also the only one that raises
   * them, so T1 and the raise-site count agree.
   *
   * **`ASSISTANT_*` is not `MODULE_DISABLED`, and the distinction is the
   * reason it is a code of its own.** `ASSISTANT_DISABLED` refuses a
   * submission while this module is *present and switched on* and its own
   * `prompt_actions.assistant_enabled` kill switch is off; a switched-off
   * module answers `MODULE_DISABLED`, which is the platform's vocabulary and
   * stays with it (Constitution XVII, `d129-sweep.md` §2.5).
   *
   * **No sentence moves with them.** None of the six has a sentence in either
   * language anywhere in the tree; all six were already on
   * `UNTRANSLATED_ERROR_CODES` under `_i18n` and move to this module's group
   * there, so the bundle this module already ships gains no key. The admin's
   * prompt panel maps four of them to its own copy
   * (`admin/src/components/prompt-actions/PromptModePanel.tsx`), which is a
   * surface string and not the envelope's sentence — that mapping is untouched
   * and unaffected by which bundle the envelope reads.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none to declare: every raise is a bare
   * `HttpError(status, code, message)` or a `readonly code =` on an `Error`
   * subclass in `services/llm/provider-factory.ts` and
   * `services/plan-executor.service.ts`, and no site puts a `details.code` on
   * the wire.
   */
  errorCodes: [
    { code: 'ASSISTANT_DISABLED' },
    { code: 'ASSISTANT_NOT_CONFIGURED' },
    { code: 'PROMPT_PERMISSION_REVOKED' },
    { code: 'PROMPT_PLAN_EXPIRED' },
    { code: 'PROMPT_REQUEST_INVALID_STATE' },
    { code: 'PROMPT_REQUEST_IN_FLIGHT' },
  ],
  permissions: [
    {
      code: PROMPT_ACTIONS_USE_PERMISSION,
      label: 'Use the prompt assistant',
      description:
        'Allows the operator to open the prompt mode in the admin command palette and execute confirmed plans (each planned operation is additionally re-checked against the permission of its underlying action).',
    },
  ],
});

/**
 * What this module offers the admin home dashboard's Recent Activity card —
 * feature 080, T042j / D-163.1.
 *
 * **This entry is the drift D-163 named.** `prompt_action.execute` was in the
 * host's server-side allow-list and in its action-to-module prefix map, and
 * absent from the route's three-member `module` enum and from the admin's
 * `ACTIVITY_RENDERING` — so a prompt-assistant row was fetched, classified
 * `prompt_actions`, and then rendered with the unknown-verb fallback, while the
 * response schema described a `module` value the server could emit and the
 * contract did not list. Four hand-maintained tables in two languages, and they
 * were not kept true. It is repaired here by the derivation rather than by a
 * fifth hand-written entry, which is the difference between fixing an instance
 * and fixing the class.
 */
export const recentActivity = defineModuleRecentActivity({
  entries: [
    {
      action: 'prompt_action.execute',
      icon: 'Sparkles',
      labelKey: 'activity.verb.prompt_action.execute',
    },
  ],
});
