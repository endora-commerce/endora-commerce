import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * AttributeSet — named container of Product Attributes (feature 002,
 * data-model.md §2.1).
 *
 * Every Product MUST point at exactly one AttributeSet via
 * `Product.attributeSetId`. The system **Default** set has the
 * deterministic UUID `00000000-0000-0000-0000-0000000a5e70` and
 * `isSystem=true`; it cannot be deleted, and its `code` cannot be
 * renamed (the localized `name` and `description` may be edited).
 */
@GlobalEntity()
@Entity({ tableName: 'attribute_sets' })
export class AttributeSet {
  [OptionalProps]?: 'id' | 'description' | 'isSystem' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'json', nullable: true })
  description?: Record<string, string> | null;

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
