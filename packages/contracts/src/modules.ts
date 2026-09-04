// Module Lifecycle — feature 018 contract surface.
//
// Defines the on-disk-data shape every module's `manifest.ts` exports plus
// the registry-record shape persisted in `module_registrations`. The settings
// portion (per-module groups + settings) is delegated to feature 004's
// existing `ModuleSettingsManifestSchema`; this module wraps it with the
// outer module-level metadata (id, name, version, dependencies, optional
// license tier) and the lifecycle-hook type aliases.
//
// Hooks themselves are NOT validated by Zod (functions don't serialise
// through schemas); the loader attaches them from the manifest module's
// runtime exports as a separate step.

import { z } from 'zod';
import {
  ModuleSettingsManifestSchema,
  settingCodeRe,
  type ModuleSettingsManifest,
  type SettingManifestEntry,
} from './settings.js';
import { KnownIconNameSchema, ModuleActionsManifestSchema } from './admin-actions.js';
import { modulePermissionDeclarationSchema } from './admin.js';
import { errorCodeRe } from './errors.js';
import { transactionalEmailManifestEntrySchema } from './transactional-emails.js';
import { BlockCategorySchema, BlockDefinitionSchema, blockNameRe } from './cms.js';

// ---------------------------------------------------------------------------
// Identifier / version regexes
// ---------------------------------------------------------------------------

/**
 * Module identifier — must equal the manifest file's parent folder name.
 * Two-character ids are allowed (e.g. `_lifecycle` after underscore allowance).
 * Underscore-prefixed ids are reserved for platform-internal modules
 * (constitutional exemption alongside `auth` and `example`).
 */
export const moduleIdRe = /^_?[a-z][a-z0-9_]*$/;

/** Semver-lite — `MAJOR.MINOR.PATCH` plus an optional `-prerelease` suffix. */
export const moduleVersionRe = /^\d+\.\d+\.\d+(?:-[a-z0-9.]+)?$/;

// ---------------------------------------------------------------------------
// Module manifest
// ---------------------------------------------------------------------------

/**
 * License tier reserved for future edition-gating (per `research.md` R-10).
 * v1 only validates and audits this field; enforcement is the
 * release-pipeline's responsibility.
 */
export const ModuleLicenseTierSchema = z.enum(['core', 'pro', 'enterprise']);
export type ModuleLicenseTier = z.infer<typeof ModuleLicenseTierSchema>;

/**
 * Per-module Admin UI translation declaration (feature 019).
 * When present, the lifecycle install hook reads
 * `<modulePath>/<bundlesDir>/<lang>.json` for every supported Admin UI
 * language and registers the bundle into `translation_bundles`. Default
 * `bundlesDir` is `'i18n'` — every module that ships translations is
 * expected to follow this convention.
 */
export const ModuleI18nManifestSchema = z.object({
  bundlesDir: z.string().min(1).default('i18n'),
});
export type ModuleI18nManifest = z.infer<typeof ModuleI18nManifestSchema>;

/**
 * Per-module documentation declaration (feature 100 / roadmap F12).
 *
 * The same shape as {@link ModuleI18nManifestSchema} and for the same reason: a
 * directory at the **package root**, in the package's `files` list, with no
 * `exports` subpath, located by joining `dir` to `dirname(manifestPath)`. The
 * anchor is the platform's, so nothing in the module names a package, a
 * repository root or a build directory in order to find its own pages
 * (`specs/100-module-owned-documentation/contracts/module-documentation-layer.md`
 * R2.1–R2.3).
 *
 * A declared directory that is not on disk is a **refusal**, naming the module —
 * never "this module ships no documentation". That distinction is the whole of
 * the repair `backend/src/manifest-locations.ts` was written for: the `_i18n`
 * boot reconciler logs and skips an absent bundles directory, so a packaged
 * module rendered every palette entry as a raw key with no error anywhere.
 */
export const ModuleDocsManifestSchema = z.object({
  /** The directory, relative to the module's own root. */
  dir: z.string().min(1).default('docs'),
});
export type ModuleDocsManifest = z.infer<typeof ModuleDocsManifestSchema>;

/**
 * `docs: false` — this module ships no documentation, deliberately.
 *
 * **Absent and `false` are not the same state**, and the documentation check
 * distinguishes them: absent is a module nobody has decided about, `false` is a
 * decision. The argument is `check:bundle-pairing`'s, one population over — a
 * universal obligation over a population where some members legitimately owe
 * nothing is repaired by empty files whose only effect is to make a check pass.
 * Some modules are infrastructure other modules consume and may honestly
 * document nothing.
 */
export const ModuleDocsDeclarationSchema = z.union([ModuleDocsManifestSchema, z.literal(false)]);
export type ModuleDocsDeclaration = z.infer<typeof ModuleDocsDeclarationSchema>;

/**
 * Operator-activation declaration — feature 073, Constitution XVII.
 *
 * The second of the two orthogonal presence axes. Platform availability lives
 * in `module_registrations` and is owned by whoever operates the deployment;
 * this block declares the *business* operator's control, which is an ordinary
 * `Setting` row reconciled from the manifest.
 *
 * It sits beside `license`, never inside it: `license` is the build-time
 * entitlement axis and is inert by design, and conflating the two would make a
 * runtime toggle look like a licensing decision.
 *
 * Exactly one of the two forms is valid — enforced in `defineModuleManifest`
 * rather than by the schema, because a Zod union of two non-strict objects
 * accepts a value carrying both.
 */
export const ModuleActivationSchema = z.union([
  z.object({
    /**
     * The Setting that holds the operator's choice. Declared rather than
     * derived so a module that already ships an ad-hoc control (`blog.enabled`
     * and friends) can adopt it instead of growing a second switch.
     */
    settingCode: z.string().regex(settingCodeRe),
    /** Applies when the operator has never chosen. Asserted, never assumed. */
    default: z.boolean(),
  }),
  z.object({
    /** The platform cannot run without this module. */
    nonDeactivatable: z.literal(true),
    /** Operator-facing sentence rendered next to the locked control. */
    reason: z.string().min(1).max(200),
  }),
]);
export type ModuleActivation = z.infer<typeof ModuleActivationSchema>;

/**
 * A runtime dependency the declaring module deliberately keeps out of
 * `dependencies` — feature 073, Amendment A1.
 *
 * The two are not two spellings of one thing. `dependencies` is read by the
 * **topological install order** (`db/migration-order.ts`, the lifecycle's
 * `ModuleDepGraph`), and a mutual pair declared there closes a cycle that fails
 * the build: `addresses` must install after `organizations` because every
 * stored address is organization-scoped, so `organizations` cannot also declare
 * `addresses`, however real the port edge is. Withholding the declaration used
 * to make the edge invisible to everything else too — the flip-time refusals
 * saw no reason to stop an operator switching the owner off underneath a live
 * resolver.
 *
 * So the edge is declared here instead: **read by the gating and refusal
 * graph, ignored by the install order.** That is the whole trade, stated in the
 * manifest that makes it rather than in a build script's constant, so a
 * refusal and a CI check cannot drift apart on which edges exist.
 */
export const ModuleAcknowledgedDependencySchema = z.object({
  /** The module that owns the port. */
  moduleId: z.string().regex(moduleIdRe),
  /** The container registration name this module resolves, e.g. `addressService`. */
  port: z.string().min(1),
  /** Why the edge cannot be declared in `dependencies` — the cycle, spelled out. */
  reason: z.string().min(1).max(800),
});
export type ModuleAcknowledgedDependency = z.infer<
  typeof ModuleAcknowledgedDependencySchema
>;

