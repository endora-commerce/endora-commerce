import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * ReturnWithdrawalStatement — issue #905 (design §4.1).
 *
 * A consumer's withdrawal statement as submitted through the withdrawal
 * function (Directive 2011/83 art. 11a): one per case, kept as the shop's
 * evidence of what the consumer sent, so it does not change when the case
 * does. Immutable after insert apart from its acknowledgement columns.
 *
 * `consumerName` and `confirmationEmail` are its only personal data, in
 * nullable columns of their own: the statement is kept after the customer is
 * anonymised, without them (owner ruling on #905, 2026-11-07).
 *
 * The table arrives with the rest of the consumer-withdrawal schema; the
 * withdrawal function that writes it comes in a later change, so nothing writes
 * a row yet.
 */
@OrgScoped()
@Entity({ tableName: 'return_withdrawal_statements' })
export class ReturnWithdrawalStatement {
  [OptionalProps]?:
    | 'id'
    | 'customerAccountId'
    | 'consumerName'
    | 'confirmationEmail'
    | 'periodEndsAt'
    | 'acknowledgementSentAt'
    | 'acknowledgementAttempts'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Unique()
  returnCaseId!: string;

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid', nullable: true })
  customerAccountId?: string | null;

  /** `withdrawal_function`, `withdrawal_function_public` or `returns_form`. */
  @Property({ type: 'string', length: 32 })
  channel!: string;

  /** The client's idempotency key: a replay answers the statement already stored. */
  @Property({ type: 'uuid' })
  @Unique()
  submissionId!: string;

  /** Server time of the confirmation: the art. 11a(4) "date and time". */
  @Property({ type: 'datetime' })
  submittedAt!: Date;

  @Property({ type: 'text', nullable: true })
  consumerName?: string | null;

  @Property({ type: 'string', length: 320, nullable: true })
  confirmationEmail?: string | null;

  /** The order's `businessId`, as a snapshot. */
  @Property({ type: 'string', length: 128 })
  orderNumber!: string;

  /** `whole_order` or `lines`. */
  @Property({ type: 'string', length: 16 })
  scope!: string;

  /** `[{ orderItemId, productName, quantity }]`, a snapshot of what was withdrawn. */
  @Property({ type: 'json' })
  lines!: Array<{ orderItemId: string; productName: string; quantity: number }>;

  @Property({ type: 'boolean' })
  withinStatutoryPeriod!: boolean;

  @Property({ type: 'datetime', nullable: true })
  periodEndsAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  acknowledgementSentAt?: Date | null;

  @Property({ type: 'integer' })
  acknowledgementAttempts: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
