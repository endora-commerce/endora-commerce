import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * AttachmentType — global dictionary of attachment categories
 * (Certificate, Tech Spec, Product Card, …) shared across all
 * Products. Feature 002 US3, data-model.md §2.5.
 */
@Entity({ tableName: 'attachment_types' })
export class AttachmentType {
  [OptionalProps]?: 'id' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
