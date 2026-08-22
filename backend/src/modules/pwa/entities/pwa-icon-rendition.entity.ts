import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';
import type { PwaIconPurpose } from '@endora-commerce/contracts';

/**
 * PwaIconRendition (feature 046, US2). A derived icon size for a channel's PWA
 * identity, produced by `sharp` from the admin-uploaded source. `salesChannelId`
 * null = global default identity; non-null = per-channel override (FR-011).
 * `(salesChannelId, size, purpose)` is unique (NULLS NOT DISTINCT for the global
 * row — enforced in migration 080).
 */
@GlobalEntity()
@Entity({ tableName: 'pwa_icon_renditions' })
@Unique({ properties: ['salesChannelId', 'size', 'purpose'] })
export class PwaIconRendition {
  [OptionalProps]?: 'id' | 'createdAt' | 'salesChannelId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'uuid' })
  sourceAssetId!: string;

  @Property({ type: 'integer' })
  size!: number;

  @Property({ type: 'string', length: 16 })
  purpose!: PwaIconPurpose;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'string', length: 64 })
  contentHash!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
