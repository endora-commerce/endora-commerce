import { Entity, Formula, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * PriceList — the **price-book header** (feature 160, D-287 P1;
 * `specs/160-pricing-model-v2/data-model.md` §1).
 *
 * A price book fixes one currency (`currency`, stored as `currency_code`), an
 * audience kind (`audienceKind`; its members are `price_list_audience_members`),
 * a channel set (the `sales_channel_price_lists` bridge, reached only through
 * `SalesChannelMembershipService`), a type (`regular` | `sale`), a schedule
 * (`startsAt`, `endsAt`, evaluated at read time) and a `priority` (the
 * same-cell tie-break). Its rows are `price_list_matrix_entries`. The system
 * rows (`isSystem`) are the per-currency **base books**; the platform default
 * currency's keeps the id the old `Default` list had (`…d51b`).
 *
 * `status` is still flipped by the sweeper for the admin; `version` moves on
 * every write of the book and `everActivated` freezes the audience kind once
 * the book has been active.
 *
 * The old model's columns — the Application rule, `code`, `is_default` and
 * `modified_at` — were dropped by the conversion migration.
 */
@RuleScoped()
@Entity({ tableName: 'price_lists' })
export class PriceList {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isSystem'
    | 'priority'
    | 'type'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'audienceKind'
    | 'version'
    | 'everActivated'
    | 'hasMatrixEntries';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 3, columnType: 'char(3)', fieldName: 'currency_code' })
  currency!: string;

  @Property({ type: 'integer' })
  priority: number = 0;

  @Property({ type: 'string', length: 8 })
  @Index()
  type: 'regular' | 'sale' = 'regular';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'active' | 'scheduled' | 'expired' = 'draft';

  @Property({ type: 'datetime', nullable: true })
  startsAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  endsAt?: Date | null;

  @Property({ type: 'string', length: 16 })
  audienceKind: 'everyone' | 'customer_groups' | 'organizations' = 'everyone';

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'integer', default: 1 })
  version: number = 1;

  @Property({ type: 'boolean', default: false })
  everActivated: boolean = false;

  @Formula(
    (alias) =>
      `exists(select 1 from "price_list_matrix_entries" pme where pme."price_list_id" = ${alias}."id")`,
  )
  hasMatrixEntries?: boolean;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
