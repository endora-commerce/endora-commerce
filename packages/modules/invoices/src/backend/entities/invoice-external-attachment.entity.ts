import {
  Entity,
  Index,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/**
 * Metadata for a source-system attachment linked to an ERP-imported sale
 * document. Bytes are stored in `assets_library` on first download (feature
 * 119, FR-086). `externalAttachmentId` is the attachment's id in the source
 * system, unique within its document (feature 134, T135).
 */
@TransitivelyScoped('Invoice', 'invoiceId')
@Entity({ tableName: 'invoice_external_attachments' })
@Unique({
  name: 'invoice_external_attachments_invoice_external_uq',
  properties: ['invoiceId', 'externalAttachmentId'],
})
export class InvoiceExternalAttachment {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'contentType'
    | 'assetId'
    | 'downloadedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  invoiceId!: string;

  @Property({ type: 'string', length: 128 })
  externalAttachmentId!: string;

  @Property({ type: 'string', length: 256 })
  fileName!: string;

  @Property({ type: 'string', length: 128, nullable: true })
  contentType?: string | null;

  @Property({ type: 'uuid', nullable: true })
  assetId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  downloadedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