/**
 * An edge that is real to the container but does not bind the operator — D-44.
 *
 * `dependencies` is read as three claims at once: install-and-migration order,
 * "the container resolution is declared", and "an operator may not switch the
 * owner off underneath me". `acknowledgedDependencies` withdraws the first.
 * This withdraws the third, and only the third: a module declares here that it
 * reads a name `moduleId` owns and that it has a defined behaviour when
 * `moduleId` is not there, so the flip-time refusal has nothing to protect.
 *
 * Read by `check-port-dependencies.ts`, which needs the ownership claim and
 * nothing else, and — when the deactivation-consequence dialog ships — by
 * `/platform/modules`, which renders {@link whenAbsent}. Read by **nothing
 * else**: not `ModuleDepGraph`, not `db/migration-order.ts`, and not
 * `ModuleGatingGraph` in either direction. A cross-module foreign key therefore
 * still forces a `dependencies` entry, and `fk-dependency-drift.test.ts` still
 * fails for one declared here instead.
 *
 * The three kinds are the three ways an edge can exist without the bind bit:
 *
 *  - **`contributes-to`** — the declaring module pushes an inert descriptor
 *    into `moduleId`'s ungated registry at boot. It has no failure mode in
 *    either direction: an absent contributor's descriptor is filtered by the
 *    host at enumeration, and an absent host's registry is a table nobody
 *    walks. `whenAbsent` is forbidden, because nothing degrades.
 *  - **`degrades-without`** — the declaring module reads an answer from
 *    `moduleId`, checks presence before it does, and keeps working with less.
 *    `whenAbsent` is required and states that behaviour, which is what an
 *    off-state test for the edge is held to.
 *  - **`refuses-without`** — the declaring module reads a **gated port**, has
 *    no fallback for it, and lets the 503 `MODULE_DISABLED` refusal reach the
 *    caller. The operation stops; the rest of the declaring module keeps
 *    working; the owner's activation control keeps working. `whenAbsent` is
 *    required and names **what** refuses, because that is the whole payload:
 *    the deactivation-consequence ledger classifies the edge `fails-closed`
 *    and the operator's confirmation dialog renders this sentence.
 *
 * The third kind was an omission rather than a narrowing, and it is worth
 * saying why, because the gap is invisible from the manifest side. A read with
 * no fallback had only one spelling — `dependencies` (or
 * `acknowledgedDependencies`) — and both carry the bind, so a dependent that
 * cannot itself be switched off turned the *owner's* activation control into a
 * dead switch: the operator flips it, the flip-time refusal names a module
 * that will never go away, and nothing happens. That is a worse answer than
 * either alternative, since a control that lies is not a control. So the
 * missing spelling is "refuse, and do not bind", which is what this kind is;
 * the outcome it produces (`fails-closed`) has been in the ledger's vocabulary
 * since feature 074 and was reachable only for edges that also bound.
 *
 * **The half of the claim about the owner's control is already unspellable**,
 * and it is worth knowing where: rule 2 of `assertNonBindingRules` refuses any
 * non-binding edge whose target the same manifest also names in
 * `dependencies` or `acknowledgedDependencies` — one edge, one claim, in one
 * place. So a `refuses-without` entry cannot sit beside the bind it denies;
 * a module that wants both is telling the operator two things at once and is
 * refused before the ledger ever sees it. `check-port-dependencies.ts` re-
 * derives the same fact from the manifests as a second net, for a manifest
 * built without this helper.
 *
 * The other two halves are the check's alone, because both are properties of
 * the *tree* rather than of the manifest: the name is registered with
 * `di.providePort` (an ungated registration has no refusal to propagate), and
 * the resolution happens at call time (a gated port resolved at boot stops the
 * next start rather than one request — the ledger's
 * `gated-port-before-first-request`, which is assigned before any declaration
 * is consulted and which no entry can therefore rescue).
 *
 * The fourth quadrant — order without bind — stays deliberately unspellable
 * (Constitution IV). An edge that needs both goes back to `dependencies`, and
 * the bind comes back with it.
 */
export const ModuleNonBindingDependencySchema = z.object({
  /** The module that owns the registration. */
  moduleId: z.string().regex(moduleIdRe),
  /** The container registration name, e.g. `promptActionToolRegistry`. */
  name: z.string().min(1),
  kind: z.enum(['contributes-to', 'degrades-without', 'refuses-without']),
  /**
   * `degrades-without` and `refuses-without` only: what stops working, and for
   * the second, what refuses. Rendered beside the control.
   */
  whenAbsent: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(800),
});
export type ModuleNonBindingDependency = z.infer<
  typeof ModuleNonBindingDependencySchema
>;

/**
 * One module a deployment knowingly does not ship — D-101's declared escape.
 *
 * A deployment may compose fewer modules than its manifests declare; what it may
 * not do is arrive there silently, so the omission is declared in a committed,
 * reviewed file (`backend/src/apps/<deployment>/divergence.ts`) and the boot
 * refuses an omission that is not in it — or an entry for a module the
 * deployment does ship, which is the same ledger read the other way.
 *
 * This is `ReducedDeploymentDeclaration` under its own name (D-205), and it is
 * unchanged in substance: a module id, and a reason long enough to be an
 * argument. What changed is where it sits — inside
 * {@link DeploymentDivergenceDeclarationSchema}'s `omittedModules`, beside the
 * other two things a deployment declares about itself.
 */
export const OmittedModuleSchema = z.object({
  /** The module this deployment does not ship. */
  moduleId: z.string().regex(moduleIdRe),
  /**
   * Why — in prose, and long enough to be an argument. "We do not need it" is
   * not a reason; what the deployment does instead of the capability is.
   */
  reason: z.string().min(20).max(800),
});
export type OmittedModule = z.infer<typeof OmittedModuleSchema>;

/**
 * Everything a deployment declares about how it means to differ from core.
 *
 * `backend/src/apps/<deployment>/divergence.ts`, exporting `divergence`. The
 * file was `reduced-deployment.ts` until it grew past omissions (D-205):
 * *reduced* encodes a direction that is wrong for an addition, wrong for a
 * substitution and wrong for an ordering, while `divergence` is already the
 * word the generator's own header uses for the derived artefact beside it.
 *
 * The shape lives here rather than in `_lifecycle` because the file carrying it
 * belongs to a **deployment**, and a deployment naming a module's internals is
 * the coupling that outlives the module.
 *
 * **It holds judgement, ordering and prose — never population.** The single test
 * for a field is whether the platform can derive it: the deployment's module
 * list is the overlay walk's answer and the divergences themselves are the
 * report's, so neither belongs here
 * (`specs/107-override-report-and-ladder/contracts/deployment-declaration.md` §5).
 *
 * Every field defaults to empty, so a declaration that leaves one out means
 * "none of these" rather than "unparseable" — the reading an absent file already
 * gets. A deployment that diverges by nothing still ships the file with all
 * three written out, because the mechanism is easier to find than to remember.
 */
export const DeploymentDivergenceDeclarationSchema = z.object({
  /** The modules this deployment does not ship. D-101, unchanged in substance. */
  omittedModules: z.array(OmittedModuleSchema).default([]),
  /**
   * Wrapping order, per registration name, for a name more than one of this
   * deployment's overlay modules decorates — innermost first.
   *
   * **Checked, never applied.** The composer emits modules in its own order and
   * drains decorations once; this declares that the resulting order was the
   * intended one, and a composition that disagrees refuses. Making the
   * declaration authoritative would put a hand-written array in front of the
   * composer's topological emission, which is two orderings of one thing waiting
   * to disagree.
   *
   * Only a deployment's own overlay modules can appear here: a core module and
   * an installed package may not decorate a name they do not own (D-156.4), so
   * every ambiguity this can resolve is between two of them.
   *
   * Nothing reads it yet — the supply is P4 of
   * `specs/107-override-report-and-ladder/`.
   */
  decorationOrder: z
    .record(z.string().min(1), z.array(z.string().regex(moduleIdRe)).min(1))
    .default({}),
  /**
   * One sentence per divergence the platform derives, keyed by the derived
   * entry's own key — `<kind>:<module>:<subject>`, never a path and never a
   * line.
   *
   * A flat map rather than a reason field on a per-kind array, and the
   * difference is structural rather than stylistic: a map can only ever
   * *answer*. So the declaration cannot add a divergence the derivation did not
   * find, nor hide one it did — the population is the report's and the judgement
   * is this.
   *
   * The key's grammar is checked where the population it keys into exists;
   * nothing reads this yet — the report is P2 of
   * `specs/107-override-report-and-ladder/`.
   */
  reasons: z.record(z.string().min(1), z.string().min(20).max(800)).default({}),
})
  // Three fields are the whole vocabulary, so a fourth is a typo — and a
  // mistyped field name under a lenient object is silently stripped, which
  // reads as "this deployment declares nothing" for a file whose author wrote
  // a declaration. Refusing it names the key.
  .strict();
export type DeploymentDivergenceDeclaration = z.infer<
  typeof DeploymentDivergenceDeclarationSchema
>;

/**
 * Refusal-token grammar for {@link ModuleErrorCodeDeclarationSchema}.
 *
 * One code, several reasons — `specs/082-error-code-ownership/contracts/error-code-ownership.md`
 * §1.4. The envelope reads `details.code` and looks up `errors.<CODE>.<token>`,
 * or `errors.<CODE>` when the raise carries no token.
 *
 * **It is a choice between two keys and not a fall-back**, which this note said
 * it was until D-190 (`specs/080-f4-real-scope/rulings.md`) measured it:
 * `localizeErrorEnvelope` composes one key, asks for it once and never re-asks.
 * So a code every raise of which carries a token has no reader for its
 * `errors.<CODE>` sentence — the operator never sees it, and deleting it is
 * still wrong, because `check:error-translations` asks its P1 question at that
 * key and at no other.
 */
