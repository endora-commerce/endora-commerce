import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';

/**
 * Feature 173 — the company registry lookup at storefront registration
 * (`specs/173-registration-registry-lookup/contracts/public-api.md`,
 * `contracts/admin-surfaces.md` §6, data-model §6). Owner: `organizations`.
 *
 * A buyer registering a business types a Polish NIP or an EU VAT number; the
 * platform answers what the public registry (GUS REGON, the Ministry of Finance
 * VAT White List, VIES) knows about the company, and the registration later
 * carries the `lookupId` back so the snapshot the buyer was shown is persisted
 * from the platform's own store — never from anything the client sends.
 *
 * Every status, VAT status, activity status and source is a **machine token**:
 * the storefront and the admin translate them (research R-18).
 *
 * This file imports nothing from `organizations.ts` at run time: that file
 * imports {@link registryLookupIdSchema} from here for the register body.
 */

/**
 * The countries the lookup serves: Poland (GUS / White List) and the VIES
 * member states. VIES spells Greece `EL` and Northern Ireland `XI`; the form's
 * country picker sends ISO `GR`, which the backend normaliser maps to `EL`.
 */
export const REGISTRY_LOOKUP_COUNTRIES = [
  'PL',
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'EL',
  'ES',
  'FI',
  'FR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
  'XI',
] as const;
export type RegistryLookupCountry = (typeof REGISTRY_LOOKUP_COUNTRIES)[number];

/**
 * The picker form of a lookup country: `GR` for Greece, every other code as it
 * is. What `registration-options` lists and what a lookup answer's `country`
 * carries, so a client can select it in an ISO country picker.
 */
export function registryLookupCountryForPicker(country: string): string {
  return country === 'EL' ? 'GR' : country;
}

/** The lookup reference: 32 random bytes, base64url, no padding. */
export const registryLookupIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// --- GET /api/v1/organizations/registration-options --------------------------

export const registrationOptionsResponseSchema = z.object({
  data: z.object({
    registryLookup: z.object({
      enabled: z.boolean(),
      /** Countries the lookup serves; `[]` when disabled. Picker form (GR, not EL). */
      countries: z.array(z.string().length(2)),
    }),
  }),
});
export type RegistrationOptionsResponse = z.infer<typeof registrationOptionsResponseSchema>;

// --- POST /api/v1/organizations/registry-lookup ------------------------------

export const registryLookupRequestSchema = z.object({
  /** As typed: spaces, dashes, dots and an EU prefix are accepted. */
  taxId: z.string().trim().min(1).max(32),
  /** The country chosen in the form; an EU prefix in `taxId` overrides it. */
  country: z
    .string()
    .length(2)
    .transform((c) => c.toUpperCase()),
});
export type RegistryLookupRequest = z.infer<typeof registryLookupRequestSchema>;

export const REGISTRY_LOOKUP_STATUSES = [
  'found',
  'not_found',
  'unavailable',
  'invalid_tax_id',
  'unsupported_country',
] as const;
export const registryLookupStatusSchema = z.enum(REGISTRY_LOOKUP_STATUSES);
export type RegistryLookupStatus = z.infer<typeof registryLookupStatusSchema>;

export const registryVatStatusSchema = z.enum(['active', 'exempt', 'not_registered', 'unknown']);
export type RegistryVatStatus = z.infer<typeof registryVatStatusSchema>;

export const registryActivityStatusSchema = z.enum(['active', 'ceased', 'unknown']);
export type RegistryActivityStatus = z.infer<typeof registryActivityStatusSchema>;

/** The registry a found answer's data came from. */
export const registrySourceSchema = z.enum(['gus', 'mf', 'vies']);
export type RegistrySource = z.infer<typeof registrySourceSchema>;

export const registryLookupCompanySchema = z.object({
  legalName: z.string().nullable(),
  /** Field names match `registerOrganizationRequestSchema.organization.registeredAddress`. */
  registeredAddress: z.object({
    street: z.string().nullable(),
    postalCode: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().length(2),
  }),
  regon: z.string().nullable(),
  vatStatus: registryVatStatusSchema,
  activityStatus: registryActivityStatusSchema,
});
export type RegistryLookupCompany = z.infer<typeof registryLookupCompanySchema>;

