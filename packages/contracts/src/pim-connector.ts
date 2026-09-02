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

/** Mutual-exclusion registry — see specs/089-unopim-pim-sync/contracts/pim-connector-shared.md */
export interface PimConnectorRegistryPort {
  /** Refuses when another PIM connector's activation Setting is true. */
  assertCanActivate(moduleId: string): Promise<void>;
  recordActive(moduleId: string, adminId: string | null): Promise<void>;
  clearActive(moduleId: string): Promise<void>;
  getActiveModuleId(): Promise<string | null>;
}

/** Known PIM connector modules and their activation setting codes (feature 089). */
export const PIM_CONNECTOR_MODULES = [
  { id: 'pim_ergonode', activationSettingCode: 'pim_ergonode.activation' },
  { id: 'pim_unopim', activationSettingCode: 'pim_unopim.activation' },
] as const;
