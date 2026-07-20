import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CmsBlock — reusable content fragment authored via the Page Builder.
 * Per-channel-unique `code`. Embeddable in Pages and Templates via the
 * `InsertBlock` component, attachable to Hooks for storefront rendering.
 */
@GlobalEntity()
@Entity({ tableName: 'cms_blocks' })
export class CmsBlock {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'active'
    | 'description'
    | 'content'
    | 'languages'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 180 })
  @Index()
  code!: string;

  @Property({ type: 'boolean' })
  active: boolean = true;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json' })
  content: Record<string, unknown> = { languages: {} };

  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
