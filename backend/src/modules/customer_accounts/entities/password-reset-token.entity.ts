import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * One-shot password-reset token. Same shape as EmailVerificationToken — sha256
 * hash stored, expires_at + consumed_at one-shot. Issued by the public
 * /auth/password-reset/request endpoint.
 */
@Entity({ tableName: 'password_reset_tokens' })
export class PasswordResetToken {
  [OptionalProps]?: 'id' | 'createdAt' | 'consumedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'string', length: 128 })
  @Unique()
  tokenHash!: string;

  @Property({ type: 'datetime' })
  @Index()
  expiresAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  consumedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
