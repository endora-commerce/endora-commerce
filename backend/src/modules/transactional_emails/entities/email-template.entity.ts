import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * EmailTemplate — feature 047 (US3). Like EmailBlock but without an `active`
 * flag (mirrors CMS templates). Embedded by code via EmailInsertTemplate.
 */
@GlobalEntity()
@Entity({ tableName: 'email_templates' })
export class EmailTemplate {
  [OptionalProps]?: 'isSystem' | 'description' | 'version' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 180 })
  @Index()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description: string | null = null;

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
