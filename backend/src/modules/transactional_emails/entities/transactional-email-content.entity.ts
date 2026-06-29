import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * TransactionalEmailContent — feature 047 (US1/US2).
 *
 * An admin customization of an email's subject + content for one scope and
 * language. `salesChannelId === null` is the global scope; a non-null value is a
 * per-channel override. The absence of a row means "fall back" (resolution:
 * channel -> global -> module default). Reset deletes the row. `version`
 * provides optimistic concurrency. Uniqueness is enforced by two partial
 * indexes in the migration (NULLs are distinct in Postgres unique indexes).
 */
@Entity({ tableName: 'transactional_email_contents' })
export class TransactionalEmailContent {
  [OptionalProps]?: 'version' | 'salesChannelId' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'email_id' })
  emailId!: string;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 12 })
  language!: string;

  @Property({ type: 'text' })
  subject!: string;

  /** Single-language Puck data tree. */
  @Property({ type: 'json' })
  content!: Record<string, unknown>;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
