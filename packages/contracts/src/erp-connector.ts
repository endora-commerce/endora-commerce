// Shared ERP connector vocabulary — feature 119 (`erp_connector` package).

import { z } from 'zod';

export const erpSyncJobStatusSchema = z.enum([
  'pending',
  'in_progress',
  'success',
  'error',
  'poison',
]);
export type ErpSyncJobStatus = z.infer<typeof erpSyncJobStatusSchema>;

export const erpSyncJobDirectionSchema = z.enum(['erp_to_shop', 'shop_to_erp']);
export type ErpSyncJobDirection = z.infer<typeof erpSyncJobDirectionSchema>;

export const erpSyncIssueSeveritySchema = z.enum(['info', 'warning', 'error']);
export type ErpSyncIssueSeverity = z.infer<typeof erpSyncIssueSeveritySchema>;

export const erpSyncRunSummarySchema = z.object({
  considered: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type ErpSyncRunSummary = z.infer<typeof erpSyncRunSummarySchema>;

export const erpIdentityEntityTypeSchema = z.enum([
  'article',
  'contractor',
  'order',
  'quote_request',
  'offer',
  'sale_document',
]);
export type ErpIdentityEntityType = z.infer<typeof erpIdentityEntityTypeSchema>;

export const ERP_CONNECTOR_REGISTRY_PORT = 'erpConnectorRegistryPort' as const;

/**
 * Container name: `erpConnectorRegistryPort`. Owner: `erp_connector`.
 *
 * Mutual-exclusion registry among ERP connectors — see
 * `specs/130-comarch-xl-sync/contracts/erp-connector-shared.md`.
 */
export interface ErpConnectorRegistryPort {
  /** Refuses when another ERP connector's activation Setting is true. */
  assertCanActivate(moduleId: string): Promise<void>;
  recordActive(moduleId: string, adminId: string | null): Promise<void>;
  clearActive(moduleId: string): Promise<void>;
  getActiveModuleId(): Promise<string | null>;
}

// Feature 132 — `ERP_CONNECTOR_MODULES` is **gone**, and this array is the one whose
// deletion repairs a live Principle XV violation: a per-deployment **overlay** module
// had to be written into this core file to join its family, because there was no
// other way in. The family is declared by its members
// (`capabilities: ['erp-connector']`) and derived by the platform; `erp_connector`
// owns the key and mints the refusal code.

export const ERP_CONNECTOR_ALREADY_ACTIVE = 'ERP_CONNECTOR_ALREADY_ACTIVE' as const;
