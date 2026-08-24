import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { OrgScoped } from '@endora-commerce/platform/tenancy';

/**
 * One row per return case whose settlement has credited this organization
 * (D-91).
 *
 * The settlement ordering law attempts every external effect before it writes
 * any state, so a refusal from a later step leaves a retryable case — and the
 * retry calls `creditFromReturn` again with the same `returnCaseId`. Without
 * this row the second call reads the grant and adds to it a second time, which
 * is money. `returnCaseId` is unique, and the credit and the row are written in
 * one Command, so either the organization is credited and the fact is recorded
 * or neither happened.
 *
 * `returnCaseId` carries **no** foreign key on purpose: it is a key this module
 * is handed, not a row it may read. `returns` depends on `credit_limits`, and a
 * constraint the other way would invert that and put `returns` in this module's
 * manifest `dependencies`.
 */
@OrgScoped()
@Entity({ tableName: 'credit_limit_return_topups' })
export class CreditLimitReturnTopup {
  [OptionalProps]?: 'id' | 'appliedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** The settling return case. Opaque here — see the class comment. */
  @Property({ type: 'uuid' })
  @Unique()
  returnCaseId!: string;

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  appliedAt: Date = new Date();
}
