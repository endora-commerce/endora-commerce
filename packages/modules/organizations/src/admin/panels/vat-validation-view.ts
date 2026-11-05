import type {
  OrganizationTaxIdValidationRecord,
  RegistryDivergence,
  RegistryProvider,
} from '@endora-commerce/contracts';

/**
 * Feature 173 — the pure decisions behind the VAT validation panel's
 * registration-time card and the moderation notice
 * (`specs/173-registration-registry-lookup/contracts/admin-surfaces.md` §7–§8).
 */

/** The newest row that came from a registration, from a newest-first history. */
export function newestRegistrationRow(
  items: readonly OrganizationTaxIdValidationRecord[],
): OrganizationTaxIdValidationRecord | null {
  return items.find((item) => item.origin === 'registration') ?? null;
}

export interface RegistryComparisonRow {
  field: RegistryDivergence['field'];
  registry: string | null;
  submitted: string;
  differs: boolean;
}

/** The registry's value beside the submitted one, field by field; divergence decided by the backend. */
export function registryComparisonRows(row: OrganizationTaxIdValidationRecord): RegistryComparisonRow[] {
  const submitted = row.submittedValues;
  if (!submitted) return [];
  const address = row.addressReturned;
  const differing = new Set((row.divergence ?? []).map((entry) => entry.field));
  const pairs: Array<[RegistryDivergence['field'], string | null | undefined, string]> = [
    ['name', row.legalNameReturned, submitted.name],
    ['street', address?.line1, submitted.registeredAddress.street],
    ['postalCode', address?.postalCode, submitted.registeredAddress.postalCode],
    ['city', address?.city, submitted.registeredAddress.city],
    ['country', address?.countryCode, submitted.registeredAddress.country],
  ];
  return pairs.map(([field, registry, value]) => ({
    field,
    registry: registry ?? null,
    submitted: value,
    differs: differing.has(field),
  }));
}

/** The moderation notice shows for a pending Organization whose submission differs from the registry. */
export function showRegistryDivergenceNotice(status: string, count: number | undefined): boolean {
  return status === 'pending_verification' && (count ?? 0) > 0;
}

/**
 * The VAT status a registration row reports, as a key of `vatValidation.vatStatus.*`;
 * `not_checked` when the Polish-sources mode left it unasked on purpose (`gus`).
 */
export function vatStatusKey(
  row: OrganizationTaxIdValidationRecord,
): 'active' | 'exempt' | 'not_registered' | 'unknown' | 'not_checked' | null {
  if (!row.registryDetails) return null;
  if (row.errorKind === 'vat_status_not_checked') return 'not_checked';
  return row.registryDetails.vatPayerStatus;
}

const KNOWN_REASONS: ReadonlySet<string> = new Set([
  'excluded_by_setting',
  'network_timeout',
  'network_error',
  'not_configured',
  'budget_exhausted',
  'gus_invalid_key',
  'gus_session',
  'rate_limited',
]);

export type AttemptReason =
  | 'excluded_by_setting'
  | 'network_timeout'
  | 'network_error'
  | 'not_configured'
  | 'budget_exhausted'
  | 'gus_invalid_key'
  | 'gus_session'
  | 'rate_limited'
  | 'other';

/** The attempts that did not answer — failed, refused, not configured or excluded — with a translatable reason. */
export function attemptNotes(
  row: OrganizationTaxIdValidationRecord,
): Array<{ provider: RegistryProvider; reason: AttemptReason }> {
  return (row.registryDetails?.attempts ?? [])
    .filter((attempt) => attempt.outcome === 'unavailable' || attempt.outcome === 'skipped')
    .map((attempt) => ({
      provider: attempt.provider,
      reason: (attempt.errorKind && KNOWN_REASONS.has(attempt.errorKind) ? attempt.errorKind : 'other') as AttemptReason,
    }));
}