export const errorCodeTokenRe = /^[a-z][a-z0-9_]*$/;

/**
 * One error code a module claims as its own
 * (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §1.1).
 *
 * **No `message` field, and that is a decision.** The English sentence a caller
 * sees when nothing is translated is the one the raising code wrote: it already
 * exists, it is written where the condition is known, and it can interpolate.
 * A manifest message would be a third English sentence for one condition, and
 * the two would drift exactly as a permission's `label` and its
 * `adminRoles.permission.<code>` bundle key already do. The translated
 * sentences live in the declaring module's own `i18n/<language>.json` under
 * `errors.<CODE>`, which is where the envelope already looks.
 *
 * **`tokens` is declared rather than inferred** because a static reader that
 * does not know the token set cannot tell `errors.CART_COUPON_REJECTED.expired`
 * from a key whose tail is not a code at all — which is a finding. Fourteen keys
 * in `invoices` and `carts` have this shape today.
 */
export const ModuleErrorCodeDeclarationSchema = z.object({
  code: z.string().regex(errorCodeRe),
  tokens: z.array(z.string().regex(errorCodeTokenRe)).optional(),
});
export type ModuleErrorCodeDeclaration = z.infer<typeof ModuleErrorCodeDeclarationSchema>;

export const ModuleManifestSchema = z.object({
  id: z.string().regex(moduleIdRe),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  version: z.string().regex(moduleVersionRe),
  dependencies: z.array(z.string().regex(moduleIdRe)).default([]),
  /**
   * Real port edges withheld from `dependencies` for install-ordering reasons
   * (feature 073, Amendment A1). Consumed by `check-port-dependencies.ts` and
   * by the lifecycle's flip-time dependency refusals; never by the install
   * order or the migration order.
   */
  acknowledgedDependencies: z.array(ModuleAcknowledgedDependencySchema).optional(),
  /**
   * Real container edges that deliberately do **not** bind the operator (D-44).
   * Consumed by `check-port-dependencies.ts` for the ownership claim; read by
   * no graph and by no ordering. See {@link ModuleNonBindingDependencySchema}.
   */
  nonBindingDependencies: z.array(ModuleNonBindingDependencySchema).optional(),
  license: ModuleLicenseTierSchema.optional(),
  /**
   * Operator-activation control (feature 073). Optional only while the
   * conversion sweep is in flight: `check-module-gating` requires it as soon
   * as a module's seams are converted, so a converted module without it fails
   * CI rather than resolving to an implicit "on".
   */
  activation: ModuleActivationSchema.optional(),
  /**
   * Per-module settings declaration consumed by the existing feature 004
   * `ManifestReconciler`. When present, its `moduleCode` MUST equal the
   * outer `id` — the loader enforces this at boot.
   */
  settings: ModuleSettingsManifestSchema.optional(),
  /**
   * Per-module Admin UI translation declaration (feature 019).
   * When present, the lifecycle install hook ingests bundle JSON files
   * from `<bundlesDir>` into the platform's `translation_bundles` store.
   */
  i18n: ModuleI18nManifestSchema.optional(),
  /**
   * Per-module documentation declaration (feature 100 / roadmap F12).
   *
   * `{ dir }` — the module ships its pages at that directory under its own
   * root; `false` — it ships none, deliberately; **absent** — nobody has
   * decided, which is where every module stands in Phase 1 while the pages are
   * still in the site's own tree. See {@link ModuleDocsDeclarationSchema} for
   * why the last two are not one state.
   */
  docs: ModuleDocsDeclarationSchema.optional(),
  /**
   * Per-module Admin Command Palette action declarations (feature 020).
   * Each entry becomes a row in `module_actions` at install time and is
   * surfaced in the admin's command palette under the Actions group.
   * Within-module id uniqueness is enforced by the schema.
   */
  actions: ModuleActionsManifestSchema.optional(),
  /**
   * Per-module admin permission codes merged into the assignable catalogue
   * when the module is enabled (feature 026).
   */
  permissions: z.array(modulePermissionDeclarationSchema).optional(),
  /**
   * Per-module transactional email declarations (feature 047). Each entry is
   * reconciled into `transactional_emails` at boot; default subject/content are
   * supplied separately at runtime via the EmailDefaultsRegistry.
   */
  transactionalEmails: z.array(transactionalEmailManifestEntrySchema).optional(),
  /**
   * When `true`, the module participates in the PIM connector mutual-exclusion
   * set (feature 089). Consumed by `pim_connector` registry discovery — not by
   * install ordering.
   */
  pimConnector: z.literal(true).optional(),
  /**
   * The operator-visible error codes this module owns (feature 090, D-182).
   *
   * The declaration is what routes the code's sentence to this module's bundle:
   * `errors.<CODE>` in `<module>/i18n/<language>.json`. Which module owns a code
   * is `specs/082-error-code-ownership/contracts/error-code-ownership.md` §1 —
   * the domain noun decides, never the thrower, so `orders` raising `CART_EMPTY`
   * leaves the code owned by `carts`.
   *
   * Absent means "this module owns no operator-visible error code", which is
   * true of most modules and is not a finding.
   */
  errorCodes: z.array(ModuleErrorCodeDeclarationSchema).optional(),
  /**
   * The Page Builder blocks this module owns (feature 096, FR-001/FR-006).
   *
   * A block's `name` is `<this module's id>.<LocalName>` and is **persisted**:
   * it is written into the `type` position of a Puck node in a `jsonb` column
   * and is the only link between a stored node and the module that can render
   * it. Which module owns a block is the domain noun its fields and data belong
   * to — the rule `specs/082-error-code-ownership/contracts/error-code-ownership.md`
   * §1 already applies to error codes — never the package the renderer file
   * currently sits in.
   *
   * Absent means "this module owns no Page Builder block", which is true of
   * most modules and is not a finding.
   */
  blocks: z.array(BlockDefinitionSchema).optional(),
  /**
   * The palette sections this module declares (feature 096, FR-009).
   *
   * Declared rather than hard-coded so that contributing a block into a section
   * costs no edit to a shared `categories` map in a package the contributor
   * does not own. Two modules declaring the same key for the same context is
   * expected and merges; a category exists per context, so `layout` for `cms`
   * and `layout` for `email` are two entries.
   */
  blockCategories: z.array(BlockCategorySchema).optional(),
});
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

/**
 * The three cross-field activation rules (feature 073,
 * `contracts/module-activation-manifest.md`). They live here rather than in
 * the schema because a Zod union of two non-strict objects accepts a value
 * carrying both forms, and because the resulting message has to name the
 * module the author is looking at.
 */
function assertActivationRules(id: string, activation: unknown): void {
  const block = activation as Record<string, unknown>;
  const declaresControl =
    typeof block['settingCode'] === 'string' && typeof block['default'] === 'boolean';
  const declaresNonDeactivatable =
    block['nonDeactivatable'] === true &&
    typeof block['reason'] === 'string' &&
    block['reason'].length > 0;

  // 1. Exactly one form.
  if (declaresControl === declaresNonDeactivatable) {
    throw new Error(
      `[contracts/modules] manifest "${id}" must declare exactly one activation ` +
        `form: either { settingCode, default } or { nonDeactivatable: true, reason }.`,
    );
  }

  // 2. An `_`-prefixed id is platform-internal by convention (`moduleIdRe`);
  //    this makes the convention enforceable.
  if (id.startsWith('_') && !declaresNonDeactivatable) {
    throw new Error(
      `[contracts/modules] manifest "${id}" is platform-internal (leading "_") ` +
        `and MUST declare activation as { nonDeactivatable: true, reason }.`,
    );
  }

  // 3. The control belongs to the declaring module. Adopting an existing
  //    ad-hoc control (FR-014) is allowed precisely because every such code
  //    — `blog.enabled`, `prompt_actions.enabled`, `ksef.integration.enabled` —
  //    already sits under its own module's namespace.
  if (declaresControl) {
    const code = block['settingCode'] as string;
    if (code !== id && !code.startsWith(`${id}.`)) {
      throw new Error(
        `[contracts/modules] manifest "${id}" declares activation setting ` +
          `"${code}", which is outside the module's own namespace ` +
          `("${id}" or "${id}.*").`,
      );
    }
  }
}

