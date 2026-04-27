import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Asset — file in the Assets Catalog (FR-007). Owns its own module per
 * Principle I; linked from products via `product_assets` M:N and from CMS
 * pages via `cms_page_assets` (when the CMS module lands).
 */
@Entity({ tableName: 'assets' })
export class Asset {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'altText' | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 16 })
  @Index()
  kind!: 'image' | 'video' | 'pdf' | 'certificate' | 'other';

  @Property({ type: 'string', length: 255 })
  filename!: string;

  @Property({ type: 'string', length: 127 })
  mimeType!: string;

  @Property({ type: 'bigint' })
  sizeBytes!: string;

  @Property({ type: 'string', length: 2048 })
  storageUrl!: string;

  @Property({ type: 'json', nullable: true })
  altText?: Record<string, string> | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
