import {
  REGISTRY_LOOKUP_PL_SOURCES,
  type RegistryActivityStatus,
  type RegistryAttempt,
  type RegistryPlSources,
  type RegistryProvider,
  type RegistryVatStatus,
} from '@endora-commerce/contracts';

/**
 * Feature 173 — the module-internal registry port (research R-2).
 *
 * `VatValidationResult` answers "is this VAT ID valid" and is a published port
 * consumed by `customers`; the lookup asks "what does the registry know about
 * this company" — a structured address, REGON, VAT **and** activity status —
 * which that contract does not carry. So the lookup has its own result type,
 * internal to `organizations` because nothing else consumes it.
 */

export { REGISTRY_LOOKUP_PL_SOURCES };
export type { RegistryActivityStatus, RegistryAttempt, RegistryPlSources, RegistryProvider, RegistryVatStatus };

export interface CompanyRegistryAddress {
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** ISO alpha-2 in the registry's spelling (`EL` for Greece). */
  country: string;
}

export interface CompanyRegistryRecord {
  legalName: string | null;
  address: CompanyRegistryAddress;
  regon: string | null;
  vatPayerStatus: RegistryVatStatus;
  activityStatus: RegistryActivityStatus;
}

export type CompanyRegistryOutcome = 'found' | 'not_found' | 'unavailable';

export interface CompanyRegistryAnswer {
  provider: RegistryProvider;
  outcome: CompanyRegistryOutcome;
  /** Non-null only when found. */
  record: CompanyRegistryRecord | null;
  /** 'network_timeout', 'gus_session', 'rate_limited', … — never a key, a sid or registry text. */
  errorKind: string | null;
}

/** A resolved GUS BIR1.1 credential — in memory only, never logged or persisted (FR-011). */
export interface GusCredential {
  apiKey: string;
  environment: 'production' | 'test';
}

export interface CompanyRegistryLookupInput {
  /** Normalised, without a country prefix. */
  taxId: string;
  /** The registry's spelling (`EL` for Greece). */
  country: string;
  /**
   * The GUS credential, resolved by the lookup service per lookup and only when
   * the Polish-sources mode includes GUS. Read by the GUS client alone.
   */
  gusCredential?: GusCredential;
}

export interface CompanyRegistryClient {
  readonly provider: RegistryProvider;
  /** Never throws: every failure is an `unavailable` answer with an error kind. */
  lookup(input: CompanyRegistryLookupInput): Promise<CompanyRegistryAnswer>;
}

/** The three clients the lookup composes (`organizationsRegistryClients`). */
export interface OrganizationsRegistryClients {
  readonly gusPl: CompanyRegistryClient;
  readonly mfPl: CompanyRegistryClient;
  readonly vies: CompanyRegistryClient;
}

/**
 * The merged answer of one lookup (research R-3), as cached (data-model §3).
 */
export interface RegistryLookupAnswer {
  status: CompanyRegistryOutcome;
  /** The registry's spelling (`EL`). */
  country: string;
  /** Normalised, without prefix. */
  taxId: string;
  /** The Polish-sources mode in force; null unless the country is PL. */
  plSources: RegistryPlSources | null;
  record: CompanyRegistryRecord | null;
  dataSource: RegistryProvider | null;
  vatStatusSource: 'mf_pl' | 'vies' | null;
  attempts: RegistryAttempt[];
  fetchedAt: string;
}

/** What a ticket holds: the answer the buyer was shown, plus whether it came from cache. */
export interface RegistryLookupSnapshot extends RegistryLookupAnswer {
  version: 1;
  lookupId: string;
  fromCache: boolean;
  issuedAt: string;
}

/** Whether a stored value is one of the three modes; anything else reads as the default. */
export function parsePlSources(value: unknown): RegistryPlSources {
  return typeof value === 'string' && (REGISTRY_LOOKUP_PL_SOURCES as readonly string[]).includes(value)
    ? (value as RegistryPlSources)
    : 'gus_mf';
}
