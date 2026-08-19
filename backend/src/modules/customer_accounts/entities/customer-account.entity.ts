import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CustomerAccount — a user inside an Organization. One email ⇒ at most one
 * CustomerAccount installation-wide (FR-041).
 *
 * `passwordHash` is an argon2id-derived key (see services/password-hasher.ts
 * in the auth module). `twoFactorSecret` holds the base32 TOTP secret only
 * once 2FA is confirmed.
 */
@OrgScoped()
@Entity({ tableName: 'customer_accounts' })
export class CustomerAccount {
  [OptionalProps]?:
    | 'customFieldValues'
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'role'
    | 'emailVerifiedAt'
    | 'passwordSetAt'
    | 'twoFactorSecret'
    | 'twoFactorConfirmedAt'
    | 'lastLoginAt'
    | 'deletedAt'
    | 'customerGroupId'
    | 'subtreeRollupEnabled'
    | 'blockedAt'
    | 'blockReason'
    | 'blockSource'
    | 'blockedByAdminUserId'
    | 'blockedByCustomerAccountId'
    | 'deletionRequestedByAdminUserId'
    | 'anonymizedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /**
   * Feature 026 US2 — relaxed to nullable so the platform can serve no-org /
   * guest-style Customer accounts that fall back to platform defaults for
   * prices, credit limit, allowed payment / delivery methods, and warehouse
   * visibility. Order placement and RFQ submission still require a
   * non-null organizationId — the order / RFQ route handlers refuse a
   * 422 when the caller has no Organization.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 512 })
  passwordHash!: string;

  /**
   * Issue #222 — when a password somebody supplied was last set on this
   * account. `null` means "no such password is on record", which covers both
   * the account federated sign-in auto-created (its hash is a random pair of
   * UUIDs nobody was told) and every row written before this column existed.
   *
   * It exists because `passwordHash` is NOT NULL for *every* account and
   * therefore answers a different question from the one that matters on a
   * security surface: whether the holder has a credential they can actually
   * use. `SocialLinkService` is the first reader — it refuses to sever an
   * account's last federated identity while this is null.
   *
   * Stamped by every write of a caller-supplied password (registration, the
   * member write port, a redeemed reset token, a self-service change) and
   * deliberately **not** by the generated hash. The anonymization sweep clears
   * it back to null with the hash it scrubs.
   */
  @Property({ type: 'datetime', nullable: true })
  passwordSetAt?: Date | null;

  @Property({ type: 'string', length: 120 })
  firstName!: string;

  @Property({ type: 'string', length: 120 })
  lastName!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  role: 'organization_admin' | 'regular_user' = 'regular_user';

  @Property({ type: 'datetime', nullable: true })
  emailVerifiedAt?: Date | null;

  @Property({ type: 'string', length: 64, nullable: true })
  twoFactorSecret?: string | null;

  @Property({ type: 'datetime', nullable: true })
  twoFactorConfirmedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  lastLoginAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;

  // ── Feature 040 (Customers) lifecycle extensions ────────────────────────

  /**
   * Direct customer→customer-group membership (FR-022). Independent of the
   * Organization's group: the effective pricing group is
   * `customerGroupId ?? organization.customerGroupId`. FK to `customer_groups`
   * (owned by price_lists), ON DELETE SET NULL.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerGroupId?: string | null;

  /**
   * Feature 056 (T032) — customer-side roll-up capability. When `true`, this
   * login sees/acts across its organization's **subtree** (the tenant scope is
   * widened from single-org to `allowed-set(subtreeIds(theirOrg))` server-side,
   * Principle XI). Default `false` ⇒ node-only (flat behavior). Set only by a
   * platform admin on the org member surface; mirrors the admin/sales-rep
   * `organizations:rollup` capability for a buyer account.
   */
  @Property({ type: 'boolean' })
  subtreeRollupEnabled: boolean = false;

  /** Non-null ⇒ the account is blocked and login is denied (FR-012/FR-016). */
  @Property({ type: 'datetime', nullable: true })
  @Index()
  blockedAt?: Date | null;

  @Property({ type: 'text', nullable: true })
  blockReason?: string | null;

  /** Who applied the block — drives unblock authority (FR-013/FR-015). */
  @Property({ type: 'string', length: 16, nullable: true })
  blockSource?: 'staff' | 'org_owner' | null;

  @Property({ type: 'uuid', nullable: true })
  blockedByAdminUserId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  blockedByCustomerAccountId?: string | null;

  /** Admin who soft-deleted the account (paired with `deletedAt`, FR-039). */
  @Property({ type: 'uuid', nullable: true })
  deletionRequestedByAdminUserId?: string | null;

  /**
   * Non-null ⇒ PII has been irreversibly scrubbed by the anonymization sweep
   * after the retention window; restore is no longer possible (FR-040).
   */
  @Property({ type: 'datetime', nullable: true })
  anonymizedAt?: Date | null;
}
