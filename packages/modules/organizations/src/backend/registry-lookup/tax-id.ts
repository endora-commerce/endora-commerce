import { REGISTRY_LOOKUP_COUNTRIES } from '@endora-commerce/contracts';

/**
 * Feature 173 — tax-ID normalisation and the NIP checksum (research R-17).
 *
 * Pure, and shared by the lookup and the registration's ticket check, so the
 * outbound call and the match can never normalise differently. The
 * registration's own stored `taxId` is not touched by this (spec Assumptions):
 * the checksum gates the **lookup** only.
 *
 * Countries come back in the registries' spelling — `EL` for Greece — and the
 * routes convert to the picker's `GR` on the way out.
 */

const SUPPORTED: ReadonlySet<string> = new Set(REGISTRY_LOOKUP_COUNTRIES);
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;
const VIES_NUMBER = /^[0-9A-Z+*]{2,12}$/;

export type NormalizedTaxId =
  | { kind: 'ok'; country: string; taxId: string }
  | { kind: 'invalid_tax_id'; country: string }
  | { kind: 'unsupported_country'; country: string };

/** ISO `GR` is VIES's `EL`; every other code is the same in both. */
function registryCountry(code: string): string {
  const upper = code.trim().toUpperCase();
  return upper === 'GR' ? 'EL' : upper;
}

/** Ten digits whose weighted sum mod 11 equals the tenth; a remainder of 10 is never valid. */
export function isValidNip(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(nip[i]) * NIP_WEIGHTS[i]!;
  const check = sum % 11;
  return check !== 10 && check === Number(nip[9]);
}

export function normalizeTaxId(input: { taxId: string; country: string }): NormalizedTaxId {
  const cleaned = input.taxId.replace(/[\s.-]+/g, '').toUpperCase();
  let country = registryCountry(input.country);
  let number = cleaned;
  const prefix = /^[A-Z]{2}/.exec(cleaned)?.[0];
  if (prefix !== undefined && SUPPORTED.has(registryCountry(prefix))) {
    country = registryCountry(prefix);
    number = cleaned.slice(2);
  }
  if (!SUPPORTED.has(country)) return { kind: 'unsupported_country', country };
  if (country === 'PL') {
    return isValidNip(number) ? { kind: 'ok', country, taxId: number } : { kind: 'invalid_tax_id', country };
  }
  return VIES_NUMBER.test(number) ? { kind: 'ok', country, taxId: number } : { kind: 'invalid_tax_id', country };
}

/**
 * Whether a ticket's normalised `(country, taxId)` is the submission's, after
 * the submission goes through the same normaliser. An invalid submission
 * matches nothing.
 */
export function sameNormalizedTaxId(
  ticket: { country: string; taxId: string },
  submitted: { taxId: string; country: string },
): boolean {
  const normalized = normalizeTaxId(submitted);
  return normalized.kind === 'ok' && normalized.country === ticket.country && normalized.taxId === ticket.taxId;
}
