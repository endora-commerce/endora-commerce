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
import { ModuleSettingsManifestSchema } from './settings.js';

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

export const ModuleManifestSchema = z.object({
  id: z.string().regex(moduleIdRe),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  version: z.string().regex(moduleVersionRe),
  dependencies: z.array(z.string().regex(moduleIdRe)).default([]),
  license: ModuleLicenseTierSchema.optional(),
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
});
export type ModuleManifest = z.infer<typeof ModuleManifestSchema>;

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
