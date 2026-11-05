/**
 * Feature 173 — the harness's three company-registry fakes, contributed over
 * `organizationsRegistryClients` (`specs/173-registration-registry-lookup/`
 * tasks T026). No test may open a socket to GUS, the White List or VIES.
 *
 * **Deterministic by the number's second-to-last character** (for a ten-digit
 * NIP the ninth digit, which the checksum leaves free):
 *
 * | char | GUS | White List | VIES |
 * | --- | --- | --- | --- |
 * | `9` | not found | not found | not found |
 * | `8` | unavailable | unavailable | unavailable |
 * | `7` | found, activity **ceased** | found, VAT **exempt** | found |
 * | `6` | found | found, VAT **not registered** | found |
 * | `5` | found | found | found with **no details** (`---`) |
 * | other | found | found, VAT active | found |
 *
 * Each client counts its calls, can be forced to one outcome for every call
 * (`force`), or made never to answer (`force('hang')`). `reset()` clears both.
 * A call records whether a GUS credential came with it and its environment —
 * never the key.
 */

export type FakeRegistryProvider = 'gus_pl' | 'mf_pl' | 'vies';
export type FakeRegistryBehaviour = 'auto' | 'found' | 'not_found' | 'unavailable' | 'hang';

interface FakeRecord {
  legalName: string | null;
  address: { street: string | null; postalCode: string | null; city: string | null; country: string };
  regon: string | null;
  vatPayerStatus: 'active' | 'exempt' | 'not_registered' | 'unknown';
  activityStatus: 'active' | 'ceased' | 'unknown';
}

interface FakeAnswer {
  provider: FakeRegistryProvider;
  outcome: 'found' | 'not_found' | 'unavailable';
  record: FakeRecord | null;
  errorKind: string | null;
}

export interface FakeRegistryCall {
  taxId: string;
  country: string;
  gusEnvironment: 'production' | 'test' | null;
}

export class FakeCompanyRegistryClient {
  readonly calls: FakeRegistryCall[] = [];
  private behaviour: FakeRegistryBehaviour = 'auto';

  constructor(readonly provider: FakeRegistryProvider) {}

  force(behaviour: FakeRegistryBehaviour): void {
    this.behaviour = behaviour;
  }

  reset(): void {
    this.calls.length = 0;
    this.behaviour = 'auto';
  }

  async lookup(input: {
    taxId: string;
    country: string;
    gusCredential?: { apiKey: string; environment: 'production' | 'test' };
  }): Promise<FakeAnswer> {
    this.calls.push({
      taxId: input.taxId,
      country: input.country,
      gusEnvironment: input.gusCredential?.environment ?? null,
    });
    const marker = input.taxId.charAt(input.taxId.length - 2);
    const behaviour =
      this.behaviour !== 'auto'
        ? this.behaviour
        : marker === '9'
          ? 'not_found'
          : marker === '8'
            ? 'unavailable'
            : 'found';
    if (behaviour === 'hang') return new Promise<FakeAnswer>(() => {});
    if (behaviour === 'not_found') return { provider: this.provider, outcome: 'not_found', record: null, errorKind: null };
    if (behaviour === 'unavailable') {
      return { provider: this.provider, outcome: 'unavailable', record: null, errorKind: 'provider_503' };
    }
    return { provider: this.provider, outcome: 'found', record: this.record(input.taxId, input.country, marker), errorKind: null };
  }

  private record(taxId: string, country: string, marker: string): FakeRecord {
    switch (this.provider) {
      case 'gus_pl':
        return {
          legalName: `GUS REGISTERED COMPANY ${taxId} SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ`,
          address: { street: 'ul. Rejestrowa 12/3', postalCode: '00-950', city: 'Warszawa', country: 'PL' },
          regon: '123456785',
          vatPayerStatus: 'unknown',
          activityStatus: marker === '7' ? 'ceased' : 'active',
        };
      case 'mf_pl':
        return {
          legalName: `WHITE LIST COMPANY ${taxId} SP. Z O.O.`,
          address: { street: 'UL. BIAŁA 5', postalCode: '00-001', city: 'WARSZAWA', country: 'PL' },
          regon: '123456785',
          vatPayerStatus: marker === '7' ? 'exempt' : marker === '6' ? 'not_registered' : 'active',
          activityStatus: 'unknown',
        };
      case 'vies':
        return marker === '5'
          ? {
              legalName: null,
              address: { street: null, postalCode: null, city: null, country },
              regon: null,
              vatPayerStatus: 'active',
              activityStatus: 'unknown',
            }
          : {
              legalName: `VIES COMPANY ${country}${taxId}`,
              address: { street: 'Teststrasse 1', postalCode: '10115', city: 'Berlin', country },
              regon: null,
              vatPayerStatus: 'active',
              activityStatus: 'unknown',
            };
    }
  }
}

export class FakeRegistryClients {
  readonly gusPl = new FakeCompanyRegistryClient('gus_pl');
  readonly mfPl = new FakeCompanyRegistryClient('mf_pl');
  readonly vies = new FakeCompanyRegistryClient('vies');

  reset(): void {
    this.gusPl.reset();
    this.mfPl.reset();
    this.vies.reset();
  }

  /** Every call any of the three received, in no particular order. */
  totalCalls(): number {
    return this.gusPl.calls.length + this.mfPl.calls.length + this.vies.calls.length;
  }
}

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

/**
 * A checksum-valid ten-digit NIP whose ninth digit — the fakes' marker — is
 * `marker`, derived from `seed` (eight digits). Seeds whose checksum would be
 * 10 are walked forward until one is not.
 */
export function fakeNip(seed: number, marker: string): string {
  for (let n = seed; ; n += 1) {
    const first = String(n % 100_000_000).padStart(8, '0') + marker;
    const sum = first.split('').reduce((acc, digit, i) => acc + Number(digit) * NIP_WEIGHTS[i]!, 0);
    const check = sum % 11;
    if (check !== 10) return `${first}${check}`;
  }
}
