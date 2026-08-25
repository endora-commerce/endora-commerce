import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * AdminUser — a Supplier employee with platform-side access. Distinct entity
 * from CustomerAccount (FR-040 — different login surface, different sessions,
 * own permission matrix via AdminRole).
 */
@GlobalEntity()
@Entity({ tableName: 'admin_users' })
export class AdminUser {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'adminRoleId'
    | 'twoFactorConfirmedAt'
    | 'lastLoginAt'
    | 'deletedAt'
    | 'preferredLanguage';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 512 })
  passwordHash!: string;

  @Property({ type: 'string', length: 120 })
  firstName!: string;

  @Property({ type: 'string', length: 120 })
  lastName!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  adminRoleId?: string | null;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'active' | 'inactive' = 'active';

  /**
   * Never written — this table has no writer for it at all, not even a broken
   * one. The published `twoFactorEnabled` derived from it is therefore a
   * **provably constant `false`**, while the live admin second factor is
   * `mfa`'s, over `mfa_enrolments`. So `/admin-users` reports no second factor
   * for an administrator who enrolled an hour earlier.
   *
   * Deferred deliberately, with a clock — see the twin comment on
   * `CustomerAccount.twoFactorConfirmedAt`, `specs/deferred-defects.md` and
   * `specs/087-tenant-scope-enforcement/superseded-2fa-analysis.md` §7.
   */
  @Property({ type: 'datetime', nullable: true })
  twoFactorConfirmedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  lastLoginAt?: Date | null;

  /**
   * Admin UI preferred language — feature 019. NULL means "no preference
   * saved", which the resolver treats as the platform default (English).
   * The column is bounded by the `SupportedAdminLanguageSchema` allowlist
   * in `@endora-commerce/contracts/src/admin-i18n.ts`; the validation lives at the
   * service / route boundary, not at the column level.
   */
  @Property({ type: 'string', length: 12, nullable: true })
  preferredLanguage?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
