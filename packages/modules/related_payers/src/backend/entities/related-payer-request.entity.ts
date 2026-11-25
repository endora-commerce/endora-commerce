import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { randomUUID } from 'crypto';
import type {
  RelatedPayerApprovalMode,
  RelatedPayerOperatorReason,
  RelatedPayerRequestDirection,
  RelatedPayerRequestRouting,
  RelatedPayerRequestState,
  RelatedPayerUnregisteredMode,
} from '@endora-commerce/contracts';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * A payer request or payer invitation, owned by its **sender** (`organizationId`)
 * (`specs/182-related-payers/` data-model §2). The counterparty's side reads it under
 * `withSystemScope`, constrained by `counterpartyOrganizationId` (research R-5).
 *
 * Created with the module's schema in Phase 1; written from Phase 5 (US4) on.
 */
@OrgScoped()
@Entity({ tableName: 'related_payer_requests' })
export class RelatedPayerRequest {
  [OptionalProps]?:
    | 'id'
    | 'comment'
    | 'counterpartyOrganizationId'
    | 'operatorReason'
    | 'state'
    | 'counterpartyAcceptedAt'
    | 'decidedAt'
    | 'decidedByKind'
    | 'decidedById'
    | 'rejectionReason'
    | 'linkId'
    | 'invitationTokenHash'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'string', length: 24 })
  direction!: RelatedPayerRequestDirection;

  @Property({ type: 'uuid' })
  senderCustomerAccountId!: string;

  @Property({ type: 'string', length: 32 })
  taxIdNormalized!: string;

  @Property({ type: 'string', length: 320 })
  contactEmail!: string;

  @Property({ type: 'text', nullable: true })
  comment: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  counterpartyOrganizationId: string | null = null;

  @Property({ type: 'string', length: 24 })
  routing!: RelatedPayerRequestRouting;

  @Property({ type: 'string', length: 32, nullable: true })
  operatorReason: RelatedPayerOperatorReason | null = null;

  @Property({ type: 'string', length: 24 })
  approvalMode!: RelatedPayerApprovalMode;

  @Property({ type: 'string', length: 8 })
  unregisteredMode!: RelatedPayerUnregisteredMode;

  @Property({ type: 'string', length: 16 })
  state: RelatedPayerRequestState = 'pending';

  @Property({ type: 'datetime', nullable: true })
  counterpartyAcceptedAt: Date | null = null;

  @Property({ type: 'datetime', nullable: true })
  decidedAt: Date | null = null;

  @Property({ type: 'string', length: 16, nullable: true })
  decidedByKind: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  decidedById: string | null = null;

  @Property({ type: 'text', nullable: true })
  rejectionReason: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  linkId: string | null = null;

  @Property({ type: 'uuid' })
  salesChannelId!: string;

  @Property({ type: 'string', length: 8 })
  language!: string;

  @Property({ type: 'string', length: 128, nullable: true })
  invitationTokenHash: string | null = null;

  @Property({ type: 'datetime' })
  expiresAt!: Date;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
