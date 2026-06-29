import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * EmailBlock — feature 047 (US3). A reusable, email-safe content fragment
 * embedded by code via the EmailInsertBlock component. May be global (no bridge
 * rows = available to all channels) or channel-scoped (via
 * email_block_sales_channels). System blocks (default header/footer) cannot be
 * deleted.
 */
@Entity({ tableName: 'email_blocks' })
export class EmailBlock {
  [OptionalProps]?: 'active' | 'isSystem' | 'description' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 180 })
  @Index()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description: string | null = null;

  @Property({ type: 'boolean' })
  active: boolean = true;

  /** Content envelope: { schema_version, languages: { lang: tree } }. */
  @Property({ type: 'json' })
  content!: Record<string, unknown>;

  @Property({ type: 'json' })
  languages!: string[];

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
