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
import { ModuleSettingsManifestSchema, settingCodeRe } from './settings.js';
import { ModuleActionsManifestSchema } from './admin-actions.js';
import { modulePermissionDeclarationSchema } from './admin.js';
import { transactionalEmailManifestEntrySchema } from './transactional-emails.js';

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
 * The two kinds are the two ways an edge can exist without the bind bit:
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
  kind: z.enum(['contributes-to', 'degrades-without']),
  /** `degrades-without` only: what stops working. Rendered beside the control. */
  whenAbsent: z.string().min(1).max(200).optional(),
  reason: z.string().min(1).max(800),
});
export type ModuleNonBindingDependency = z.infer<
  typeof ModuleNonBindingDependencySchema
>;

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
  return ModuleManifestSchema.parse(m);
}

// ---------------------------------------------------------------------------
// Lifecycle hook types (TypeScript-level only — no Zod schema)
// ---------------------------------------------------------------------------

/**
 * Logger surface a hook may use. Implementations attach the module id as a
 * tag at the orchestrator level so the hook author writes plain messages.
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

/** Aggregate of what a module's `manifest.ts` may export at runtime. */
export interface ModuleManifestExports<EM = unknown, Redis = unknown> {
  manifest: ModuleManifest;
  installHook?: ModuleInstallHook<EM, Redis>;
  uninstallHook?: ModuleUninstallHook<EM, Redis>;
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
// --- ports -----------------------------------------------------------------
//
// The in-process surface `_lifecycle` publishes to the four modules that read
// its registry (feature 075, Phase P) — `_i18n`, `admin_actions`,
// `admin_roles` and `settings`.
//
// **What is published is the manifests, not the registry.** `_lifecycle`'s own
// `LoadedManifestRegistry` carries a `ModuleDepGraph` and a map of entries
// holding `installHook` / `uninstallHook`, whose context takes an
// `EntityManager` — none of which can appear in a signature here (FR-034), and
// none of which any consumer reads. All four want the same thing: the
// manifests, by module id. `_i18n` reconciles i18n bundles from them,
// `admin_actions` builds the palette, `admin_roles` collects permission codes,
// `settings` derives the settings catalogue.
//
// The graph and the hooks stay internal, which is where they belong: they are
// how the lifecycle installs and orders modules, and a module reading either
// would be a module reasoning about its own installation.
// ---------------------------------------------------------------------------

/** One registered module's manifest, with the id it is registered under. */
export interface RegisteredModuleManifest {
  moduleId: string;
  manifest: ModuleManifest;
}

/**
 * Container name: `moduleManifestReadPort`. Owner: `_lifecycle`.
 *
 * **Nothing registers that name today, and a consumer must not resolve it.** The
 * four modules that read the manifests read `resolvedModuleRegistry`, a
 * composition-root contribution on `PLATFORM_OWNED_NAMES`
 * (`backend/scripts/check-port-dependencies.ts`), whose reason is that "which
 * modules a deployment ships is not something a module may decide". So this
 * interface proposes moving a platform-owned input into a module-owned
 * registration, against a standing ruling; whether it is implemented or deleted
 * is Q2 of the Phase-P unreached-port audit
 * (`specs/075-cross-module-decoupling-sweep/unreached-port-audit.md`, A4) and is
 * not answered here. `check:port-shape` carries it as the single entry of
 * `PORTS_WITHOUT_A_REGISTRATION`, so the debt is loud and cannot go stale
 * quietly — a registration appearing under this name fails the check as a stale
 * entry.
 *
 * Reads the **resolved** registry — core manifests plus the active
 * deployment's overlay modules — so an overlay module's permissions, palette
 * actions, settings and i18n bundles are seen exactly as a core module's are.
 *
 * Deliberately **not** filtered by effective state. Every consumer here is
 * building a catalogue that must list a switched-off module in order to
 * describe it: `/platform/modules` renders the activation control of a module
 * that is off, and `/admin-roles` must keep granting a permission whose module
 * an operator may switch back on. Filtering here would make a deactivation
 * look like an uninstall, which Constitution XVII says it is not.
 */
export interface ModuleManifestReadPort {
  list(): readonly RegisteredModuleManifest[];
  get(moduleId: string): ModuleManifest | undefined;
}
