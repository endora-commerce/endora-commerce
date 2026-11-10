import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';
import type { CommandActor } from '@endora-commerce/platform/commands';

/**
 * One price-book Command that changed a value, as the book's own price-change
 * history records it (issue #470, D-288; owner ruling O-3, 2026-11-10).
 *
 * The platform audit log is not tenant-scoped, so a `price_list.*` audit entry
 * is to name what a write changed and point at this row by `valueChangeId`;
 * the values themselves live here and in this row's lines
 * ({@link PriceListRowValueChange}). A Command that changed nothing writes no
 * row. Written in the Command's own transaction, so the row and its audit entry
 * commit or roll back together.
 *
 * `headerBefore` / `headerAfter` hold only the header values the Command
 * changed — `name`, `priority`, `audience.memberIds`, and on a duplicate the
 * `amountMultiplier` — and are `null` when it changed none. The actor is kept
 * here so the history answers "who" without a join into the audit log, which is
 * read under another permission and holds no index on its state.
 *
 * **`@RuleScoped()`**, as the book is: a chain to `PriceList` cannot be
 * declared transitively (a `rule` terminus is refused), so the store has no
 * global filter and is read only by the id of a book already loaded under the
 * caller's price-book scope. The rows go with their book (`on delete cascade`):
 * a deleted book takes its history with it (owner ruling, 2026-11-10).
 *
 * Indexed `(price_list_id, at desc, id desc)` for a book's history read newest
 * first by keyset. The index is the migration's alone: the module's schema is
 * written by its migrations, and the descending order is not one an `@Index`
 * declaration here would state.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_value_changes' })
export class PriceListValueChange {
  [OptionalProps]?: 'id' | 'actorAdminUserId' | 'at' | 'headerBefore' | 'headerAfter' | 'lineCount';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  priceListId!: string;

  /** The Command's audit action code, e.g. `price_list.rows_replace`. */
  @Property({ type: 'string', length: 48 })
  action!: string;

  @Property({ type: 'string', length: 16 })
  actorKind!: CommandActor['kind'];

  /** A platform-global id; `null` for a system, PIM or API-key caller. */
  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId: string | null = null;

  @Property({ type: 'datetime' })
  at: Date = new Date();

  @Property({ type: 'json', nullable: true })
  headerBefore: PriceListHeaderValues | null = null;

  @Property({ type: 'json', nullable: true })
  headerAfter: PriceListHeaderValues | null = null;

  /** How many lines this change holds — every one, however many a reader pages. */
  @Property({ type: 'integer' })
  lineCount: number = 0;
}

/** The changed header values of one side of a write — only the keys that changed. */
export type PriceListHeaderValues = Record<string, unknown>;
