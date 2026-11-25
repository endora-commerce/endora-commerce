import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type AssetObjectCleanupReason = 'staging' | 'previous' | 'superseded' | 'purge';

/**
 * A storage object still to be deleted (`specs/156-asset-stable-url/data-model.md`
 * §1b, research R-21). Recorded before the object can become unreferenced and
 * cleared once it is gone, so a failed delete is retried by the sweep instead of
 * leaving an orphan behind. One row per `(storageBackend, locator)`.
 * `assetId` is for logs only; there is no foreign key.
 */
@GlobalEntity()
@Entity({ tableName: 'asset_object_cleanups' })
export class AssetObjectCleanup {
  [OptionalProps]?: 'id' | 'assetId' | 'recordedAt' | 'attempts' | 'lastError';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 8 })
  storageBackend!: 'local' | 's3' | 'gcs';

  @Property({ type: 'string', length: 2048 })
  locator!: string;

  @Property({ type: 'string', length: 16 })
  reason!: AssetObjectCleanupReason;

  @Property({ type: 'uuid', nullable: true })
  assetId?: string | null;

  @Property({ type: 'datetime' })
  recordedAt: Date = new Date();

  @Property({ type: 'integer' })
  attempts: number = 0;

  @Property({ type: 'text', nullable: true })
  lastError?: string | null;
}
