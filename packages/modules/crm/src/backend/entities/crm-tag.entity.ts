import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A tag an Opportunity may carry. Names are unique case-insensitively, by a
 * unique index on `lower(name)` the migration creates.
 */
@GlobalEntity()
@Entity({ tableName: 'crm_tags' })
export class CrmTag {
  [OptionalProps]?: 'id' | 'color' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  name!: string;

  @Property({ type: 'string', length: 16 })
  color: string = '#64748b';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
