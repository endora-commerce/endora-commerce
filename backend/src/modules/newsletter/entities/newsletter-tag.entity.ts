import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/** NewsletterTag — feature 048. Operator-defined label for segmentation. */
@GlobalEntity()
@Entity({ tableName: 'newsletter_tags' })
export class NewsletterTag {
  [OptionalProps]?: 'description' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description: string | null = null;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