/**
 * The three `nonBindingDependencies` rules (D-44 §5).
 *
 * They sit beside the activation rules for the same reason: two of the three
 * are cross-field — one reads `dependencies` and `acknowledgedDependencies`,
 * one reads `kind` against `whenAbsent` — and the message has to name the
 * module the author is looking at.
 */
function assertNonBindingRules(m: ModuleManifest): void {
  const acknowledged = new Set(
    (m.acknowledgedDependencies ?? []).map((edge) => edge.moduleId),
  );
  for (const edge of m.nonBindingDependencies ?? []) {
    // 1. No self-edges. The array's element regex applies per element and
    //    cannot see the outer id, exactly as with `dependencies`.
    if (edge.moduleId === m.id) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares a non-binding dependency on ` +
          `itself (forbidden).`,
      );
    }
    // 2. One edge, one claim, in one place — the mirror of the
    //    `acknowledgedDependencies` rule above. A target declared in either of
    //    the other two arrays already carries the bind, so a withdrawal beside
    //    it is a second record of the same edge that nothing keeps in step.
    if (m.dependencies.includes(edge.moduleId)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares a non-binding dependency on ` +
          `"${edge.moduleId}", which it already declares in \`dependencies\` — that ` +
          `declaration already binds the operator, so drop one of the two.`,
      );
    }
    if (acknowledged.has(edge.moduleId)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares a non-binding dependency on ` +
          `"${edge.moduleId}", which it already acknowledges — an acknowledged edge is ` +
          `read by the refusal graph, so the two claims contradict each other.`,
      );
    }
    // 3. `whenAbsent` is the `degrades-without` kind's entire content: the
    //    behaviour the module promises and the sentence the platform screen
    //    renders. A `contributes-to` edge has no degradation to describe.
    if (edge.kind === 'degrades-without' && edge.whenAbsent === undefined) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares "${edge.moduleId}:${edge.name}" ` +
          `as \`degrades-without\` with no \`whenAbsent\` — the kind is a promise about ` +
          `behaviour and the sentence is what a reviewer and an off-state test hold it to.`,
      );
    }
    // 3a. And it is the whole of `refuses-without`, for a sharper reason: the
    //     outcome that kind produces is the one an undeclared gated port
    //     produces anyway, so the sentence is the only thing the declaration
    //     adds. Without it the entry classifies identically to no entry at
    //     all, and the operator's dialog falls back to a translated default
    //     that names no capability.
    if (edge.kind === 'refuses-without' && edge.whenAbsent === undefined) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares "${edge.moduleId}:${edge.name}" ` +
          `as \`refuses-without\` with no \`whenAbsent\` — the ledger classifies such an ` +
          `edge exactly as it classifies an undeclared one, so the sentence is the whole ` +
          `of what the declaration buys. Name what refuses, in the operator's words.`,
      );
    }
    if (edge.kind === 'contributes-to' && edge.whenAbsent !== undefined) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares "${edge.moduleId}:${edge.name}" ` +
          `as \`contributes-to\` with a \`whenAbsent\` — a push into an ungated registry ` +
          `degrades nothing, so either drop the sentence or the edge is a pull and the ` +
          `kind is \`degrades-without\`.`,
      );
    }
  }
}

/**
 * The `errorCodes` refusals (feature 090,
 * `contracts/error-code-declaration.md` §2, first layer).
 *
 * They live here rather than in the schema for the reason the activation rules
 * do: two of them are cross-element — a duplicate is a relationship between two
 * entries, which an element schema cannot see — and every message has to name
 * the module the author is looking at. All four fire on import, on the author's
 * machine, with no instance and no database.
 *
 * What this layer deliberately does **not** refuse is a code **another** module
 * declares. It sees one manifest and cannot see a second, so a partial refusal
 * here called "the collision rule" would be a green that means "not looking".
 * The collision rule is composition's (§3), and an in-repository collision is
 * refused before that, in CI.
 *
 * Nor does it refuse a code that is a member of `ERROR_CODES`. After feature
 * 090's migration every core module's declarations are members of it, so such a
 * rule would refuse the platform's own manifests; there is no origin field to
 * condition it on, and adding one would be a self-certified exemption issued by
 * the measured party.
 */
function assertErrorCodeRules(m: ModuleManifest): void {
  const seenCodes = new Set<string>();
  for (const declaration of m.errorCodes ?? []) {
    if (!errorCodeRe.test(declaration.code)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares error code ` +
          `"${declaration.code}", which is not SCREAMING_SNAKE_CASE ` +
          `(${String(errorCodeRe)}) — the code travels verbatim on the wire and ` +
          'is the tail of the `errors.<CODE>` key its sentence is written under.',
      );
    }
    if (seenCodes.has(declaration.code)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares error code ` +
          `"${declaration.code}" twice — one code has one owner and one sentence, ` +
          'so the second entry can only disagree with the first.',
      );
    }
    seenCodes.add(declaration.code);

    const seenTokens = new Set<string>();
    for (const token of declaration.tokens ?? []) {
      if (!errorCodeTokenRe.test(token)) {
        throw new Error(
          `[contracts/modules] manifest "${m.id}" declares refusal token "${token}" ` +
            `under "${declaration.code}", which does not match ${String(errorCodeTokenRe)} — ` +
            'the token is the tail of `errors.<CODE>.<token>` and a key that does not ' +
            'parse is a key nothing reads.',
        );
      }
      if (seenTokens.has(token)) {
        throw new Error(
          `[contracts/modules] manifest "${m.id}" declares refusal token "${token}" ` +
            `twice under "${declaration.code}" — one token is one sentence.`,
        );
      }
      seenTokens.add(token);
    }
  }
}

/**
 * The four block-declaration rules (feature 096,
 * `specs/096-page-builder-block-ownership/contracts/block-definition.md` §1).
 *
 * They live here rather than in the schema for the reason the activation rules
 * do: each is cross-field — one reads a block's `name` against the outer `id`,
 * one reads its `category` against the manifest's own `blockCategories`, one
 * reads those declarations against each other — and every message has to name
 * the module the author is looking at. They fire on
 * import, on the author's machine, with no instance and no database, which
 * matters more here than anywhere else in this file: a block name is written
 * into `jsonb` and never rewritten, so a wrong one caught in CI has already
 * been typed into a manifest, and one caught after a release is permanent.
 *
 * `check:block-names` re-derives rules 1–3 for a manifest built without this
 * helper — the same belt-and-braces `check-port-dependencies.ts` applies to
 * `nonBindingDependencies`.
 *
 * **What this layer cannot decide is anything about a second manifest**, and
 * the limit is the one `assertErrorCodeRules` states for itself. Two modules
 * declaring one block name is composition's question and the check's; two
 * modules declaring one `(key, context)` category is neither, because it is
 * **normal and merges** — `contracts/block-definition.md` §1.1 is the ruling,
 * the total order the merge resolves by and the two CI signals that hold
 * in-tree modules to agreeing. Nothing here restates it.
 *
 * Rule 2 is therefore enforced **within the declaring manifest**, and per
 * **context**: a block's category must be declared beside it, for every one of
 * the block's `contexts`. That is what FR-009 asks for — a contributor declares
 * the section in its own manifest instead of editing a shared map — and the
 * per-context reading is T107's correction to Phase 1, which shipped "at least
 * one". Under the weaker reading a block declared for `cms` and `email` whose
 * section exists only in `cms` is uninsertable in the e-mail palette with no
 * error anywhere, which is FR-009's silent-loss shape one level down.
 */
