import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/** NewsletterCustomField — feature 048. Operator-defined subscriber attribute. */
@Entity({ tableName: 'newsletter_custom_fields' })
export class NewsletterCustomField {
  [OptionalProps]?: 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  key!: string;

  @Property({ type: 'string', length: 160 })
  label!: string;

  @Property({ type: 'string', length: 16 })
  type!: 'text' | 'number' | 'boolean' | 'date';

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
