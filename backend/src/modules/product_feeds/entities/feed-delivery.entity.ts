import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import type { FeedDeliveryHttpLabel, FeedDeliveryProtocol } from '@b2b/contracts';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';

/**
 * FeedDelivery — feature 070 / plan.md § Data model, FR-100 – FR-101.
 *
 * Where a feed's published artefact is pushed, and by what protocol. At most one
 * row per feed: the unique index on `product_feed_id` is what enforces FR-100,
 * rather than a service-level check that two concurrent writes could both pass.
 *
 * **The secrets are not here.** `credentialCode` points at a configuration owned
 * by the `credentials` module, which gives this row AES-256-GCM at rest, masking
 * on every read and the "never returned in full over HTTP" guarantee with no
 * crypto of this module's own (FR-107). The same shape `pim_ergonode` uses — a
 * varchar code, not a foreign key, because a credential is addressed by its
 * stable code and deleting one should produce the credentials module's own
 * `CREDENTIAL_IN_USE` sentence rather than a constraint violation.
 *
 * The columns are **nullable per protocol** rather than a JSONB blob: the shape
 * differs by three fixed protocols, not by an open set, and these values are
 * read and validated individually. `upsertFeedDeliveryRequestSchema` is a
 * discriminated union, so an invalid combination is unrepresentable at the API
 * boundary even though the table is permissive.
 *
 * Tenancy: `@GlobalEntity()` — a feed belongs to the installation, not to an
 * organization, and so does its delivery target.
 */
@GlobalEntity()
@Entity({ tableName: 'product_feed_deliveries' })
@Unique({ properties: ['productFeedId'] })
export class FeedDelivery {
  [OptionalProps]?:
    | 'id'
    | 'enabled'
    | 'passiveMode'
    | 'headers'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'product_feed_id' })
  productFeedId!: string;

  /** FR-101 — a target can be configured now and switched on later. */
  @Property({ type: 'boolean', fieldName: 'enabled' })
  enabled: boolean = false;

  @Property({ type: 'varchar', length: 16, fieldName: 'protocol' })
  protocol!: FeedDeliveryProtocol;

  /** Presentation only, and only for `http`: HTTP Server / API / GraphQL. */
  @Property({ type: 'varchar', length: 32, fieldName: 'http_label', nullable: true })
  httpLabel?: FeedDeliveryHttpLabel | null;

  @Property({ type: 'varchar', length: 255, fieldName: 'host', nullable: true })
  host?: string | null;

  /** Null means the protocol's own default — 22 for SFTP, 21 for FTP. */
  @Property({ type: 'integer', fieldName: 'port', nullable: true })
  port?: number | null;

  @Property({ type: 'varchar', length: 255, fieldName: 'username', nullable: true })
  username?: string | null;

  @Property({ type: 'varchar', length: 1024, fieldName: 'directory_path', nullable: true })
  directoryPath?: string | null;

  /** FTP only. Passive is the mode that works from behind NAT, so it is the default. */
  @Property({ type: 'boolean', fieldName: 'passive_mode' })
  passiveMode: boolean = true;

  @Property({ type: 'text', fieldName: 'request_url', nullable: true })
  requestUrl?: string | null;

  /**
   * `http` only, and **non-secret headers only**. A header whose name matches
   * `isSecretDeliveryHeader` never reaches this column — its value lives in the
   * credential alongside the password (FR-107).
   */
  @Property({ type: 'json', fieldName: 'headers' })
  headers: Record<string, string> = {};

  /** The credentials-module configuration holding password / key / secret headers. */
  @Property({ type: 'varchar', length: 64, fieldName: 'credential_code' })
  credentialCode!: string;

  @Property({ type: 'integer', fieldName: 'version' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date(), fieldName: 'created_at' })
  createdAt: Date = new Date();

  @Property({
    type: 'datetime',
    onCreate: () => new Date(),
    onUpdate: () => new Date(),
    fieldName: 'updated_at',
  })
  updatedAt: Date = new Date();
}