function assertBlockRules(m: ModuleManifest): void {
  // 4. One author, one section, one record. Judged first, and before any block
  //    is read: a block is judged *against* `blockCategories`, so measuring it
  //    against a set that contradicts itself reports the wrong defect. Unlike a
  //    cross-module duplicate — which is normal and merges (§1.1) — this one
  //    has a single author and is decidable where it is written.
  const declaredSections = new Set<string>();
  for (const category of m.blockCategories ?? []) {
    for (const context of category.contexts) {
      const pair = `${category.key}\u0000${context}`;
      if (declaredSections.has(pair)) {
        throw new Error(
          `[contracts/modules] manifest "${m.id}" declares the palette section ` +
            `"${category.key}" twice for context "${context}" — a section is one record, ` +
            'resolved as one record, so a manifest that states it twice has stated a ' +
            'title, a weight and a visibility for nobody to reconcile.',
        );
      }
      declaredSections.add(pair);
    }
  }

  for (const block of m.blocks ?? []) {
    // 0. The grammar, before anything reads a segment of it. A name with no
    //    separator has no owner segment to compare against `id`, so a message
    //    about ownership would be a message about the wrong thing. The schema
    //    refuses it too (`BlockDefinitionSchema`), and parses last; this is the
    //    copy that names the module, exactly as `assertErrorCodeRules` re-tests
    //    `errorCodeRe`.
    if (!blockNameRe.test(block.name)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares block "${block.name}", which is ` +
          `not a namespaced block name (${String(blockNameRe)}) — the name is persisted ` +
          'into `jsonb` and its owner segment is the only link between a stored node and ' +
          'the module that can render it.',
      );
    }

    // 1. One block, one owner, stated once. The owner is the name's first
    //    segment and there is no `ownerModule` field to disagree with it.
    const owner = block.name.slice(0, block.name.indexOf('.'));
    if (owner !== m.id) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares block "${block.name}", whose ` +
          `owner segment "${owner}" is not this module's id — a block has exactly one ` +
          'owner and the name is where that owner is stated, so declaring it here would ' +
          `make "${owner}" unable to own its own block.`,
      );
    }

    // 2. A block offered on no surface. Refused before the category, which
    //    cannot be judged without the contexts to judge it against.
    if (block.contexts.length === 0) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares block "${block.name}" with an ` +
          'empty `contexts` — a block offered on no surface appears in no palette, which ' +
          'is a declaration with no reader.',
      );
    }

    // 3. The category is a declared key, not free text, and it is declared for
    //    **every** one of the block's contexts (T107). The block's own order is
    //    what the message names, so an author fixing two missing contexts is
    //    sent to the first of them rather than to whichever the set iterated.
    const missingContext = block.contexts.find(
      (context) =>
        !(m.blockCategories ?? []).some(
          (category) =>
            category.key === block.category && category.contexts.includes(context),
        ),
    );
    if (missingContext !== undefined) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" declares block "${block.name}" in ` +
          `category "${block.category}", which this manifest does not declare in ` +
          `\`blockCategories\` for context "${missingContext}" — a block's section is ` +
          'declared beside it for every context the block is offered in, or the block ' +
          'is uninsertable in that palette with no error anywhere.',
      );
    }
  }
}

/**
 * Identity-with-validation helper for module authors. Modules export a
 * single `manifest` constant via this helper so TypeScript inference is
 * preserved and the loader can ingest the validated payload directly.
 */
export function defineModuleManifest(m: ModuleManifest): ModuleManifest {
  // Reject self-dependencies up front — Zod's array regex doesn't catch
  // this because the id field's regex applies independently per element.
  if (m.dependencies.includes(m.id)) {
    throw new Error(
      `[contracts/modules] manifest "${m.id}" depends on itself (forbidden).`,
    );
  }
  // Settings manifest's moduleCode must equal the outer id.
  if (m.settings && m.settings.moduleCode !== m.id) {
    throw new Error(
      `[contracts/modules] manifest "${m.id}" carries a settings ` +
        `manifest with moduleCode "${m.settings.moduleCode}" (must match).`,
    );
  }
  if (m.activation !== undefined) {
    assertActivationRules(m.id, m.activation);
  }
  for (const edge of m.acknowledgedDependencies ?? []) {
    if (edge.moduleId === m.id) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" acknowledges a dependency on ` +
          `itself (forbidden).`,
      );
    }
    // An acknowledged edge is a declaration that the ordinary one is
    // impossible. Where both are present the ordinary one already carries the
    // install order *and* the refusal, and the acknowledgement is a second
    // record of the same edge that nothing keeps in step.
    if (m.dependencies.includes(edge.moduleId)) {
      throw new Error(
        `[contracts/modules] manifest "${m.id}" acknowledges "${edge.moduleId}", ` +
          `which it already declares in \`dependencies\` — the acknowledgement is ` +
          `for edges that cannot be declared, so drop one of the two.`,
      );
    }
  }
  assertNonBindingRules(m);
  assertErrorCodeRules(m);
  assertBlockRules(m);
  return ModuleManifestSchema.parse(m);
}

// ---------------------------------------------------------------------------
// Lifecycle hook types (TypeScript-level only — no Zod schema)
// ---------------------------------------------------------------------------

/**
 * Logger surface a hook may use. Implementations attach the module id as a
 * tag at the orchestrator level so the hook author writes plain messages.
 *
 * **This is not `ctx.log`.** It is the logger of the three surfaces below — the
 * install/uninstall hook context and the two lifecycle-participant events — all
 * of which the orchestrator calls, and it takes a message and nothing else.
 * `ModuleContext.log`, which a module writes to from `registerModule`, is a
 * `PlatformLogger` (`@endora-commerce/platform/kernel`) and takes a bound object
 * first: `ctx.log.info({ orderId }, 'message')`.
 *
 * The two used to share this name, which is how a scaffolded module came to
 * call `ctx.log.info('…')` with one argument against a two-argument type. Keep
 * the shapes' names apart; they are not interchangeable in either direction.
 */
export interface ModuleLifecycleLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * Context passed to install/uninstall hooks. The orchestrator owns the
 * lifetime of every field — hooks MUST use the provided `em` rather than
 * forking their own, so writes participate in the same transaction.
 */
export interface ModuleLifecycleContext<EM = unknown, Redis = unknown> {
  em: EM;
  redis: Redis;
  log: ModuleLifecycleLogger;
  module: { id: string; version: string };
}

export type ModuleInstallHook<EM = unknown, Redis = unknown> = (
  ctx: ModuleLifecycleContext<EM, Redis>,
) => Promise<void>;

export type ModuleUninstallHook<EM = unknown, Redis = unknown> = (
  ctx: ModuleLifecycleContext<EM, Redis> & { hard: boolean },
) => Promise<void>;

// ---------------------------------------------------------------------------
// Lifecycle participants (feature 080, T036a / D-159)
// ---------------------------------------------------------------------------

/**
 * What a participant is told when **another** module is installed.
 *
 * `moduleId` is the module the operator asked to install, never the
 * participant's own — that is the whole difference between this and an install
 * hook, and it is why a participant could not be one. An install hook answers
 * *"my module is arriving"*; a participant answers *"a module is arriving and I
 * keep a projection of every module".*
 */
export interface ModuleInstalledEvent<EM = unknown> {
  /** The module being installed. */
  moduleId: string;
  /** That module's manifest, already validated. */
  manifest: ModuleManifest;
  /**
   * The directory holding that module's manifest file — what a participant
   * that reads the module's own files off disk (bundles, templates) joins its
   * relative directory onto.
   */
  modulePath: string;
  /**
   * The orchestrator's EntityManager. A participant MUST write through it
   * rather than forking its own, so its rows join the operation the orchestrator
   * is performing instead of committing beside it.
   */
  em: EM;
  log: ModuleLifecycleLogger;
}

/**
 * What a participant is told when another module is **hard**-uninstalled.
 *
 * A soft uninstall never reaches a participant: soft preserves the module's
 * data so a re-install picks it up unchanged, and a projection of the manifest
 * is data on those terms.
 */
export interface ModuleHardUninstalledEvent<EM = unknown> {
  /** The module being removed. */
  moduleId: string;
  /**
   * That module's manifest, or `null` when the registry holds a row for a
   * module whose manifest is no longer on this instance — an orphan. Removing a
   * projection is exactly the case that must still work then, so the manifest
   * is nullable here and not on the install side.
   */
  manifest: ModuleManifest | null;
  /** The orchestrator's EntityManager — see {@link ModuleInstalledEvent.em}. */
  em: EM;
  log: ModuleLifecycleLogger;
}

/**
 * A module's declared interest in **every other module's** lifecycle.
 *
 * Two modules keep a table that projects what the manifests declare — `_i18n`
 * projects `manifest.i18n` into `translation_bundles`, `admin_actions` projects
 * `manifest.actions` into `module_actions` — and both projections have to move
 * when *any* module is installed or hard-uninstalled. That is not an install
 * hook (which fires for its own module) and it cannot be a port (the lifecycle
 * orchestrator serves a platform command, which composes no container to
 * resolve one from). It is a third export of `manifest.ts`, walked by the same
 * generator, so it reaches core, overlay and an installed package on identical
 * terms.
 *
 * **Both methods are required**, deliberately. Feature detection through an
 * optional method is what D-97.3 refuses on a published port, and the reason
 * carries here: a participant with nothing to do on one edge writes an empty
 * body, which is a decision a reader can see, while an omitted method is
 * indistinguishable from one somebody forgot.
 *
 * Keep the implementation in `manifest.ts` **light** — `await import()` the
 * service the body needs. The generated manifest index is imported by the check
 * scripts and by `src/db/configured-migrations.ts`, so a participant that
 * statically imported an ORM-dependent service graph would pull it into every
 * one of them.
 */
