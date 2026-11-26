import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * An administrator's daily digest (research R-18): sent at `hour` in
 * `tasks.time_zone`; no row means off (Q3 = A). `lastSentOn` is the day's
 * claim, so a day's digest is sent once. A per-administrator row.
 */
@GlobalEntity()
@Entity({ tableName: 'task_digest_subscriptions' })
export class TaskDigestSubscription {
  [OptionalProps]?: 'lastSentOn' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  adminUserId!: string;

  /** 0–23. */
  @Property({ type: 'smallint' })
  hour!: number;

  @Property({ type: 'date', nullable: true })
  lastSentOn?: string | null;

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
