import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { RegistryDetails, SubmittedCompanyValues } from '@endora-commerce/contracts';
import type {
  VatValidationOutcome,
  VatValidationProvider,
} from './organization.entity.js';

/**
 * One row per validation attempt against an external tax-ID provider
 * (VIES, Ministerstwo Finansów) or against the format-only fallback for
 * non-EU jurisdictions. Persisted regardless of outcome so the admin
 * can audit history and trigger re-validation.
 */
@OrgScoped()
@Entity({ tableName: 'organization_tax_id_validations' })
export class OrganizationTaxIdValidation {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'legalNameReturned'
    | 'addressReturned'
    | 'errorKind'
    | 'requestedByAdminUserId'
    | 'origin'
    | 'registryDetails'
    | 'submittedValues';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'string', length: 32 })
  provider!: VatValidationProvider;

  @Property({ type: 'string', length: 16 })
  outcome!: VatValidationOutcome;

  @Property({ type: 'string', length: 64 })
  taxIdValue!: string;

  @Property({ type: 'string', length: 255, nullable: true })
  legalNameReturned?: string | null;

  @Property({ type: 'json', nullable: true })
  addressReturned?: ReturnedAddress | null;

  @Property({ type: 'string', length: 64, nullable: true })
  errorKind?: string | null;

  @Property({ type: 'uuid', nullable: true })
  requestedByAdminUserId?: string | null;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  /**
   * Feature 173 — `admin` for an administrator's "Validate now", `registration`
   * for the registry lookup a self-registration carried (data-model §1).
   */
  @Property({ type: 'string', length: 16, default: 'admin' })
  origin: TaxIdValidationOrigin = 'admin';

  /** Feature 173 — the registry's extra details; registration rows only. */
  @Property({ type: 'json', nullable: true })
  registryDetails?: RegistryDetails | null;

  /** Feature 173 — what the registrant submitted; registration rows only, no personal data. */
  @Property({ type: 'json', nullable: true })
  submittedValues?: SubmittedCompanyValues | null;
}

export type TaxIdValidationOrigin = 'admin' | 'registration';

export interface ReturnedAddress {
  line1?: string | null;
  line2?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
}