export interface ModuleLifecycleParticipant<EM = unknown> {
  /**
   * Runs after the installed module's settings are reconciled and before its
   * own install hook. A throw aborts the install and reverts its migrations,
   * which is the property FR-016 rests on: an operator installing a module with
   * an unreadable bundle is told while they can still choose not to install it.
   */
  onModuleInstalled(event: ModuleInstalledEvent<EM>): Promise<void>;
  /** Runs on `uninstall --hard` only. */
  onModuleHardUninstalled(event: ModuleHardUninstalledEvent<EM>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Module CLI commands (feature 080, T042b / D-160.9)
// ---------------------------------------------------------------------------

/**
 * The shape a command's name has to take: lowercase, hyphen-separated.
 *
 * A command is addressed as `<module id> <command name>` on the host's argv, so
 * the name shares the module id's alphabet minus the underscore — an operator
 * types `carts abandonment-sweep`, and `check:naming`'s route-segment rule is
 * the same shape for the same reason. The host validates against this rather
 * than accepting whatever a package declared: a name with a space in it is
 * unaddressable, and a name that differs from the one printed by `--list` is
 * worse than one that is refused.
 */
export const MODULE_CLI_COMMAND_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * What a command handler is given.
 *
 * `ctx` is the module's own `ModuleContext` — a kernel type this package
 * deliberately does not import, so it arrives through the generic exactly as an
 * `EntityManager` does on the lifecycle hooks above. A handler resolves what it
 * needs from it with
 * `lazyPort<T>(ctx, 'literalName')`, character-for-character what `backend.ts`
 * writes, which is what keeps `check:port-dependencies` able to see the edge. A
 * cradle read would be invisible to it.
 *
 * `out` and `err` are the command's interface, injected rather than reached for:
 * a handler that writes to `process.stdout` directly cannot be driven from a
 * test without capturing the process's streams, and the host is the one place
 * that knows whether this invocation has a terminal.
 */
export interface ModuleCliCommandContext<Ctx = unknown> {
  /** The module's own composed `ModuleContext`. */
  ctx: Ctx;
  /** Everything the operator typed after `<module id> <command name>`. */
  argv: readonly string[];
  /** One line of human-readable output. The host adds the newline. */
  out(line: string): void;
  /** One line of diagnostics. The host adds the newline. */
  err(line: string): void;
}

/**
 * An operator command a module declares and **the host runs** (D-160.9).
 *
 * Checked against Magento 2, which is this repository's module benchmark: a
 * Magento module ships a command class plus a declaration in its `di.xml` under
 * `CommandListInterface`, and `bin/magento` — the host binary — bootstraps the
 * application and constructs each command with its dependencies injected. The
 * module never bootstraps the host. That is one-to-one with what D-157.8 had
 * already ruled here: the command is declared where `installHook` is declared,
 * an export of the module's `manifest.ts`, picked up by the same tree walk, and
 * one shape covers core, overlay and package.
 *
 * A package could not do it any other way. A file under `node_modules` can name
 * no specifier that resolves to the instance's `backend/src/composition.ts`, and
 * a core script that names it creates a module → root → module cycle. So the
 * invocation inverts: the host composes once and calls the module.
 *
 * **It is not a Command Bus Command** (Constitution XIII), and the field is
 * spelled `cliCommands` rather than `commands` so that the two cannot be read
 * for one another — `backend/src/commands/` and every module's own `commands/`
 * directory already hold the audited domain writes. A CLI command that performs
 * a domain write runs one of those, resolved from `ctx`, exactly as a route
 * handler does.
 *
 * Keep the declaration in `manifest.ts` **light**, for the reason
 * {@link ModuleLifecycleParticipant} gives: the generated manifest index is
 * imported by the check scripts and by `src/db/configured-migrations.ts`, so
 * `run` should `await import()` the file that holds the body rather than
 * pulling a service graph into all of them.
 */
export interface ModuleCliCommand<Ctx = unknown> {
  /** Unique within the module. Must match {@link MODULE_CLI_COMMAND_NAME_RE}. */
  name: string;
  /** One line, printed by the host's `--list`. Written for an operator. */
  summary: string;
  /**
   * The full usage text, printed by the host for `--help`.
   *
   * A **data property**, not a method, and answered by the host **before it
   * composes**: `--list` and `--help` are questions about the declaration, and
   * a tool has to be able to say what it does before it can do it. D-102 made
   * that a condition rather than a nicety for `audit_logs read` — its credential
   * is host access, not a working connection string — and the same property is
   * why D-157.8 rejected path-convention dispatch, which *"nothing can list …
   * for `--help`"*.
   *
   * Omit it and the host prints {@link summary}. An optional *data* property is
   * outside what D-97.3 refuses: that rule is about optional **methods** on a
   * published port, where `lazyPort`'s proxy makes feature detection impossible
   * by construction.
   */
  help?: string;
  /**
   * The body. Returns the process exit code — `0` for success, non-zero for a
   * failure the command itself detected (bad argv, a strict-mode violation).
   *
   * Required to return one rather than `void`: a command that means "1" and
   * returns nothing is indistinguishable from one that succeeded, and the shell
   * that runs it in a deploy hook reads only the code.
   *
   * A throw is the other failure channel and needs no handling here: the host
   * reports it and exits non-zero. In particular a command must **not** wrap a
   * port call in a `catch` — that swallows `ModuleDisabledError` and turns
   * fail-closed into fail-open (`check:port-catches`).
   */
  run(context: ModuleCliCommandContext<Ctx>): Promise<number>;
}

// ---------------------------------------------------------------------------
// Recent-activity eligibility (feature 080, T042j / D-163.1)
// ---------------------------------------------------------------------------

/**
 * The shape an audit action token has: `<object>.<verb>`, both snake_case.
 *
 * `product.create`, `stock_level.bulk_import`, `prompt_action.execute`. It is
 * the value stored in `audit_log_entries.action`, and it is matched here rather
 * than accepted as any string because the declaration is the *only* thing that
 * puts a token into the dashboard query's `$in` — a typo used to be caught by a
 * reviewer reading a hand-written array, and there is no array to read now.
 *
 * naming:allow-snake-case — the token is persisted verbatim in
 * `audit_log_entries.action` and is written by `Command.action`, so this is the
 * existing wire value rather than a new API field.
 */
export const auditActionRe = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

/**
 * One audit action a module offers to the admin home dashboard's
 * recent-activity card.
 *
 * `labelKey` is **relative to the declaring module's i18n namespace**, exactly
 * as a command-palette action's `labelKey` is: the module ships
 * `activity.verb.product.create` in its own `i18n/en.json` and `pl.json`, the
 * card resolves it as `t('<moduleId>', '<labelKey>')`. That is what lets a
 * third-party package render a verb in the operator's language without the host
 * shipping a string for it.
 *
 * `icon` comes from {@link KnownIconNameSchema}, so the admin maps it through
 * the one `icon-map.ts` it already has and a package cannot name a component
 * the SPA does not bundle.
 */
export const RecentActivityEntrySchema = z.object({
  /** The `audit_log_entries.action` token, e.g. `product.create`. */
  action: z.string().regex(auditActionRe),
  icon: KnownIconNameSchema,
  /** Module-namespace-relative i18n key for the verb, e.g. `activity.verb.product.create`. */
  labelKey: z.string().min(1).max(255),
});
export type RecentActivityEntry = z.infer<typeof RecentActivityEntrySchema>;

/**
 * A module's declaration that its activity is **eligible** for the dashboard's
 * recent-activity card — D-163.1, the first of the ruling's two axes.
 *
 * It is a declaration and not a decision. Whether a declared module's rows
 * actually appear is the operator's, held in
 * {@link recentActivityVisibilitySettingCode}'s Setting and defaulting to
 * visible — Constitution XVII's two-axis shape applied to a narrower object.
 * Neither axis overwrites the other: a module author cannot put entries on
 * somebody's home screen by fiat, and an operator cannot be surprised by a card
 * they did not configure.
 *
 * It replaces four hand-maintained tables that had already drifted apart inside
 * core (D-163): the server allow-list that filtered the dashboard query, the
 * action → module prefix map, the route's `module` enum and the admin's
 * `ACTIVITY_RENDERING`. Every one of them is derived from this now, so a
 * package's row reaches the card and a fifth hand-written entry has nowhere to
 * be written.
 *
 * Declared as an export of `manifest.ts` beside `installHook`,
 * `lifecycleParticipant` and `cliCommands`, walked by the same generator, so
 * core, overlay and an installed package declare one on identical terms.
 */
export const ModuleRecentActivitySchema = z.object({
  entries: z.array(RecentActivityEntrySchema).min(1),
});
export type ModuleRecentActivity = z.infer<typeof ModuleRecentActivitySchema>;

/**
 * Identity-with-validation helper for module authors, the twin of
 * {@link defineModuleManifest}.
 */
export function defineModuleRecentActivity(
  declaration: ModuleRecentActivity,
): ModuleRecentActivity {
  return ModuleRecentActivitySchema.parse(declaration);
}

/** The suffix every recent-activity visibility Setting code ends in. */
export const RECENT_ACTIVITY_VISIBILITY_SETTING_SUFFIX = 'recent_activity_visible';

/**
 * Raised when a module's id cannot carry a Setting code — see
 * {@link recentActivityVisibilitySettingCode}.
 */
export class RecentActivitySettingCodeInvalid extends Error {
  override readonly name = 'RecentActivitySettingCodeInvalid';
}

/**
 * The Setting that holds the operator's choice for one declaring module.
 *
 * **Derived, never declared.** `activation.settingCode` is declared because a
 * module that already shipped an ad-hoc control had to be able to adopt it;
 * there is no such history here, and a declared code would be a fifth place a
 * module could disagree with the platform about its own name. D-163.1 also
 * fixes the default — visible — so there is nothing else for a declaration to
 * carry.
 */
export function recentActivityVisibilitySettingCode(moduleId: string): string {
  const code = `${moduleId}.${RECENT_ACTIVITY_VISIBILITY_SETTING_SUFFIX}`;
  if (!settingCodeRe.test(code)) {
    throw new RecentActivitySettingCodeInvalid(
      `[contracts/modules] module "${moduleId}" declares recent-activity eligibility, but ` +
        `"${code}" is not a valid setting code. A platform-internal module id (leading ` +
        `underscore) cannot own one; the card is for a domain module's activity.`,
    );
  }
  return code;
}

/**
 * The settings manifest the platform reconciles for a module, which is the
 * module's own declaration plus the one Setting its recent-activity eligibility
 * implies.
 *
 * Two callers and one derivation, deliberately (D-100): the boot reconcile
 * walks every shipped module's settings, and the lifecycle orchestrator's
 * `install` reconciles exactly the arriving module's. A package has only the
 * second — since D-157.6(b) `install` is its sole author — so a second copy of
 * this merge would mean a packaged module's control existing on one path and
 * not the other.
 *
 * Returns `undefined` when the module declares neither, so a caller can keep
 * treating "no settings" as an absent value.
 */
export function settingsManifestWithRecentActivity(
  manifest: ModuleManifest,
  recentActivity: ModuleRecentActivity | undefined,
): ModuleSettingsManifest | undefined {
  if (!recentActivity) return manifest.settings;
  const entry: SettingManifestEntry = {
    code: recentActivityVisibilitySettingCode(manifest.id),
    name: `${manifest.name}: show activity on the dashboard`,
    description:
      `Whether ${manifest.name}'s entries appear on the admin home dashboard's Recent ` +
      'Activity card. Switching it off hides them from that card only — the audit trail ' +
      'itself is unchanged and the entries stay on the audit-log screen.',
    valueType: 'boolean',
    defaultValue: true,
    // Managed on /platform/modules beside the module's activation control, the
    // surface an operator already uses for exactly this kind of choice. A
    // second control on the generic Settings screen would be two doors onto one
    // decision.
    hidden: true,
    ...(manifest.settings?.groups[0]?.code
      ? { groupCode: manifest.settings.groups[0].code }
      : {}),
  };
  if (!manifest.settings) {
    return {
      moduleCode: manifest.id,
      groups: [{ code: manifest.id, name: manifest.name }],
      settings: [{ ...entry, groupCode: manifest.id }],
    };
  }
  if (manifest.settings.settings.some((s) => s.code === entry.code)) {
    return manifest.settings;
  }
  return {
    ...manifest.settings,
    settings: [...manifest.settings.settings, entry],
  };
}

/**
 * The two properties of a module-registry entry the boot settings reconcile
 * reads — see {@link SettingsManifestCollectionPort}.
 */
export interface SettingsManifestSource {
  readonly manifest: ModuleManifest;
  /**
   * The module's recent-activity eligibility (feature 080, T042j / D-163.1).
   * It implies one Setting — the operator's choice of whether this module's
   * entries reach the dashboard card — which is derived rather than declared,
   * so a module that adds the eligibility export gets the control with it.
   */
  readonly recentActivity?: ModuleRecentActivity | undefined;
}

/**
 * Container name: `settingsManifestCollectionPort`. Owner: `settings`.
 *
 * The boot-time reconcile's input list, assembled from the module registry the
 * caller hands in.
 *
 * **Two owners, one list, and that is why this is a port.** Which modules a
 * deployment ships is a composition-root input — core plus this deployment's
 * overlay modules, never an installed package — so the registry arrives as an
 * argument. How that registry becomes a reconcile list is `settings`' own rule:
 * the settings module's manifest goes first, because every other manifest's
 * entries fall back to its `general` group and the group has to exist before
 * they are inserted, and each module code appears exactly once. A root that
 * imported the derivation would be a root that has to be edited when the rule
 * changes, and there are two of them.
 *
 * Nothing is gated on the module axis here on purpose: a module that is
 * switched off keeps its settings rows and keeps its group on `/settings`,
 * because a deactivation is not an uninstall (Constitution XVII) and the
 * operator has to be able to switch it back on.
 *
 * **Owner off:** the seam fails closed — resolving this port throws
 * `ModuleDisabledError`. It is resolved once, at boot, where a throw ends the
 * process rather than answering a request, which is the ruled-correct
 * behaviour for a composition that cannot be what the code says it is. Whether
 * `settings` has an off state at all is its manifest's `activation` to say, not
 * this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface SettingsManifestCollectionPort {
  collect(registry: ReadonlyArray<SettingsManifestSource>): ModuleSettingsManifest[];
}

/** Aggregate of what a module's `manifest.ts` may export at runtime. */
export interface ModuleManifestExports<EM = unknown, Redis = unknown, Ctx = unknown> {
  manifest: ModuleManifest;
  installHook?: ModuleInstallHook<EM, Redis>;
  uninstallHook?: ModuleUninstallHook<EM, Redis>;
  /**
   * This module's interest in every *other* module's lifecycle — see
   * {@link ModuleLifecycleParticipant}. Additive and optional: the modules that
   * declare one are the two that keep a projection of the manifest set, and
   * every other module's `manifest.ts` is unchanged.
   */
  lifecycleParticipant?: ModuleLifecycleParticipant<EM>;
  /**
   * The operator commands this module declares — see {@link ModuleCliCommand}.
   * Additive and optional: a module with no operator command exports nothing
   * and is unchanged.
   */
  cliCommands?: readonly ModuleCliCommand<Ctx>[];
  /**
   * This module's declaration that its activity is eligible for the admin home
   * dashboard's recent-activity card — see {@link ModuleRecentActivitySchema}.
   * Additive and optional: a module that declares none contributes no token,
   * owns no visibility Setting and is unchanged.
   */
  recentActivity?: ModuleRecentActivity;
}

// ---------------------------------------------------------------------------
// Registry record
// ---------------------------------------------------------------------------

export const RegistryStateSchema = z.enum([
  'installing',
  'installed',
  'disabled',
  'uninstalled',
]);
export type RegistryState = z.infer<typeof RegistryStateSchema>;

/** Persisted shape of a row in `module_registrations` (admin HTTP DTO). */
export const ModuleRegistryRecordSchema = z.object({
  moduleId: z.string().regex(moduleIdRe),
  state: RegistryStateSchema,
  version: z.string(),
  installedAt: z.iso.datetime(),
  lastStateChangeAt: z.iso.datetime(),
  lastInstallFailedAt: z.iso.datetime().nullable(),
  lastInstallError: z.string().nullable(),
});
export type ModuleRegistryRecord = z.infer<typeof ModuleRegistryRecordSchema>;

// ---------------------------------------------------------------------------
// Admin HTTP — `GET /api/v1/admin/modules` response shape
// ---------------------------------------------------------------------------

export const ModuleListItemFlagSchema = z.enum([
  'orphan',
  'pending-upgrade',
  'dep-missing',
  'dep-disabled',
]);
export type ModuleListItemFlag = z.infer<typeof ModuleListItemFlagSchema>;

export const ModuleListItemStateSchema = z.enum([
  'installing',
  'installed',
  'disabled',
  'uninstalled',
  'not-installed',
]);

export const ModuleListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  version: z.object({
    registered: z.string().nullable(),
    onDisk: z.string().nullable(),
  }),
  state: ModuleListItemStateSchema,
  dependencies: z.array(z.string()),
  flags: z.array(ModuleListItemFlagSchema),
  license: ModuleLicenseTierSchema.nullable(),
  installedAt: z.iso.datetime().nullable(),
  lastStateChangeAt: z.iso.datetime().nullable(),
});
export type ModuleListItem = z.infer<typeof ModuleListItemSchema>;

