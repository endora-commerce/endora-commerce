import {
  organizationTaxIdValidationRecordSchema,
  type OrganizationTaxIdValidationRecord,
} from '@endora-commerce/contracts';
import type { OrganizationTaxIdValidation } from '../entities/organization-tax-id-validation.entity.js';
import { computeRegistryDivergence } from './registry-divergence.js';

/**
 * Feature 173 — one `organization_tax_id_validations` row as the admin API
 * answers it (`contracts/admin-surfaces.md` §6), validated by the contract's
 * schema so the published shape and the answer cannot drift.
 *
 * `divergence` is computed on read (research R-14): `null` for an
 * administrator's row, the differing fields for a registration row — compared
 * against what the customer submitted, never against the Organization's
 * current values, so an administrator's later edit is not read as the
 * customer's.
 */
export function serializeTaxIdValidation(row: OrganizationTaxIdValidation): OrganizationTaxIdValidationRecord {
  const address = row.addressReturned ?? null;
  const submittedValues = row.submittedValues ?? null;
  const divergence =
    row.origin === 'registration' && submittedValues
      ? computeRegistryDivergence(
          {
            name: row.legalNameReturned ?? null,
            street: address?.line1 ?? null,
            postalCode: address?.postalCode ?? null,
            city: address?.city ?? null,
            country: address?.countryCode ?? null,
          },
          submittedValues,
        )
      : null;
  return organizationTaxIdValidationRecordSchema.parse({
    id: row.id,
    provider: row.provider,
    outcome: row.outcome,
    taxIdValue: row.taxIdValue,
    legalNameReturned: row.legalNameReturned ?? null,
    addressReturned: address,
    errorKind: row.errorKind ?? null,
    requestedByAdminUserId: row.requestedByAdminUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    origin: row.origin ?? 'admin',
    registryDetails: row.registryDetails ?? null,
    submittedValues,
    divergence,
  });
}
