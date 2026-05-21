import {
  BeforeCreate,
  BeforeUpdate,
  Entity,
  Index,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
  type EventArgs,
} from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { normalizeOrganizationName } from '../services/normalize-name.js';

/**
 * Organization — the buyer-side legal entity. Owns Customer Accounts,
 * Addresses, and (via FKs that land with later US) Quote Requests, Orders,
 * and Credit Limits.
 *
 * `taxId` is globally unique in the installation (Polish NIP by default; the
 * exact format is spec-validated at the Zod boundary).
 *
 * Status lifecycle (feature 026):
 *   pending_verification -> active   (moderation approve, or auto-approve)
 *   pending_verification -> rejected (moderation reject; terminal)
 *   active               -> blocked  (operator-driven; reversible)
 *   blocked              -> active   (unblock)
 *
 * Legacy `suspended` is migrated to `blocked` by migration 047 and is no
 * longer a valid runtime value.
 *
 * `version` is the optimistic-lock token used by every moderation /
 * restriction / VAT-fill write — see OrganizationModerationService for the
 * conflict handling.
 *
 * `nameSearch` is a denormalized lowercased + diacritic-stripped copy of
 * `name`, kept in sync by the BeforeCreate / BeforeUpdate hooks below. It
 * backs the admin OrganizationPicker's diacritic-insensitive typeahead
 * without needing pg_trgm/unaccent extensions.
 */
@Entity({ tableName: 'organizations' })
export class Organization {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'vatStatus'
    | 'deletedAt'
    | 'customerGroupId'
    | 'legalName'
    | 'vatValidatedAt'
    | 'vatValidationProvider'
    | 'vatValidationOutcome'
    | 'blockedReason'
    | 'blockedAt'
    | 'rejectedReason'
    | 'rejectedAt'
    | 'approvedAt'
    | 'approvedByAdminUserId'
    | 'nameSearch'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 255 })
  @Index()
  name!: string;

  @Property({ type: 'string', length: 255, nullable: true })
  legalName?: string | null;

  @Property({ type: 'string', length: 32 })
  @Unique()
  taxId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: OrganizationStatus = 'pending_verification';

  @Property({ type: 'string', length: 16 })
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge' = 'vat_payer';

  /**
   * Optional pricing bucket. Feeds the feature 011 Application Rule
   * evaluator's `customerGroup` criterion — a Sale or Base list with a
   * `customerGroup ∈ {…}` rule applies to every Organization carrying
   * that `customerGroupId`.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerGroupId?: string | null;

  /** JSONB snapshot of { street, city, postalCode, country }. */
  @Property({ type: 'json' })
  registeredAddress!: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };

  // ── feature 026: moderation + VAT validation tracking ───────────────────

  @Property({ type: 'datetime', nullable: true })
  vatValidatedAt?: Date | null;

  @Property({ type: 'string', length: 32, nullable: true })
  vatValidationProvider?: VatValidationProvider | null;

  @Property({ type: 'string', length: 16, nullable: true })
  vatValidationOutcome?: VatValidationOutcome | null;

  @Property({ type: 'text', nullable: true })
  blockedReason?: string | null;

  @Property({ type: 'datetime', nullable: true })
  blockedAt?: Date | null;

  @Property({ type: 'text', nullable: true })
  rejectedReason?: string | null;

  @Property({ type: 'datetime', nullable: true })
  rejectedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  approvedAt?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  approvedByAdminUserId?: string | null;

  /**
   * Lowercased + diacritic-stripped copy of `name`. Kept in sync by the
   * BeforeCreate / BeforeUpdate hooks; never read or written by callers
   * directly.
   */
  @Property({ type: 'string', length: 255 })
  nameSearch: string = '';

  /** Optimistic-lock token (auto-incremented by MikroORM on every update). */
  @Property({ type: 'integer', version: true })
  version!: number;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // ── lifecycle hooks ────────────────────────────────────────────────────

  @BeforeCreate()
  @BeforeUpdate()
  syncNameSearch(_args: EventArgs<Organization>): void {
    this.nameSearch = normalizeOrganizationName(this.name);
  }
}

export type OrganizationStatus =
  | 'pending_verification'
  | 'active'
  | 'blocked'
  | 'rejected';

export const ORGANIZATION_STATUSES = [
  'pending_verification',
  'active',
  'blocked',
  'rejected',
] as const;

export type VatValidationProvider = 'vies' | 'mf_pl' | 'format_only';

export type VatValidationOutcome = 'validated' | 'failed' | 'deferred' | 'unverified';