export const ModuleListResponseSchema = z.object({
  modules: z.array(ModuleListItemSchema),
});
export type ModuleListResponse = z.infer<typeof ModuleListResponseSchema>;

export const ModuleListQuerySchema = z.object({
  state: z
    .enum(['installing', 'installed', 'disabled', 'uninstalled'])
    .optional(),
  flag: z.enum(['orphan', 'pending-upgrade']).optional(),
});
export type ModuleListQuery = z.infer<typeof ModuleListQuerySchema>;

// ---------------------------------------------------------------------------
// Feature 073 — module presence projections
// ---------------------------------------------------------------------------

/**
 * One module's presence as the server computed it. `present` is the
 * conjunction of the two axes, precomputed server-side: neither frontend
 * recombines them, which is what makes "off means absent" one decision rather
 * than two implementations that can disagree.
 *
 * The axes stay separately visible because Constitution XVII requires the
 * Admin UI to render them differently — *installed but switched off* shows an
 * actionable control, *not available at platform level* shows absent or
 * blocked-with-a-reason.
 */
export const ModulePresenceSchema = z.object({
  id: z.string().regex(moduleIdRe),
  /** platformAvailable && operatorActivated. */
  present: z.boolean(),
  platformState: RegistryStateSchema.or(z.literal('not-installed')),
  /** The operator axis alone. */
  activated: z.boolean(),
  deactivatable: z.boolean(),
  /** The module's own declared reason, rendered next to the locked control. */
  nonDeactivatableReason: z.string().nullable(),
});
export type ModulePresence = z.infer<typeof ModulePresenceSchema>;