export const registryLookupResponseSchema = z.object({
  data: z.object({
    status: registryLookupStatusSchema,
    /** Present for found / not_found / unavailable; send it back on registration. */
    lookupId: registryLookupIdSchema.nullable(),
    /** The normalised identifier the lookup used, e.g. "5260250995"; null when invalid. */
    normalizedTaxId: z.string().nullable(),
    /** The country the lookup used (an EU prefix may have changed it). Picker form: GR, not EL. */
    country: z.string().length(2),
    /** The registry the company data came from; null unless found. */
    source: registrySourceSchema.nullable(),
    company: registryLookupCompanySchema.nullable(),
    fetchedAt: isoDateTimeSchema.nullable(),
  }),
});
export type RegistryLookupResponse = z.infer<typeof registryLookupResponseSchema>;
export type RegistryLookupResult = RegistryLookupResponse['data'];

// --- Admin: GET /api/v1/admin/organizations/:id/vat-validations item ---------

/** The Polish-sources mode a lookup ran under (owner decision OD-5). */
export const REGISTRY_LOOKUP_PL_SOURCES = ['gus_mf', 'gus', 'mf'] as const;
export const registryPlSourcesSchema = z.enum(REGISTRY_LOOKUP_PL_SOURCES);
export type RegistryPlSources = z.infer<typeof registryPlSourcesSchema>;

export const registryProviderSchema = z.enum(['gus_pl', 'mf_pl', 'vies']);
export type RegistryProvider = z.infer<typeof registryProviderSchema>;

export const registryAttemptSchema = z.object({
  provider: registryProviderSchema,
  outcome: z.enum(['found', 'not_found', 'unavailable', 'skipped']),
  /** 'not_configured', 'excluded_by_setting', 'budget_exhausted', 'network_timeout', … */
  errorKind: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export type RegistryAttempt = z.infer<typeof registryAttemptSchema>;

/** What the registry said at registration, beside the existing validation columns (data-model §1.1). */
export const registryDetailsSchema = z.object({
  /** The Polish-sources mode the lookup ran under; null for a non-Polish lookup (always VIES). */
  plSources: registryPlSourcesSchema.nullable(),
  dataSource: registryProviderSchema.nullable(),
  vatStatusSource: z.enum(['mf_pl', 'vies']).nullable(),
  regon: z.string().nullable(),
  vatPayerStatus: registryVatStatusSchema,
  activityStatus: registryActivityStatusSchema,
  /** When the registries answered — may precede the row's `createdAt` by up to the ticket TTL. */
  fetchedAt: isoDateTimeSchema,
  /** Whether the answer was served from the platform's cache. */
  fromCache: z.boolean(),
  attempts: z.array(registryAttemptSchema),
});
export type RegistryDetails = z.infer<typeof registryDetailsSchema>;

/** What the registrant submitted, captured at registration (data-model §1.2). No personal data. */
export const submittedCompanyValuesSchema = z.object({
  name: z.string(),
  taxId: z.string(),
  registeredAddress: z.object({
    street: z.string(),
    postalCode: z.string(),
    city: z.string(),
    country: z.string(),
  }),
});
export type SubmittedCompanyValues = z.infer<typeof submittedCompanyValuesSchema>;

export const REGISTRY_DIVERGENCE_FIELDS = ['name', 'street', 'postalCode', 'city', 'country'] as const;
export const registryDivergenceSchema = z.object({
  field: z.enum(REGISTRY_DIVERGENCE_FIELDS),
  registry: z.string(),
  submitted: z.string(),
});
export type RegistryDivergence = z.infer<typeof registryDivergenceSchema>;

export const vatValidationProviderSchema = z.enum(['vies', 'mf_pl', 'format_only', 'gus_pl']);
export const vatValidationOutcomeSchema = z.enum(['validated', 'failed', 'deferred', 'unverified']);

export const vatReturnedAddressSchema = z.object({
  line1: z.string().nullable().optional(),
  line2: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
});

/** One row of an Organization's VAT validation history, as the admin API answers it. */
export const organizationTaxIdValidationRecordSchema = z.object({
  id: z.string().uuid(),
  provider: vatValidationProviderSchema,
  outcome: vatValidationOutcomeSchema,
  taxIdValue: z.string(),
  legalNameReturned: z.string().nullable(),
  addressReturned: vatReturnedAddressSchema.nullable(),
  errorKind: z.string().nullable(),
  requestedByAdminUserId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  /** `admin` — an administrator's "Validate now"; `registration` — the lookup a self-registration carried. */
  origin: z.enum(['admin', 'registration']),
  registryDetails: registryDetailsSchema.nullable(),
  submittedValues: submittedCompanyValuesSchema.nullable(),
  /** Computed on read; `null` for an admin row, `[]` for a registration row that matches. */
  divergence: z.array(registryDivergenceSchema).nullable(),
});
export type OrganizationTaxIdValidationRecord = z.infer<typeof organizationTaxIdValidationRecordSchema>;
