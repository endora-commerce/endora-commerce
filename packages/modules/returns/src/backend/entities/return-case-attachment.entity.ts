import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { ReturnAttachmentType } from '@endora-commerce/contracts';

/**
 * ReturnCaseAttachment — a file a customer sent for a case
 * (`specs/180-off-platform-complaints/` FR-B20 – FR-B24, research R-12).
 *
 * **Tenant-scoped since feature 180.** A pending upload has no case to inherit a tenant
 * from, so the row carries its own `organization_id` (Principle XI's total
 * classification). The bytes live in the deployment's object store under
 * `returns/<organizationId>/<id>`, written through `objectStoragePort`; no media-library
 * asset exists for them.
 *
 * - *pending*: `returnCaseId` null, `expiresAt` set (24 h);
 * - *attached*: `returnCaseId` set, `expiresAt` null;
 * - legacy: `assetId` set by the removed JSON API — neither listed nor served.
 */
@OrgScoped()
@Entity({ tableName: 'return_case_attachments' })
export class ReturnCaseAttachment {
  [OptionalProps]?:
    | 'id'
    | 'returnCaseId'
    | 'returnCaseItemId'
    | 'assetId'
    | 'customerAccountId'
    | 'type'
    | 'filename'
    | 'mimeType'
    | 'sizeBytes'
    | 'storageBackend'
    | 'storageLocator'
    | 'expiresAt'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  returnCaseId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  returnCaseItemId?: string | null;

  /** Legacy link of the removed JSON API; no new row sets it. */
  @Property({ type: 'uuid', nullable: true })
  assetId?: string | null;

  /**
   * Null on a legacy row whose case had no organization, and on a guest's file
   * (`specs/181-guest-complaints/`): such a row matches no organization-scoped read.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  /** The uploader; `null` on legacy rows. */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'string', length: 24 })
  type: ReturnAttachmentType = 'other';

  @Property({ type: 'string', length: 255, nullable: true })
  filename?: string | null;

  /** The sniffed type, never the declared one. */
  @Property({ type: 'string', length: 64, nullable: true })
  mimeType?: string | null;

  @Property({ type: 'integer', nullable: true })
  sizeBytes?: number | null;

  /** `ObjectStore.code` at write time: reads and deletes go through `getForBackend`. */
  @Property({ type: 'string', length: 32, nullable: true })
  storageBackend?: string | null;

  @Property({ type: 'string', length: 512, nullable: true })
  storageLocator?: string | null;

  @Property({ type: 'datetime', nullable: true })
  expiresAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
