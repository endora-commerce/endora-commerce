import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * CustomerAccount — a user inside an Organization. One email ⇒ at most one
 * CustomerAccount installation-wide (FR-041).
 *
 * `passwordHash` is an argon2id-derived key (see services/password-hasher.ts
 * in the auth module). `twoFactorSecret` holds the base32 TOTP secret only
 * once 2FA is confirmed.
 */
@Entity({ tableName: 'customer_accounts' })
export class CustomerAccount {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'role'
    | 'emailVerifiedAt'
    | 'twoFactorSecret'
    | 'twoFactorConfirmedAt'
    | 'lastLoginAt'
    | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 512 })
  passwordHash!: string;

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

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
