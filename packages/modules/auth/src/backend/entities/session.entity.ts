import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Persistent session row. Backed by Postgres; hot reads are cached in Redis by
 * SessionService. See data-model.md § Domain 1 and R-11.
 *
 * `auth` is the permitted singular-exception module folder per Principle VI; this
 * entity's table name remains `sessions` because class-to-table is still pluralised.
 */
@GlobalEntity()
@Entity({ tableName: 'sessions' })
export class Session {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt';


  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** Opaque token shown to the client (cookie value). Never used for lookups directly —
   *  we hash it before storing. The actual cookie sent to the client is `${id}.${tokenHash}`. */
  @Property({ type: 'string', length: 128 })
  @Index()
  tokenHash!: string;

  /** Null for admin-user sessions; set for customer-account sessions. */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  /** Null for customer sessions; set for admin-user sessions. */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  adminUserId?: string | null;

  /**
   * When an admin-user is impersonating a customer, both `customerAccountId` (target)
   * and `impersonatorAdminUserId` (the admin) are set — see R-12.
   */
  @Property({ type: 'uuid', nullable: true })
  impersonatorAdminUserId?: string | null;

  @Property({ type: 'datetime' })
  @Index()
  expiresAt!: Date;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  lastSeenAt?: Date | null;

  @Property({ type: 'string', length: 45, nullable: true })
  ipAddress?: string | null;

  @Property({ type: 'string', length: 255, nullable: true })
  userAgent?: string | null;
}
