import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Megamenu — a named navigation configuration. Per `data-model.md`, the
 * configuration row carries no `active` column; activation lives on the
 * binding rows so a megamenu can be staged in many scopes and made
 * active in some without an inconsistent flag pair.
 */
@GlobalEntity()
@Entity({ tableName: 'megamenus' })
export class Megamenu {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'description' | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
