import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Refund — feature 046 (US5).
 *
 * The financial outcome of a settled case: either money back (`resolutionType =
 * 'refund'`, issued through the payments domain) or store credit
 * (`resolutionType = 'credit'`). `settlementState` records whether the money
 * movement succeeded, is pending manual handling (adapter can't auto-refund), or
 * failed. `attemptNo` supports retries (1 = first).
 */
@GlobalEntity()
@Entity({ tableName: 'refunds' })
export class Refund {
  [OptionalProps]?:
    | 'id'
    | 'paymentMethodId'
    | 'externalReference'
    | 'providerDetails'
    | 'failureReason'
    | 'correctiveInvoiceId'
    | 'creditLimitTopupApplied'
    | 'attemptNo'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  /** `refund` (money) | `credit` (store credit). */
  @Property({ type: 'string', length: 16 })
  resolutionType!: 'refund' | 'credit';

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'uuid', nullable: true })
  paymentMethodId?: string | null;

  /** `issued` | `pending_manual` | `failed`. */
  @Property({ type: 'string', length: 16 })
  settlementState!: 'issued' | 'pending_manual' | 'failed';

  @Property({ type: 'string', length: 128, nullable: true })
  externalReference?: string | null;

  @Property({ type: 'json', nullable: true })
  providerDetails?: Record<string, unknown> | null;

  @Property({ type: 'text', nullable: true })
  failureReason?: string | null;

  @Property({ type: 'uuid', nullable: true })
  correctiveInvoiceId?: string | null;

  @Property({ type: 'boolean' })
  creditLimitTopupApplied: boolean = false;

  @Property({ type: 'integer' })
  attemptNo: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
