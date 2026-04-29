import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * ProductAttachment — per-product wrapper around an Asset (feature 002
 * US3, research.md R-9). The Asset itself is the file (storage, MIME,
 * size); this row carries the catalog-side metadata (display name,
 * type, optional description, position).
 *
 * Sharing the same Asset across multiple Products is supported — just
 * insert multiple ProductAttachment rows pointing at the same asset_id.
 */
@Entity({ tableName: 'product_attachments' })
export class ProductAttachment {
  [OptionalProps]?: 'id' | 'description' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'uuid' })
  @Index()
  attachmentTypeId!: string;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
