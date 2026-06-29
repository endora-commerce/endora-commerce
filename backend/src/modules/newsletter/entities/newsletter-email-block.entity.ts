import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * NewsletterEmailBlock — feature 048. Reusable email-safe content fragment
 * (e.g. header/footer) embedded in campaign/automation content. Global when no
 * sales-channel bridge rows exist. System blocks cannot be deleted.
 */
@Entity({ tableName: 'newsletter_email_blocks' })
export class NewsletterEmailBlock {
  [OptionalProps]?: 'active' | 'description' | 'isSystem' | 'version' | 'createdAt' | 'updatedAt';

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
  content: Record<string, unknown> = {};

  @Property({ type: 'boolean', fieldName: 'is_system' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