/** `GET /api/v1/admin/module-presence` — every admin, no permission code. */
export const AdminModulePresenceResponseSchema = z.object({
  modules: z.array(ModulePresenceSchema),
  /**
   * The serving process is TTL-refreshing from PostgreSQL because its pub/sub
   * link is unhealthy, so this projection may lag a flip made elsewhere by up
   * to `FALLBACK_TTL_MS`. Reported rather than hidden: the platform screen has
   * to be able to say "this is stale" instead of quietly showing an operator a
   * state that is no longer true.
   */
  degraded: z.boolean(),
});
export type AdminModulePresenceResponse = z.infer<
  typeof AdminModulePresenceResponseSchema
>;

/** The storefront needs no axis detail — only whether to render at all. */
export const StorefrontModulePresenceSchema = z.object({
  id: z.string().regex(moduleIdRe),
  present: z.boolean(),
});
export type StorefrontModulePresence = z.infer<
  typeof StorefrontModulePresenceSchema
>;

/** `GET /api/v1/storefront/module-presence` — public, tag `modules:presence`. */
export const StorefrontModulePresenceResponseSchema = z.object({
  modules: z.array(StorefrontModulePresenceSchema),
});
export type StorefrontModulePresenceResponse = z.infer<
  typeof StorefrontModulePresenceResponseSchema
>;

/**
 * `POST /api/v1/admin/modules/:id/activation` — the operator axis, and the
 * only door to it. The ordinary settings write path refuses an activation
 * code, so this endpoint's audited Command is where every flip is recorded.
 */
export const ModuleActivationRequestSchema = z.object({
  active: z.boolean(),
});
export type ModuleActivationRequest = z.infer<typeof ModuleActivationRequestSchema>;

/** The module's presence *after* the flip, so no client recomputes it. */
export const ModuleActivationResponseSchema = z.object({
  module: ModulePresenceSchema,
});
export type ModuleActivationResponse = z.infer<typeof ModuleActivationResponseSchema>;

/**
 * `GET /api/v1/admin/modules/:id/deactivation-impact` — the live half of the
 * confirmation an operator is shown before switching a module off.
 *
 * Feature 074's consequence rows are **static**: one sentence per present
 * dependent, taken from that dependent's `whenAbsent` declaration, so the
 * dialog can be rendered from the ledger with no database read. This response
 * carries the facts that only a live read can answer, and today there is
 * exactly one — how many people hold a second factor (the owner's ruling on
 * D-96.5).
 *
 * Three properties of the shape, each deliberate:
 *
 *  - **Named after the fact, not after the module.** `mfa` owns the table and
 *    answers the question through a port; the wire shape says what the number
 *    means. When a second module needs a live datum this becomes a list — one
 *    entry per fact — which is a change to make when there are two, not now
 *    (Constitution IV).
 *  - **Nullable, always.** `null` means "not available", not "zero": the module
 *    is already off, or the read failed. A count that cannot be fetched must
 *    never stop an operator switching a module off, so the caller renders the
 *    rest of the dialog and says the number is unavailable.
 *  - **Read while the module is still on.** The dialog precedes the flip, so
 *    the gate on the owning port is open when the question is asked. That is
 *    what makes a live count implementable at all — see `MfaEnrolmentCountPort`.
 */
export const ModuleDeactivationImpactSchema = z.object({
  moduleId: z.string().regex(moduleIdRe),
  /** Subjects with an active second factor; `null` when unavailable. */
  activeSecondFactorUsers: z
    .object({
      admins: z.number().int().nonnegative(),
      customers: z.number().int().nonnegative(),
    })
    .nullable(),
});
export type ModuleDeactivationImpact = z.infer<typeof ModuleDeactivationImpactSchema>;

// ---- Feature 060 — API interceptor diagnostics (read-only admin) ----------

/**
 * One row of the interceptor execution plan served by
 * `GET /api/v1/admin/api-interceptors`. Items are sorted in execution order:
 * target, then phase (pre before post), then order + (module, id) tie-break.
 */
export const apiInterceptorEntrySchema = z.object({
  /** Endpoint identity, e.g. `POST /api/v1/orders`. */
  target: z.string(),
  phase: z.enum(['pre', 'post']),
  order: z.number().int(),
  /** Owning module id — execution is lifecycle-gated on this module. */
  module: z.string(),
  /** Interceptor id, unique within the module. */
  id: z.string(),
  /** Live enabled state of the owning module at request time. */
  moduleEnabled: z.boolean(),
});
export type ApiInterceptorEntry = z.infer<typeof apiInterceptorEntrySchema>;

export const apiInterceptorListSchema = z.object({
  items: z.array(apiInterceptorEntrySchema),
});
export type ApiInterceptorList = z.infer<typeof apiInterceptorListSchema>;

// ---------------------------------------------------------------------------
// --- no port over the module manifests -------------------------------------
//
// **Which modules a deployment ships is a composition-root input, not a
// module's port** (D-98.5). `ModuleManifestReadPort` stood here unprovided and
// is deleted: the root builds the resolved registry and passes it *into* the
// lifecycle orchestrator, so a `_lifecycle`-owned port over that value would
// make the orchestrator's own input come out of the orchestrator. `_lifecycle`
// owns what it adds — the dependency graph, the install hooks, the registry
// rows, the operator surface — not the list. The gate could not close either:
// `_lifecycle` is non-deactivatable, and a `providePort`'s one distinguishing
// property over a plain registration is the 503 at the seam.
//
// The four modules that read manifests — `_i18n`, `admin_actions`,
// `admin_roles`, `settings` — take `resolvedModuleRegistry` as a root-supplied
// value and each declares the narrow view it needs. That is the rule this
// settles: **aggregate reads build catalogues; targeted reads are refused.** A
// `get(moduleId)` would let any module read any other module's permissions,
// settings, palette actions and `activation` declaration and branch on them —
// a question with no declared edge, no gate and no ledger row. Presence
// questions go through `effectiveState`; capability questions go through a
// port the neighbour publishes.
// ---------------------------------------------------------------------------
