import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * CustomerAccount — a user inside an Organization. One email ⇒ at most one
 * CustomerAccount installation-wide (FR-041).
 *
 * `passwordHash` is an argon2id-derived key (see services/password-hasher.ts
 * in the auth module).
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
   * The tenant that scopes this account, and the platform's single unit of
   * tenancy (Principle XI).
   *
   * **Not nullable, since D-178.** Feature 026 US2 relaxed it so the platform
   * could serve "no-org / guest-style" accounts falling back to platform
   * defaults for prices, credit limit, allowed payment and delivery methods and
   * warehouse visibility. Feature 051 replaced that design: an individual (B2C)
   * customer is backed by a single-member **personal** organisation, so the
   * guard always has a concrete tenant and there is no "no-organization"
   * scoping path. The column stayed nullable for another year and three write
   * paths went on producing NULLs — self-registration's two-flush window,
   * federated sign-in (which provisioned no organisation at all), and an admin
   * "un-assign" button. All three are closed, and the column is `NOT NULL`,
   * which is the only refusal available: MikroORM applies its tenant filter to
   * `SELECT` / `UPDATE` / `DELETE` and not to `INSERT`, so nothing in the guard
   * can stop a tenant-less row being written.
   *
   * The account and its organisation are created in **one transaction** — see
   * `CustomerAccountLifecycleWriteService.createStandalone` and the
   * federated-sign-in `autoCreate` in this module's `backend.ts`.
   */
  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

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

  /**
   * Never written. Its only non-null writer was the superseded customer 2FA
   * path, deleted with `two_factor_secret`, so the published
   * `twoFactorEnabled` derived from it is a **provably constant `false`** —
   * not merely unpopulated, and not "possibly stale". The live answer is
   * `mfa`'s `mfa_enrolments`, served as `totpActive` by
   * `GET /api/v1/account/mfa/status`.
   *
   * Deferred deliberately, with a clock: the column and the field go when the
   * five sites deriving it are repointed at `mfa`, and if that is not built
   * within a release the field is deleted instead. See
   * `specs/deferred-defects.md` and
   * `specs/087-tenant-scope-enforcement/superseded-2fa-analysis.md` §7.
   */
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
