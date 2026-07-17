import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * CmsHookBlockAttachment — orderable many-to-many between Hooks and
 * Blocks. The composite PK (hookId, blockId) prevents the same Block
 * from being attached twice to the same Hook; `position` drives the
 * storefront's render order (ASC).
 */
@GlobalEntity()
@Entity({ tableName: 'cms_hook_block_attachments' })
export class CmsHookBlockAttachment {
  [OptionalProps]?: 'createdAt' | 'position';

  @PrimaryKey({ type: 'uuid' })
  hookId!: string;

  @PrimaryKey({ type: 'uuid' })
  blockId!: string;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
