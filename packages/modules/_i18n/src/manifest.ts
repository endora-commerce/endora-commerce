import type { EntityManager } from '@mikro-orm/postgresql';
import {
  defineModuleManifest,
  type ModuleCliCommand,
  type ModuleLifecycleParticipant,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * Admin UI i18n subsystem — feature 019.
 *
 * Platform-internal module (underscore-prefixed exemption per Constitution
 * Principle VI, alongside `auth` / `example` / `_lifecycle`). Owns the
 * `translation_bundles` table, the per-language merged-bundle resolver,
 * the read API consumed by the admin SPA at boot, and the `core`
 * namespace that holds admin-chrome strings (AppShell, navigation,
 * login, profile).
 *
 * Depends on `_lifecycle` because every module's bundle install / hard-
 * uninstall is driven by the lifecycle orchestrator's hook surface.
 */
export const manifest = defineModuleManifest({
  id: '_i18n',
  name: 'Admin UI i18n',
  // One string literal, not a concatenation: `manifests:generate` reads this
  // field to render the package's `description`, and it reads a literal — a
  // package whose description is computed is one the generator refuses rather
  // than invents a sentence for (feature 080, T041).
  description:
    'Per-user Admin UI language preference and module-scoped translation bundles. English is the platform-wide fallback (FR-013 / FR-016).',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port every route here is gated by;
  // `admin_users` owns the service the preferred-language setter writes through.
  // Neither depends back on this module, so the graph stays acyclic.
  dependencies: ['_lifecycle', 'auth', 'admin_users'],
  i18n: { bundlesDir: 'i18n' },
  // Feature 074 (Constitution XVII), test C1 — reachability. Two grounds hold
  // and they are stated in that order because only the first is about this
  // module's merits: every user-facing string on every surface resolves here,
  // including the labels on `/platform/modules`, so switching it off would
  // leave an operator unable to read the screen that switches it back on. The
  // `_`-prefix rule is the structural second: an `_`-prefixed id is
  // platform-internal and `assertActivationRules`
  // (`packages/contracts/src/modules.ts`) refuses any other activation form
  // for one.
  activation: {
    nonDeactivatable: true,
    reason:
      'Every user-facing string on every surface is served from here, including the labels ' +
      'on the platform screen that holds the module switches.',
  },
  /**
   * The platform's own error codes — feature 090, Phase 3, the last owner
   * (`specs/090-module-owned-error-codes/core-block-home.md`).
   *
   * **This list opened as the frozen chain capture, not a judgement.** It was
   * the verbatim output of the runbook's step-1 derivation over
   * `backend/test/fixtures/error-code-routing/chain-answers.ts` — every code
   * `moduleIdForErrorCode` answers `core` for, in the capture's order. Nothing
   * was curated, added or dropped: `contracts/error-code-declaration.md` §6.2
   * makes the migration answer-preserving over all 289 codes with no exception
   * list, and §6.5 puts re-routing out of scope.
   *
   * **D-129's remaining sweep is what re-routes them, and it has begun** — so
   * this list is no longer the capture, and the difference is not a drift to be
   * reconciled by reading it. Every code that has left carries an entry in
   * `backend/test/fixtures/error-code-routing/reference-ledgers.ts`'
   * `REHOMED_ERROR_CODES` naming where it went, which of D-121's tiers decided
   * it and why; the capture itself is untouched, because a reference a
   * migration may rewrite is one that agrees with whatever the migration did.
   * `specs/090-module-owned-error-codes/d129-sweep.md` Appendix A is the design
   * and D-186 (`specs/080-f4-real-scope/rulings.md`) settles the four questions
   * it could not answer for itself.
   *
   * **Why `_i18n` and not a module called `core`.** `core` is not a module id.
   * It is the synthetic namespace this module's bundle is exposed under at the
   * resolver boundary (`I18N_CHROME_MODULE_ID` / `CORE_NAMESPACE` in
   * `backend/services/i18n-service.ts`), so the module that owns the platform
   * bundle — the phrase §6.5 uses — is this one. Every sentence for these codes
   * already lives in this package's `i18n/{en,pl}.json`; declaring them here
   * moves no key. The alternatives, and why each was refused, are §4 of the
   * design note: a residual set in `packages/contracts` (a second input to a
   * derivation §4 says has one), `_lifecycle` (82 sentence keys moved for no
   * operator-visible gain), and a new registered `_platform` module (a
   * registry row, an install-order position and a `/platform/modules` row,
   * invented to hold a list).
   *
   * **The codes a reader will look for here and not find are the opposite
   * problem: most of these are not the platform's.** 68 of the original 100
   * are named by exactly one module and by nothing else — `PROMPT_*` by
   * `prompt_actions`, `SHOPPING_LIST_*` by `shopping_lists`, and so on across
   * 17 modules. They are here because they fell off the end of the prefix
   * chain, and moving them to their owners is
   * `specs/082-error-code-ownership/rulings.md` §9's remaining sweep. D-121
   * decides each destination — 79 codes into 20 modules, 21 staying — and the
   * sweep runs it in batches: `KSEF_*` and `PIM_ERGONODE_*` were the first
   * families to leave. Do not move one in passing: a code that leaves this list
   * without arriving in its owner's manifest routes nowhere, and the collision
   * rule makes a half-done move visible at composition rather than at an
   * operator.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5). Seven of these codes put a `details.code` on the wire; six of
   * them are declared below, and the seventh is the exception the design note
   * says whoever migrates this block inherits: `VALIDATION_FAILED` declares
   * **no** tokens although 21 raise sites carry a `details.code`, because
   * `localizeErrorEnvelope` returns before translating that code
   * (`packages/platform/src/http/error-envelope.ts`) — its `details.code`
   * values are machine-readable discriminators on the wire and can never key an
   * `errors.VALIDATION_FAILED.<token>` sentence. Declaring them would declare
   * sentences nothing can ever render. Of the tokens that are declared, four
   * have a sentence in both languages today (`ADMIN_ROLE_IN_USE.assigned`,
   * `.assigned_to_deleted`, `FORBIDDEN.organization_cannot_transact`,
   * `.customer_outside_assignment_scope`) and five do not; a token a raise site
   * can produce is a token whether or not anybody has written its sentence, and
   * the missing ones become a Phase 4 finding rather than a silent absence.
   */
  errorCodes: [
    { code: 'ACCOUNT_BLOCKED' },
    { code: 'ACTIVE_RESERVATIONS_EXIST' },
    { code: 'ADDRESS_IN_USE' },
    { code: 'ADDRESS_NOT_OWNED' },
    { code: 'ADJUSTMENT_BELOW_ACTIVE' },
    { code: 'ADMIN_ROLE_CODE_TAKEN' },
    { code: 'ADMIN_ROLE_IN_USE', tokens: ['assigned', 'assigned_to_deleted'] },
    { code: 'ADMIN_ROLE_PROTECTED' },
    { code: 'ALREADY_SUBSCRIBED' },
    { code: 'API_KEY_CHANNEL_MISMATCH' },
    { code: 'API_KEY_NOT_BOUND' },
    { code: 'API_KEY_OUT_OF_SCOPE' },
    { code: 'ASSISTANT_DISABLED' },
    { code: 'ASSISTANT_NOT_CONFIGURED' },
    { code: 'BULK_TOO_LARGE' },
    { code: 'CANNOT_DEMOTE_LAST_ADMIN' },
    { code: 'CANNOT_REMOVE_LAST_ADMIN' },
    { code: 'CANNOT_REVOKE_LAST_ADMIN_INVITE' },
    { code: 'CREDIT_LIMIT_ALREADY_GRANTED' },
    { code: 'CREDIT_LIMIT_NOT_GRANTED' },
    { code: 'CURRENCY_MISMATCH' },
    { code: 'CURRENT_PASSWORD_INVALID' },
    { code: 'CUSTOMER_ADDRESS_NOT_FOUND' },
    { code: 'CUSTOMER_ALREADY_DELETED' },
    { code: 'CUSTOMER_NOT_DELETED' },
    { code: 'CUSTOMER_NOT_FOUND' },
    { code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED' },
    { code: 'CUSTOM_FIELD_DEFINITION_INVALID' },
    { code: 'CUSTOM_FIELD_HOST_MANAGED' },
    { code: 'CUSTOM_FIELD_KEY_CONFLICT' },
    { code: 'CUSTOM_FIELD_NOT_FOUND' },
    { code: 'CUSTOM_FIELD_VALUE_INVALID' },
    { code: 'EMAIL_ALREADY_IN_ORGANIZATION' },
    { code: 'EMAIL_ALREADY_REGISTERED' },
    { code: 'EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION' },
    {
      code: 'FORBIDDEN',
      tokens: [
        'organization_cannot_transact',
        'customer_outside_assignment_scope',
        'reorder_disabled',
      ],
    },
    { code: 'IDEMPOTENCY_KEY_REQUIRED' },
    { code: 'IDEMPOTENCY_KEY_REUSED' },
    { code: 'INTERNAL', tokens: ['customer_account_organization_missing'] },
    { code: 'INVALID_CREDENTIALS' },
    { code: 'INVALID_TRANSITION' },
    { code: 'LIMIT_INSUFFICIENT' },
    { code: 'MODULE_ACTIVATION_PROTECTED' },
    { code: 'MODULE_DEPENDENCIES_ABSENT' },
    { code: 'MODULE_DEPENDENTS_PRESENT' },
    { code: 'MODULE_DISABLED' },
    { code: 'MODULE_NOT_DEACTIVATABLE' },
    { code: 'MODULE_NOT_FOUND' },
    { code: 'MODULE_SETTING_READ_ONLY' },
    { code: 'NOT_FOUND' },
    { code: 'ORGANIZATION_HAS_CHILDREN', tokens: ['has_children'] },
    { code: 'ORGANIZATION_SUSPENDED' },
    { code: 'ORGANIZATION_TAX_ID_EXISTS' },
    { code: 'ORGANIZATION_TREE_INVALID', tokens: ['cycle', 'max_depth_exceeded'] },
    { code: 'ORG_OWNER_DEPLETION' },
    { code: 'PACKAGING_UNIT_NAME_CONFLICT' },
    { code: 'PACKAGING_UNIT_NOT_FOUND' },
    { code: 'PACKAGING_UNIT_NOT_SUPPORTED_FOR_TYPE' },
    { code: 'PRICE_LIST_NOT_FOUND' },
    { code: 'PRICE_UNAVAILABLE' },
    { code: 'PROMOTION_INVALID' },
    { code: 'PROMPT_PERMISSION_REVOKED' },
    { code: 'PROMPT_PLAN_EXPIRED' },
    { code: 'PROMPT_REQUEST_INVALID_STATE' },
    { code: 'PROMPT_REQUEST_IN_FLIGHT' },
    { code: 'RATE_LIMITED' },
    { code: 'REGISTRATION_REQUIRES_ORGANIZATION' },
    { code: 'SELECTION_TOO_LARGE' },
    { code: 'SHOPPING_LIST_CANNOT_DELETE_DEFAULT' },
    { code: 'SHOPPING_LIST_CANNOT_DELETE_LAST' },
    { code: 'SYSTEM_ATTRIBUTE_SET_IMMUTABLE' },
    { code: 'TERMS_VERSION_STALE' },
    { code: 'TOKEN_INVALID_OR_EXPIRED' },
    { code: 'TRANSACTIONAL_EMAIL_NOT_DEACTIVATABLE' },
    { code: 'TWO_FACTOR_REQUIRED' },
    { code: 'TWO_FACTOR_REQUIRED_BY_ROLE' },
    { code: 'UNAUTHORIZED' },
    { code: 'VALIDATION_FAILED' },
    { code: 'VERSION_CONFLICT', tokens: ['organization_version_mismatch'] },
    { code: 'WEBHOOK_DELIVERY_NOT_REPLAYABLE' },
  ],
});

/**
 * `translation_bundles` follows the manifest set — feature 080, T036a / D-159.
 *
 * Not an install hook: an install hook fires for *its own* module, and this has
 * to run whenever **any** module is installed, because this module's table is a
 * projection of every other module's `manifest.i18n` declaration. Not a port
 * either: the lifecycle orchestrator also serves the five `module:*` commands,
 * and a platform command composes no container to resolve one from (D-157.2 /
 * D-157.4) — which is exactly how a terminal install came to write no bundle at
 * all while the same install from `/platform/modules` wrote them.
 *
 * The service is imported at call time, not at module load. This file is
 * imported by the generated manifest index, which is in turn imported by every
 * static check script and by `src/db/configured-migrations.ts`; a static import
 * of `I18nService` would pull an ORM-dependent graph into all of them.
 *
 * A fresh `I18nService` per call is correct and not a lost cache:
 * `getMergedBundleForLanguage` revalidates against `MAX(version)` in the table
 * on every read, so the running server picks the new rows up on its next
 * request without having been the instance that wrote them.
 */
export const lifecycleParticipant: ModuleLifecycleParticipant<EntityManager> = {
  async onModuleInstalled({ moduleId, manifest: installed, modulePath, em }) {
    // The declaration belongs to the module being installed, so the decision
    // is this one's to make: a manifest with no `i18n` block ships no bundle.
    if (!installed.i18n) return;
    const { I18nService } = await import('./backend/services/i18n-service.js');
    await new I18nService({ em: () => em }).installBundlesForModule(
      moduleId,
      modulePath,
      installed.i18n.bundlesDir,
      em,
    );
  },
  async onModuleHardUninstalled({ moduleId, em }) {
    // Unconditional, and deliberately not gated on the manifest's `i18n`
    // block: the manifest is `null` for an orphan row whose module this
    // instance no longer has, and that is the one case whose rows nothing
    // else will ever remove.
    const { I18nService } = await import('./backend/services/i18n-service.js');
    await new I18nService({ em: () => em }).removeBundlesForModule(moduleId, em);
  },
};

/**
 * The two operator commands this module declares — feature 080, T042b /
 * D-160.9.
 *
 * They were `scripts/reload.ts` and `scripts/coverage.ts`, each opening its own
 * ORM and building its own `I18nService`. The host composes now and hands the
 * body this module's `ModuleContext`, which is what retired this module's one
 * `check:module-boundary` key: `reload` needed the deployment's module registry,
 * and the registry is a root-supplied name any module may read off its cradle.
 *
 * The bodies are `await import()`ed for the reason the participant above gives:
 * this file is imported by the generated manifest index, and through it by every
 * static check script and by `src/db/configured-migrations.ts`.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'reload',
    summary: "Re-read every module's on-disk i18n bundles into translation_bundles.",
    run: async (context) => (await import('./backend/cli/reload.js')).reload(context),
  },
  {
    name: 'coverage',
    summary: 'Print the per-module, per-language translation coverage snapshot.',
    run: async (context) => (await import('./backend/cli/coverage.js')).coverage(context),
  },
];
