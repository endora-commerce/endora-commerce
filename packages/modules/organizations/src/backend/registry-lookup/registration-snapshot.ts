import {
  registryLookupCountryForPicker,
  type RegistryDetails,
  type SubmittedCompanyValues,
  type VatValidationOutcome,
  type VatValidationProvider,
} from '@endora-commerce/contracts';
import type { RegistryLookupSnapshot } from './company-registry-port.js';
import { sameNormalizedTaxId } from './tax-id.js';

/**
 * Feature 173 — what one registration persists about the lookup it carried
 * (research R-13, data-model §1): the values of one
 * `organization_tax_id_validations` row with `origin: 'registration'`.
 *
 * Built only from the platform's own ticket and the submission: the snapshot
 * is what the buyer was shown, never anything the client sends back (FR-019).
 * `null` when the ticket was issued for another tax ID or country after
 * normalisation — the buyer fetched, then changed the number.
 */

export interface RegistrationSubmission {
  name: string;
  taxId: string;
  registeredAddress: { street: string; postalCode: string; city: string; country: string };
}

export interface RegistrationValidationRow {
  provider: VatValidationProvider;
  outcome: VatValidationOutcome;
  errorKind: string | null;
  taxIdValue: string;
  legalNameReturned: string | null;
  addressReturned: {
    line1: string | null;
    postalCode: string | null;
    city: string | null;
    countryCode: string;
  } | null;
  origin: 'registration';
  registryDetails: RegistryDetails;
  submittedValues: SubmittedCompanyValues;
}

const LEGAL_NAME_COLUMN_LENGTH = 255;

function outcomeOf(snapshot: RegistryLookupSnapshot): { outcome: VatValidationOutcome; errorKind: string | null } {
  if (snapshot.status === 'not_found') return { outcome: 'failed', errorKind: 'not_found' };
  if (snapshot.status === 'unavailable' || snapshot.record === null) {
    const first = snapshot.attempts.find((attempt) => attempt.errorKind !== 'excluded_by_setting');
    return { outcome: 'deferred', errorKind: first?.errorKind ?? 'unavailable' };
  }
  switch (snapshot.record.vatPayerStatus) {
    case 'active':
      return { outcome: 'validated', errorKind: null };
    case 'exempt':
    case 'not_registered':
      // The White List client's existing code for the same fact.
      return { outcome: 'failed', errorKind: 'not_active_vat_payer' };
    case 'unknown':
      // Under `gus` nothing is pending — the status was deliberately not asked
      // for, and `deferred` would tell an administrator to retry.
      return snapshot.plSources === 'gus'
        ? { outcome: 'unverified', errorKind: 'vat_status_not_checked' }
        : { outcome: 'deferred', errorKind: 'vat_status_unavailable' };
  }
}

export function registrationValidationRow(
  snapshot: RegistryLookupSnapshot,
  submission: RegistrationSubmission,
): RegistrationValidationRow | null {
  if (!sameNormalizedTaxId(snapshot, { taxId: submission.taxId, country: submission.registeredAddress.country })) {
    return null;
  }
  const { outcome, errorKind } = outcomeOf(snapshot);
  const record = snapshot.status === 'found' ? snapshot.record : null;
  const tried = snapshot.attempts.find((attempt) => attempt.errorKind !== 'excluded_by_setting');
  const provider = snapshot.dataSource ?? tried?.provider ?? snapshot.attempts[0]?.provider ?? 'vies';
  return {
    provider,
    outcome,
    errorKind,
    taxIdValue: submission.taxId,
    legalNameReturned: record?.legalName ? record.legalName.slice(0, LEGAL_NAME_COLUMN_LENGTH) : null,
    addressReturned: record
      ? {
          line1: record.address.street,
          postalCode: record.address.postalCode,
          city: record.address.city,
          // The form a country picker submits (GR, not EL), so the moderator's
          // comparison is like for like.
          countryCode: registryLookupCountryForPicker(record.address.country),
        }
      : null,
    origin: 'registration',
    registryDetails: {
      plSources: snapshot.plSources,
      dataSource: snapshot.dataSource,
      vatStatusSource: snapshot.vatStatusSource,
      regon: record?.regon ?? null,
      vatPayerStatus: record?.vatPayerStatus ?? 'unknown',
      activityStatus: record?.activityStatus ?? 'unknown',
      fetchedAt: snapshot.fetchedAt,
      fromCache: snapshot.fromCache,
      attempts: snapshot.attempts,
    },
    submittedValues: {
      name: submission.name,
      taxId: submission.taxId,
      registeredAddress: {
        street: submission.registeredAddress.street,
        postalCode: submission.registeredAddress.postalCode,
        city: submission.registeredAddress.city,
        country: submission.registeredAddress.country,
      },
    },
  };
}
