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

export const ModuleManifestSchema = z.object({
  id: z.string().regex(moduleIdRe),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  version: z.string().regex(moduleVersionRe),
  dependencies: z.array(z.string().regex(moduleIdRe)).default([]),
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
