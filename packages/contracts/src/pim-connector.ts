// Shared PIM connector vocabulary — feature 089 (`pim_connector` package).
// UnoPim-specific HTTP shapes live in `pim-unopim.ts`.

import { z } from 'zod';

export const pimImportRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'completed_with_issues',
  'failed',
  'skipped',
]);
export type PimImportRunStatus = z.infer<typeof pimImportRunStatusSchema>;

export const pimImportTriggerSchema = z.enum(['manual', 'scheduled', 'push']);
export type PimImportTrigger = z.infer<typeof pimImportTriggerSchema>;

export const pimImportModeSchema = z.enum(['delta', 'full']);
export type PimImportMode = z.infer<typeof pimImportModeSchema>;

export const pimImportIssueSeveritySchema = z.enum(['info', 'warning', 'error']);
export type PimImportIssueSeverity = z.infer<typeof pimImportIssueSeveritySchema>;

export const pimImportCountsSchema = z.object({
  considered: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  withdrawn: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  protected: z.number().int().nonnegative().optional(),
});
export type PimImportCounts = z.infer<typeof pimImportCountsSchema>;

/** Canonical field-protection path grammar (shared across PIM connectors). */
export const pimFieldPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(
    /^(attribute\.[a-z][a-z0-9_]*(\.[a-z]{2}(_[A-Z]{2})?)?(\.[0-9a-f-]{36}(\.[a-z]{2}(_[A-Z]{2})?)?)?|seo\.(metaTitle|metaDescription|metaKeywords)(\.[a-z]{2}(_[A-Z]{2})?)?|gallery\.\d+|attachment\.[0-9a-f-]{36}|price\.[0-9a-f-]{36}\.[A-Z]{3}|category\.[0-9a-f-]{36}|name(\.[a-z]{2}(_[A-Z]{2})?)?|description(\.[a-z]{2}(_[A-Z]{2})?)?)$/,
  );
export type PimFieldPath = z.infer<typeof pimFieldPathSchema>;

export const PIM_CONNECTOR_REGISTRY_PORT = 'pimConnectorRegistryPort' as const;

/**
 * Container name: `pimConnectorRegistryPort`. Owner: `pim_connector`.
 *
 * Mutual-exclusion registry — see
 * `specs/089-unopim-pim-sync/contracts/pim-connector-shared.md`. The name is
 * the whole of the promise this port makes (D-98.2): `lazyPort<T>` asserts `T`
 * and compares it to nothing that is registered, so a consumer copying the
 * owner's class registration instead of this name would compile and receive the
 * service ungated. `PIM_CONNECTOR_REGISTRY_PORT` above is the same literal, for
 * the owner's `providePort` call.
 */
export interface PimConnectorRegistryPort {
  /** Refuses when another PIM connector's activation Setting is true. */
  assertCanActivate(moduleId: string): Promise<void>;
  recordActive(moduleId: string, adminId: string | null): Promise<void>;
  clearActive(moduleId: string): Promise<void>;
  getActiveModuleId(): Promise<string | null>;
}

// Feature 132 — `PIM_CONNECTOR_MODULES` is **gone**.
//
// It listed two of the four shipped PIM connectors, so exclusivity covered 2 of the
// 12 ordered pairs and nothing said so; its second field, `activationSettingCode`,
// was byte-identical to each member's own `activation.settingCode` in every entry
// that could be checked — one fact with two homes (D-100); and a connector
// installed from npm or shipped by a deployment's overlay could not get into it
// without editing this file, which they do not own.
//
// The family is declared by its members, in their own manifests
// (`capabilities: ['pim-connector']`), and derived by the platform on every
// composition. `pim_connector` owns the key and mints the refusal code.
