/**
 * Pluggable VAT-ID validator port (feature 026 US7).
 *
 * The real production adapters reach out to VIES (EU VAT IDs) and the
 * Polish Ministerstwo Finansów whitelist (Polish NIPs). Tests inject
 * fake adapters so the suite never makes real HTTP calls.
 *
 * Every adapter MUST degrade safely: a transient network failure or a
 * provider-side 5xx returns `{ outcome: 'deferred', errorKind: ... }`
 * rather than throwing. A clean "not registered" response returns
 * `{ outcome: 'failed', errorKind: 'not_found' }`. Only `validated`
 * carries the optional `legalName` + `address` payloads that the
 * applyAutoFill flow consumes.
 */

import type { ReturnedAddress } from '../entities/organization-tax-id-validation.entity.js';
import type {
  VatValidationOutcome,
  VatValidationProvider,
} from '../entities/organization.entity.js';

export interface VatValidationResult {
  outcome: VatValidationOutcome;
  legalName: string | null;
  address: ReturnedAddress | null;
  errorKind: string | null;
}

export interface VatValidator {
  readonly provider: VatValidationProvider;
  validate(input: {
    taxId: string;
    /** Optional country hint extracted upstream (VIES needs the country split). */
    countryCode?: string | undefined;
  }): Promise<VatValidationResult>;
}
