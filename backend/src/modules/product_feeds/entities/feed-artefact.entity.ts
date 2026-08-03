import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/** `feed` is the generated file itself; `issues` is the full issue export (FR-054). */
export type FeedArtefactKind = 'feed' | 'issues';

/** Recorded per artefact so a later backend switch still resolves old files. */
export type FeedArtefactStorageBackend = 'local' | 's3' | 'gcs';

/**
 * FeedArtefact — feature 067 / data-model.md §7.
 *
 * One generated file. Bytes are written with `visibility: 'private'` through
 * the Assets Library storage adapter and are never exposed by the adapter's own
 * public URL (research §R6) — the module's route streams them via
 * `adapter.open()`, so rotating the token actually revokes access.
 *
 * Retention (FR-052): after a successful publish, artefacts of the same
 * (feed, kind) beyond the newest N are deleted — object first, then row,
 * tolerating a missing object. The published artefact is never a candidate.
 *
 * Tenancy: `@GlobalEntity()` — see `feed-template.entity.ts`.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_artefacts' })
export class FeedArtefact {
  [OptionalProps]?: 'id' | 'kind' | 'itemCount' | 'producedAt' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'product_feed_id' })
  @Index()
  productFeedId!: string;

  @Property({ type: 'uuid', fieldName: 'feed_run_id' })
  feedRunId!: string;

  @Property({ type: 'varchar', length: 16, fieldName: 'kind' })
  kind: FeedArtefactKind = 'feed';

  @Property({ type: 'varchar', length: 16, fieldName: 'storage_backend' })
  storageBackend!: FeedArtefactStorageBackend;

  @Property({ type: 'varchar', length: 512, fieldName: 'storage_locator' })
  storageLocator!: string;

  @Property({ type: 'varchar', length: 127, fieldName: 'content_type' })
  contentType!: string;

  /** Measured by a pass-through counter — the adapter accepts an unknown length. */
  @Property({ type: 'bigint', columnType: 'bigint', fieldName: 'byte_size' })
  byteSize!: number;

  @Property({ type: 'integer', fieldName: 'item_count' })
  itemCount: number = 0;

  /** Computed in-stream; also the strong `ETag` candidate. */
  @Property({
    type: 'string',
    length: 64,
    columnType: 'char(64)',
    fieldName: 'checksum_sha256',
    nullable: true,
  })
  checksumSha256?: string | null;

  /** The `Last-Modified` value. */
  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'produced_at' })
  producedAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();
}
