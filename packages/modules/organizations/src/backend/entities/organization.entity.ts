import {
  BeforeCreate,
  BeforeUpdate,
  Entity,
  Index,
  OptionalProps,
  PrimaryKey,
  Property,
  type EventArgs,
} from '@mikro-orm/core';
import { normalizeTaxId } from '@endora-commerce/contracts';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import { normalizeOrganizationName } from '../services/normalize-name.js';

/**
 * Organization — the buyer-side legal entity. Owns Customer Accounts,
 * Addresses, and (via FKs that land with later US) Quote Requests, Orders,
 * and Credit Limits.
 *
 * `taxId` is a company's tax ID (Polish NIP by default; the exact format is
 * spec-validated at the Zod boundary) and `null` for a personal organization
 * (`specs/177-tax-id-scope/`). Where the same tax ID may appear twice is the
 * installation's tax-ID scope: in `global` (the default) nowhere, in
 * `per-tree-root` only inside one organization tree. Both are enforced by the
 * database — `organizations_tax_id_unique` or `organizations_tax_id_one_tree`,
 * whichever the scope Command installed — never by this class.
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
@GlobalEntity()
@Entity({ tableName: 'organizations' })
export class Organization {
  [OptionalProps]?:
    | 'customFieldValues'
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'vatStatus'
    | 'isPersonal'
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
    | 'orderConfirmationEmails'
    | 'fulfilmentStrategy'
    | 'fulfilmentStrategyWarehouseOrder'
    | 'parentId'
    | 'path'
    | 'creditInheritanceMode'
    | 'taxId'
    | 'personalAccountId'
    | 'convertedToCompanyAt'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 255 })
  @Index()
  name!: string;

  @Property({ type: 'string', length: 255, nullable: true })
  legalName?: string | null;

  /**
   * `null` iff `isPersonal` — the `organizations_tax_id_presence` check holds
   * it (FR-001). No `@Unique()`: the constraint is the scope's, and a unique
   * declared here would be wrong in `per-tree-root`.
   */
  @Property({ type: 'string', length: 32, nullable: true })
  taxId?: string | null;

  /**
   * `specs/177-tax-id-scope/` (FR-002, FR-003) — the customer account a personal
   * organization was provisioned for: what makes provisioning idempotent and
   * finds "the account's own personal organization" even while the account
   * belongs to a company. A correlation id, not a foreign key
   * (`customer_accounts` depends on this module). Personal rows only
   * (`organizations_personal_account_link`), unique; cleared on conversion.
   */
  @Property({ type: 'uuid', nullable: true })
  personalAccountId?: string | null;

  /**
   * `specs/177-tax-id-scope/` (FR-039) — when `organization.convert_to_company`
   * turned this personal organization into a company. Set once, never cleared.
   */
  @Property({ type: 'datetime', nullable: true })
  convertedToCompanyAt?: Date | null;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: OrganizationStatus = 'pending_verification';

  @Property({ type: 'string', length: 16 })
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge' = 'vat_payer';

  /**
   * Feature 051 — `true` for a single-member Personal Organization backing a B2C
   * (individual) customer; `false` for a company organization. Personal orgs are
   * auto-provisioned, created `active`, and excluded from B2B admin surfaces.
   */
  @Property({ type: 'boolean' })
  @Index()
  isPersonal: boolean = false;

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

  /**
   * Feature 038 (US4) — additional email addresses that also receive an order
   * confirmation for every order placed by a Customer of this Organization.
   * Read by the orders module through OrganizationConfirmationEmailsPort.
   */
  @Property({ type: 'json' })
  orderConfirmationEmails: string[] = [];

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
   * Organization-level override of the warehouse-picking (fulfilment) strategy
   * applied when reserving stock at order placement (precedence: Product →
   * Organization → Sales Channel setting → platform default). `null` ⇒ inherit.
   * Mirrors the per-product columns on `Product`. When `defined_order`,
   * `fulfilmentStrategyWarehouseOrder` carries the ordered warehouse-id walk.
   */
  @Property({ type: 'string', length: 32, nullable: true })
  fulfilmentStrategy?:
    | 'any'
    | 'default_first'
    | 'lowest_stock_first'
    | 'highest_stock_first'
    | 'defined_order'
    | null;

  @Property({ type: 'json', nullable: true })
  fulfilmentStrategyWarehouseOrder?: string[] | null;

  // ── feature 056: organization hierarchy ────────────────────────────────

  /**
   * Nullable self-referential parent (`parent_id`). NULL ⇒ this org is a root.
   * The FK (`REFERENCES organizations(id) ON DELETE RESTRICT`) is enforced at
   * the DB level (migration 097); writes go through the tree Commands only, so
   * `path` and cycle/depth invariants stay consistent.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  parentId?: string | null;

  /**
   * Materialized ancestor-chain path `'/<rootId>/…/<thisId>/'`. Backfilled to
   * `'/<id>/'` (a root) for every pre-feature org. A `text_pattern_ops` prefix
   * index backs single-query subtree (`path LIKE :selfPath || '%'`) traversal.
   *
   * **Never empty on a stored row.** The `''` below is only what a new instance
   * holds until it is inserted: {@link assignRootPath} writes the root path on
   * create, and the tree Commands rewrite it on a re-parent. An empty path is
   * not "no path", it is the prefix of every path — `'' || '%'` matches every
   * organization on the platform and `x.startsWith('')` is true for every `x`
   * — so a row keeping it reads as the ancestor of everything.
   */
  @Property({ type: 'text' })
  path: string = '';

  /**
   * Per-org platform-admin override of the credit-inheritance mode. NULL ⇒ use
   * the Settings global default. Set only through the `organization.set_credit_mode`
   * Command (platform-admin gated).
   */
  @Property({ type: 'string', length: 20, nullable: true })
  creditInheritanceMode?: 'shared_pool' | 'independent_default' | null;

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

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // ── lifecycle hooks ────────────────────────────────────────────────────

  @BeforeCreate()
  @BeforeUpdate()
  syncNameSearch(_args: EventArgs<Organization>): void {
    this.nameSearch = normalizeOrganizationName(this.name);
  }

  /**
   * A new organization is a root, and a root's path is `'/<id>/'`.
   *
   * On the entity rather than in each creator because there are several —
   * company registration, the personal organization a B2C account gets, the
   * demo seed, every test fixture — and none of them is about the tree. Each
   * one that forgot left a row with the column's `''` default, which the tree
   * service reads as the prefix of every path: its subtree was every
   * organization, and every re-parent involving it refused as a cycle.
   *
   * Only an empty path is filled, so a creator that knows better is left alone,
   * and only for a row with no parent: a child's path depends on its parent's,
   * which is the tree Commands' to compute (`applyReparentPaths`).
   *
   * The database derives `root_id` (the path's first segment) from it as a
   * stored generated column, which this class deliberately does not map
   * (`specs/177-tax-id-scope/` research R-2).
   */
  /**
   * `specs/177-tax-id-scope/` D-290 / OD-11 — the tax ID is stored in its
   * canonical form (`normalizeTaxId`: whitespace and dashes removed,
   * upper-cased), whichever creator wrote it, because the scope's constraints
   * compare stored text. `organizations_tax_id_normalised` refuses any other
   * form from a writer that bypasses the entity.
   */
  @BeforeCreate()
  @BeforeUpdate()
  normalizeTaxIdForStorage(_args?: EventArgs<Organization>): void {
    if (typeof this.taxId === 'string') this.taxId = normalizeTaxId(this.taxId);
  }

  @BeforeCreate()
  assignRootPath(_args?: EventArgs<Organization>): void {
    if (this.path === '' && (this.parentId === undefined || this.parentId === null)) {
      this.path = `/${this.id}/`;
    }
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

/** `gus_pl` — feature 173: the GUS REGON registry, written by a registration-time lookup. */
export type VatValidationProvider = 'vies' | 'mf_pl' | 'format_only' | 'gus_pl';

export type VatValidationOutcome = 'validated' | 'failed' | 'deferred' | 'unverified';
