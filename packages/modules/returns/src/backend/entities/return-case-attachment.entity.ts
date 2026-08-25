import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ReturnCaseAttachment — feature 046 (US1, R9).
 *
 * Links an uploaded asset (e.g. a defect photo) to a case or a specific case
 * line. Reuses the assets library; `assetId` references `assets`.
 */
@GlobalEntity()
@Entity({ tableName: 'return_case_attachments' })
export class ReturnCaseAttachment {
  [OptionalProps]?: 'id' | 'returnCaseItemId' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  @Property({ type: 'uuid', nullable: true })
  returnCaseItemId?: string | null;

  @Property({ type: 'uuid' })
  assetId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
