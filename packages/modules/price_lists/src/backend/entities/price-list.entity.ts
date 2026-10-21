import { Entity, Formula, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { ApplicationRule } from '@endora-commerce/contracts';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * PriceList — feature-011 engine shape, and since feature 160 (D-287 P1) the
 * **price-book header** as well.
 *
 * A price book fixes one currency (`currency`, stored as `currency_code`), an
 * audience kind (`audienceKind`; its members are `price_list_audience_members`),
 * a channel set (the `sales_channel_price_lists` bridge, reached only through
 * `SalesChannelMembershipService`), a type (`regular` | `sale`), a schedule and
 * a `priority`. It carries **no** application rule: until the conversion
 * migration drops the column, `applicationRule === null` is what marks a row as
 * a price book rather than a list of the old engine, which reads only rows with
 * a rule. The system rows (`isSystem`) are the per-currency base books; the
 * PLN one is the old `Default` list (`…d51b`), shared by both models during the
 * transition.
 *
 * Carries lifecycle (`status`, `startsAt`, `endsAt`), type discriminator
 * (`type`), the application rule expressed as a JSONB AST, the system flag
 * marking the seeded `Default` row, and `modifiedAt` driving the resolver's
 * tie-break (FR-027).
 *
 * Legacy columns from feature 014 (`code`, `currency`, `priority`,
 * `isDefault`) are preserved for the duration of the expand→migrate→contract
 * rollout. They will be dropped by a follow-up migration once US5 wires every
 * reader through the new resolver.
 */
@RuleScoped()
@Entity({ tableName: 'price_lists' })
export class PriceList {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'modifiedAt'
    | 'isDefault'
    | 'isSystem'
    | 'priority'
    | 'type'
    | 'status'
    | 'startsAt'
    | 'endsAt'
    | 'applicationRule'
    | 'audienceKind'
    | 'hasMatrixEntries';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  // ----- Legacy columns (kept until expand→migrate→contract completes) -----

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'string', length: 200 })
  name!: string;

  /**
   * The book's currency (FR-001, immutable — FR-004). The column is
   * `currency_code` since feature 160; the property keeps its legacy name until
   * the old engine and its tests are removed.
   */
  @Property({ type: 'string', length: 3, columnType: 'char(3)', fieldName: 'currency_code' })
  currency!: string;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'integer' })
  priority: number = 0;

  // ----- Engine columns (feature 011) -------------------------------------

  /**
   * `regular` | `sale` for a price book; `base` is the old engine's name for
   * `regular`, renamed by the conversion migration (data-model §1).
   */
  @Property({ type: 'string', length: 8 })
  @Index()
  type: 'base' | 'regular' | 'sale' = 'base';

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'draft' | 'active' | 'scheduled' | 'expired' = 'draft';

  @Property({ type: 'datetime', nullable: true })
  startsAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  endsAt?: Date | null;

  /** The old engine's rule; `null` on a price book (see the class comment). */
  @Property({ type: 'json', nullable: true })
  applicationRule: ApplicationRule | null = { kind: 'all' };

  /** Feature 160 — the audience set's kind (FR-002); immutable once the book has been active. */
  @Property({ type: 'string', length: 16 })
  audienceKind: 'everyone' | 'customer_groups' | 'organizations' = 'everyone';

  @Property({ type: 'boolean' })
  isSystem: boolean = false;

  @Property({ type: 'datetime' })
  modifiedAt: Date = new Date();

  /**
   * Feature 148 — whether the list carries any price matrix entry. Computed in
   * the statement that loads the list (an index probe on
   * `price_list_matrix_entries (price_list_id, …)`), never stored, so the
   * resolver and the price-ordered listing skip the matrix read entirely for a
   * viewer whose lists carry none instead of paying one statement to learn it.
   */
  @Formula(
    (alias) =>
      `exists(select 1 from "price_list_matrix_entries" pme where pme."price_list_id" = ${alias}."id")`,
  )
  hasMatrixEntries?: boolean;

  // ----- Timestamps -------------------------------------------------------

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

/**
 * Feature 160 — a list of the **old** engine: one that carries an Application
 * rule and the legacy `base | sale` type. Until the conversion migration removes
 * the old model, both models share `price_lists`, and every read of the old
 * engine keeps to its own rows through this guard; a price book (no rule) is
 * invisible to it, and the base books are the one row both read (the PLN one is
 * the `Default` list).
 */
export type OldModelPriceList = PriceList & { applicationRule: ApplicationRule; type: 'base' | 'sale' };

export function isOldModelList(list: PriceList): list is OldModelPriceList {
  return list.applicationRule !== null && list.type !== 'regular';
}
