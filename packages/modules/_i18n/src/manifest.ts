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
   * **The platform's error-code block — 21 codes, and this is their home** rather
   * than the residue of a migration (feature 090,
   * `specs/090-module-owned-error-codes/core-block-home.md`; D-186 §4).
   *
   * A code is here because **no module owns its noun** — D-121 T3, and nothing
   * weaker. Not because the platform throws it: D-121 rejected the thrower rule
   * by measurement, and four of the entries below name a code exactly one module
   * raises. Each carries its tier and the sentence that argues it in
   * `PLATFORM_OWNED_ERROR_CODES`
   * (`backend/test/fixtures/error-code-routing/reference-ledgers.ts`), which is
   * where a reason can live in a form a test reads — a comment does not survive
   * `tsc`, and the gate reads this list out of the built package.
   *
   * **The gate, and what it is derived from.**
   * `backend/test/unit/_i18n/platform-error-code-block.test.ts` holds this list
   * and those annotations equal in **both** directions: a code added here with no
   * reason of its own is `unannotated` and names itself, and an annotation this
   * list no longer backs is `undeclared`. Neither side is a written-down list of
   * twenty-one (D-100) — the annotations' membership is itself held against
   * `intendedRouting(capture, ledgers)`, the frozen chain capture with the
   * re-homing and minting ledgers laid over it, so what belongs here is the
   * hundred the deleted chain answered `core` for minus the seventy-nine D-129's
   * sweep moved. D-186 §4 chose that over a scanner because both scanners were
   * measured and both are ledgers of exceptions (`d129-sweep.md` §6.1–§6.2),
   * and because a block of twenty-one lines is one a reviewer reads in full.
   *
   * **How it came to be twenty-one.** The list opened as the frozen chain
   * capture and not as a judgement: the verbatim output of the runbook's step-1
   * derivation over `test/fixtures/error-code-routing/chain-answers.ts`, every
   * code `moduleIdForErrorCode` answered `core` for, because
   * `contracts/error-code-declaration.md` §6.2 makes the migration
   * answer-preserving over all 289 codes with no exception list and §6.5 puts
   * re-routing out of scope. Most of that hundred was never the platform's: they
   * fell off the end of a prefix chain that ended in `return 'core'`, which is
   * the defect `specs/082-error-code-ownership/rulings.md` §9 opened the sweep
   * for. D-129's sweep then moved **79 codes into 20 modules** over six batches —
   * Tier A's `KSEF_*` and `PIM_ERGONODE_*` (MR 2) and its six remaining modules
   * (MR 3), Tier B's six that already shipped a bundle (MR 4) and its four that
   * had to create one (MR 5), then Tier C's `admin_roles` (MR 6) and
   * `organizations` (MR 7) — and every one of the 79 carries a
   * `REHOMED_ERROR_CODES` entry naming where it went, which tier decided it and
   * why. The capture itself is untouched, because a reference a migration may
   * rewrite is one that agrees with whatever the migration did.
   *
   * **Do not move one in passing.** A code that leaves this list without arriving
   * in its owner's manifest routes nowhere; one that arrives in both routes to
   * neither, and the collision rule makes that visible at composition rather than
   * at an operator. The three ledgers and the two harnesses all read the same
   * reference, so a half-done move is red in the merge request that made it.
   *
   * **Why `_i18n` and not a module called `core`.** `core` is not a module id. It
   * is the synthetic namespace this module's bundle is exposed under at the
   * resolver boundary (`I18N_CHROME_MODULE_ID` / `CORE_NAMESPACE` in
   * `backend/services/i18n-service.ts`), so the module that owns the platform
   * bundle — the phrase §6.5 uses — is this one. Every sentence for these codes
   * already lives in this package's `i18n/{en,pl}.json`. The alternatives, and
   * why each was refused, are §4 of the design note: a residual set in
   * `packages/contracts` (a second input to a derivation §4 says has one),
   * `_lifecycle` (82 sentence keys moved for no operator-visible gain), and a new
   * registered `_platform` module (a registry row, an install-order position and
   * a `/platform/modules` row, invented to hold a list).
   *
   * **`tokens` is derived from the raise sites, not from the bundle** (runbook
   * §5), and the arithmetic below is **re-derived on this tree rather than
   * decremented** — which is the instruction each batch of the sweep followed and
   * the reason the numbers survived it. Measured over the 21 by balanced-paren
   * extraction of every `new HttpError(...)` call's own arguments: **794 raise
   * sites, four of the codes carrying a `details.code`**. Three of the four
   * declare their tokens here — five tokens in total, of which **two have a
   * sentence in both languages** (`FORBIDDEN.organization_cannot_transact`,
   * `.customer_outside_assignment_scope`) and three do not, each of those three
   * being a Phase 4 finding rather than a silent absence. The fourth is
   * `VALIDATION_FAILED`, which declares **none** although 19 distinct tokens are
   * passed at its raise sites: `localizeErrorEnvelope` returns before translating
   * that code (`packages/platform/src/http/error-envelope.ts`), so its
   * `details.code` values are machine-readable discriminators on the wire and can
   * never key an `errors.VALIDATION_FAILED.<token>` sentence. Declaring them
   * would declare sentences nothing can render. If a code arrives or leaves,
   * re-run the scan; do not adjust the number.
   *
   * **What the bundle holds for these 21**: 16 `errors.*` keys in each language —
   * 14 base sentences and the two token keys above. The seven codes with no
   * sentence are the six `MODULE_*` refusals an operator meets through the
   * lifecycle CLI rather than through the envelope, plus `PRICE_UNAVAILABLE`,
   * which nothing raises. All seven are on `UNTRANSLATED_ERROR_CODES` under this
   * module's group and are drained by writing a sentence, never by moving a code.
   */
  errorCodes: [
    // T3 — the platform's own `MODULE_*` vocabulary (7). The noun is a module,
    // and what installs, composes, gates and withdraws one is the platform.
    // `settings`, `audit_logs`, `product_feeds` and `carts` raise four of these
    // seven and own none of them; the deleted chain reached them through a rule
    // that **named** them (`startsWith('MODULE_')`), which is a decision rather
    // than the fall-through the rest of the block arrived by (`d129-sweep.md`
    // §2.2).
    { code: 'MODULE_ACTIVATION_PROTECTED' },
    { code: 'MODULE_DEPENDENCIES_ABSENT' },
    { code: 'MODULE_DEPENDENTS_PRESENT' },
    { code: 'MODULE_DISABLED' },
    { code: 'MODULE_NOT_DEACTIVATABLE' },
    { code: 'MODULE_NOT_FOUND' },
    { code: 'MODULE_SETTING_READ_ONLY' },

    // T3 — the envelope's generic vocabulary (6). Each of these is what dozens
    // of modules answer with for a condition that is about the request rather
    // than about a noun, so its sentence has to be generic and the specific case
    // is a token on it (issue #65) or an interpolated value (issue #161).
    { code: 'FORBIDDEN', tokens: [
      'organization_cannot_transact',
      'customer_outside_assignment_scope',
      'reorder_disabled',
    ] },
    { code: 'INTERNAL', tokens: ['customer_account_organization_missing'] },
    { code: 'NOT_FOUND' },
    { code: 'UNAUTHORIZED' },
    { code: 'VALIDATION_FAILED' },
    { code: 'VERSION_CONFLICT', tokens: ['organization_version_mismatch'] },

    // T3 by D-122 — a noun with two claimants or none (7). Identical claimants
    // are the proof: `admin_users` and `customer_accounts` each own an account
    // with a password, `orders` and `returns` each own a state machine, and
    // `catalog` and `price_lists` both claim the noun "price".
    // `INVALID_TRANSITION` is the code D-122 was written about.
    { code: 'CURRENT_PASSWORD_INVALID' },
    { code: 'EMAIL_ALREADY_REGISTERED' },
    { code: 'INVALID_CREDENTIALS' },
    { code: 'INVALID_TRANSITION' },
    { code: 'PRICE_UNAVAILABLE' },
    { code: 'TERMS_VERSION_STALE' },
    { code: 'TOKEN_INVALID_OR_EXPIRED' },

    // T3 by declaration (1). The deleted chain named `RATE_LIMITED` in an
    // explicit generic list rather than reaching it by fall-through, which makes
    // it `core-block-home.md` §1.3's counter-example: an explicit T3 with one
    // raiser today. The noun is a request budget, which the platform imposes.
    { code: 'RATE_LIMITED' },
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
