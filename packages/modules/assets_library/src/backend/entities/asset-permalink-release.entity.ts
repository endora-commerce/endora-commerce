import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

export type AssetPermalinkReleaseReason = 'changed' | 'removed' | 'purged';

/**
 * A permalink that stopped being held — changed, removed, or released by a
 * purge (`specs/156-asset-stable-url/data-model.md` §1a, research R-22).
 *
 * One row per name, keyed by its lower-case form, so the table is bounded by
 * the number of distinct permalinks ever used. Upserted on release, deleted
 * when the name is taken again. `assetId` is the last holder; there is no
 * foreign key because that asset may already have been purged.
 */
@GlobalEntity()
@Entity({ tableName: 'asset_permalink_releases' })
export class AssetPermalinkRelease {
  @PrimaryKey({ type: 'string', length: 200 })
  permalinkLower!: string;

  /** As it was typed, for messages. */
  @Property({ type: 'string', length: 200 })
  permalink!: string;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'datetime' })
  releasedAt!: Date;

  @Property({ type: 'string', length: 16 })
  reason!: AssetPermalinkReleaseReason;
}
