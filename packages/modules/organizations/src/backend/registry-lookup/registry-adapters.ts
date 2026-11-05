import type { MfSearchResult } from '../integrations/ministerstwo-finansow-client.js';
import type { ViesCheckResult } from '../integrations/vies-client.js';
import { parseViesAddress, parseWhiteListAddress, registryText } from './address-parsers.js';
import type {
  CompanyRegistryAnswer,
  CompanyRegistryClient,
  CompanyRegistryLookupInput,
  RegistryVatStatus,
} from './company-registry-port.js';

/**
 * Feature 173 — the White List and VIES clients as `CompanyRegistryClient`s
 * (research R-2, R-6).
 *
 * Each adapter wraps the **same** client instance `validate()` runs on, through
 * its one raw call (`search` / `check`), so the admin "Validate now" and the
 * registration lookup share one HTTP implementation and one throttle per
 * registry rather than two against the White List's per-IP limit.
 */

/** The White List's `statusVat` as the lookup's VAT status. */
function whiteListVatStatus(statusVat: string | null | undefined): RegistryVatStatus {
  const status = (statusVat ?? '').trim().toLowerCase();
  if (status.startsWith('czynn')) return 'active';
  if (status.startsWith('zwolnion')) return 'exempt';
  if (status.startsWith('niezarejestrowan')) return 'not_registered';
  return 'unknown';
}

export class MfRegistryAdapter implements CompanyRegistryClient {
  readonly provider = 'mf_pl' as const;

  constructor(private readonly client: { search(nip: string): Promise<MfSearchResult> }) {}

  async lookup(input: CompanyRegistryLookupInput): Promise<CompanyRegistryAnswer> {
    const result = await this.client.search(input.taxId);
    switch (result.status) {
      case 'found': {
        const { subject } = result;
        const address = parseWhiteListAddress(subject.workingAddress ?? subject.residenceAddress);
        return {
          provider: 'mf_pl',
          outcome: 'found',
          errorKind: null,
          record: {
            legalName: registryText(subject.name),
            address: { ...address, country: 'PL' },
            regon: registryText(subject.regon),
            vatPayerStatus: whiteListVatStatus(subject.statusVat),
            activityStatus: 'unknown',
          },
        };
      }
      case 'not_found':
        return { provider: 'mf_pl', outcome: 'not_found', record: null, errorKind: null };
      case 'invalid':
        // The checksum already held before the call, so a White List refusal of
        // the number reads as "it does not know this number".
        return { provider: 'mf_pl', outcome: 'not_found', record: null, errorKind: result.errorKind };
      case 'unavailable':
        return { provider: 'mf_pl', outcome: 'unavailable', record: null, errorKind: result.errorKind };
    }
  }
}

export class ViesRegistryAdapter implements CompanyRegistryClient {
  readonly provider = 'vies' as const;

  constructor(private readonly client: { check(country: string, number: string): Promise<ViesCheckResult> }) {}

  async lookup(input: CompanyRegistryLookupInput): Promise<CompanyRegistryAnswer> {
    const result = await this.client.check(input.country, input.taxId);
    switch (result.status) {
      case 'valid':
        return {
          provider: 'vies',
          outcome: 'found',
          errorKind: null,
          record: {
            legalName: registryText(result.name),
            address: { ...parseViesAddress(result.address), country: input.country },
            regon: null,
            // VIES answers whether the number is registered for intra-Community
            // transactions; for another member state that is the VAT status the
            // form can show (research R-3).
            vatPayerStatus: 'active',
            activityStatus: 'unknown',
          },
        };
      case 'invalid':
        return { provider: 'vies', outcome: 'not_found', record: null, errorKind: null };
      case 'refused':
      case 'unavailable':
        return { provider: 'vies', outcome: 'unavailable', record: null, errorKind: result.errorKind };
    }
  }
}
