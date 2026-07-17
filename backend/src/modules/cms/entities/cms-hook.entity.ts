import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CmsHook — named storefront insertion point. The 23 seeded codes carry
 * `isSystem=true` and cannot be deleted (research R8). Admin-created
 * Hooks are fully editable + deletable. Code is globally unique (the
 * storefront contract is keyed by code) and immutable after creation.
 */
@GlobalEntity()
@Entity({ tableName: 'cms_hooks' })
export class CmsHook {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'active'
    | 'description'
    | 'isSystem'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 180 })
  @Unique()
  code!: string;

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
