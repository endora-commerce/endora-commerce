import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * CmsTemplate — reusable Page Builder fragment embedded in Pages by `code`
 * via the `InsertTemplate` component. Differs from CmsBlock by having no
 * `active` flag (FR-006); its visibility is governed entirely by its
 * channel/language scope and by who references it.
 */
@GlobalEntity()
@Entity({ tableName: 'cms_templates' })
export class CmsTemplate {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
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

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json' })
  content: Record<string, unknown> = { schema_version: 1, languages: {} };

  @Property({ type: 'json' })
  languages: string[] = [];

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
