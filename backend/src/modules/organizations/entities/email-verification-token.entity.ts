import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Email verification token — one-shot token issued on Organization registration
 * or on an email-change confirmation. The raw token is handed to the caller
 * once (in the email body); only the sha256 hash is stored, so leaked DB rows
 * cannot be replayed.
 */
@Entity({ tableName: 'email_verification_tokens' })
export class EmailVerificationToken {
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
