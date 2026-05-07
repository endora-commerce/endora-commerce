import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * AdminUser — a Supplier employee with platform-side access. Distinct entity
 * from CustomerAccount (FR-040 — different login surface, different sessions,
 * own permission matrix via AdminRole).
 */
@Entity({ tableName: 'admin_users' })
export class AdminUser {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'adminRoleId'
    | 'twoFactorSecret'
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

  @Property({ type: 'string', length: 64, nullable: true })
  twoFactorSecret?: string | null;

  @Property({ type: 'datetime', nullable: true })
  twoFactorConfirmedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  lastLoginAt?: Date | null;

  /**
   * Admin UI preferred language — feature 019. NULL means "no preference
   * saved", which the resolver treats as the platform default (English).
   * The column is bounded by the `SupportedAdminLanguageSchema` allowlist
   * in `@b2b/contracts/src/admin-i18n.ts`; the validation lives at the
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
