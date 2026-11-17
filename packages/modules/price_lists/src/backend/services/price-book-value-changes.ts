import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandActor } from '@endora-commerce/platform/commands';
import type { PriceBookAudienceKind } from '@endora-commerce/contracts';
import { randomUUID } from 'node:crypto';
import type { PriceListHeaderValues } from '../entities/price-list-value-change.entity.js';
import type { PlannedRow } from './price-book-rules.js';
import type { RowValueLine } from './price-book-row-write.js';

/**
 * A price book's own price-change history (issue #470, D-288; owner ruling
 * O-3): what a Command writes into `price_list_value_changes` and its lines,
 * in the Command's transaction. The values a history shows live here, under
 * the book's rule scope, and the audit entry points at the row by
 * `valueChangeId`.
 *
 * The header values a history holds are `name`, `priority`, the audience
 * (`{ kind, memberIds }`) and a duplicate's `amountMultiplier` — the header's
 * free text, its ordering number and whom it prices. The audience is recorded
 * with its kind (#470 stage 3, ruling 7, amending stage 2) so a reader can tell
 * organization ids from customer-group ids, and a kind change alone is an
 * audience change. Dates, status and the channel set are codes, timestamps and
 * ids of global records, which the audit entry may name itself.
 *
 * Stored shape, changed keys only: `{ name?, priority?, audience?: { kind,
 * memberIds }, amountMultiplier? }`, members sorted.
 */

/** A book's header values as a change compares them. */
export interface HeaderValues {
  name: string;
  priority: number;
  audienceKind: PriceBookAudienceKind;
  memberIds: readonly string[];
}

const sorted = (ids: readonly string[]): string[] => [...ids].sort();
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = sorted(a);
  const y = sorted(b);
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

/**
 * The header values one write changed, on both sides, holding only the keys
 * that moved; `null` when none did (the same name, priority, audience kind and
 * member set, in whatever order). An audience write names its kind and members
 * together, so `next` carries both or neither.
 */
export function headerValueChange(
  was: HeaderValues,
  next: Partial<HeaderValues>,
): { before: PriceListHeaderValues; after: PriceListHeaderValues } | null {
  const before: PriceListHeaderValues = {};
  const after: PriceListHeaderValues = {};
  if (next.name !== undefined && next.name !== was.name) {
    before['name'] = was.name;
    after['name'] = next.name;
  }
  if (next.priority !== undefined && next.priority !== was.priority) {
    before['priority'] = was.priority;
    after['priority'] = next.priority;
  }
  if (next.memberIds !== undefined || next.audienceKind !== undefined) {
    const kind = next.audienceKind ?? was.audienceKind;
    const memberIds = next.memberIds ?? was.memberIds;
    if (kind !== was.audienceKind || !sameSet(memberIds, was.memberIds)) {
      before['audience'] = { kind: was.audienceKind, memberIds: sorted(was.memberIds) };
      after['audience'] = { kind, memberIds: sorted(memberIds) };
    }
  }
  return Object.keys(after).length === 0 ? null : { before, after };
}

/** The whole header of a book a Command created — and, for a duplicate, the multiplier its rows were copied with. */
export function createdHeaderValues(book: HeaderValues & { amountMultiplier?: string }): PriceListHeaderValues {
  return {
    name: book.name,
    priority: book.priority,
    audience: { kind: book.audienceKind, memberIds: sorted(book.memberIds) },
    ...(book.amountMultiplier !== undefined ? { amountMultiplier: book.amountMultiplier } : {}),
  };
}

/** A base row's coordinate: the variant (or the product's own row) and the quantity window. */
const baseCoordinate = (row: PlannedRow): string =>
  `${row.variantId ?? ''}|${row.productId ?? ''}|${row.minQuantity}|${row.maxQuantity ?? ''}`;

/**
 * What a base-price write did to a product's rows in one base book, from the
 * rows it deleted and the rows it inserted (it keeps every row that stayed as
 * it was): a deleted and an inserted row at the same coordinate are one
 * change; the rest are removed and added. In the shape
 * {@link rowValueLines} takes.
 */
export function baseRowChanges<R extends PlannedRow>(
  removed: readonly R[],
  inserted: readonly PlannedRow[],
): { added: PlannedRow[]; changed: Array<{ before: R; after: PlannedRow }>; removed: R[] } {
  const byCoordinate = new Map<string, R[]>();
  for (const row of removed) {
    const key = baseCoordinate(row);
    byCoordinate.set(key, [...(byCoordinate.get(key) ?? []), row]);
  }
  const added: PlannedRow[] = [];
  const changed: Array<{ before: R; after: PlannedRow }> = [];
  for (const row of inserted) {
    const held = byCoordinate.get(baseCoordinate(row));
    const before = held?.shift();
    if (before) changed.push({ before, after: row });
    else added.push(row);
  }
  return { added, changed, removed: [...byCoordinate.values()].flat() };
}

/**
 * Write one price-change history row and its lines in the Command's
 * transaction, and answer its id for the audit entry's `valueChangeId` — or
 * `null`, writing nothing, when the Command changed no value. The actor is the
 * Command's; only an administrator's id is kept, so a system, PIM or API-key
 * caller leaves `actor_admin_user_id` empty.
 */
export async function recordValueChange(
  txEm: EntityManager,
  input: {
    priceListId: string;
    action: string;
    actor: CommandActor;
    headerBefore?: PriceListHeaderValues | null;
    headerAfter?: PriceListHeaderValues | null;
    lines?: readonly RowValueLine[];
  },
): Promise<string | null> {
  const lines = input.lines ?? [];
  const headerBefore = input.headerBefore ?? null;
  const headerAfter = input.headerAfter ?? null;
  if (lines.length === 0 && headerBefore === null && headerAfter === null) return null;
  // By SQL on the Command's transaction rather than through the unit of work, so
  // the history never flushes the write's own entities (up to 10 000 on an
  // import) and costs two statements whatever its size.
  const change = { id: randomUUID(), priceListId: input.priceListId, at: new Date() };
  await txEm.getConnection().execute(
    `insert into "price_list_value_changes"
       ("id", "price_list_id", "action", "actor_kind", "actor_admin_user_id", "at", "header_before", "header_after", "line_count")
     values (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?)`,
    [
      change.id,
      change.priceListId,
      input.action,
      input.actor.kind,
      input.actor.kind === 'admin' ? input.actor.actorAdminUserId : null,
      change.at.toISOString(),
      headerBefore === null ? null : JSON.stringify(headerBefore),
      headerAfter === null ? null : JSON.stringify(headerAfter),
      lines.length,
    ],
    'run',
    txEm.getTransactionContext(),
  );
  if (lines.length > 0) await insertLines(txEm, change, lines);
  return change.id;
}

/**
 * The lines of one change (`PriceListRowValueChange` rows) in **one**
 * statement, on the Command's transaction. An import or a duplicate writes up
 * to 10 000 lines; one ORM entity per line was the slowest variant in the
 * #470 Stage 2 bench (`backend/test/perf/price_lists/value-history-write.bench.ts`).
 * Most of what remains is the two foreign-key checks per line. The amounts travel as the decimal strings the rows
 * hold and are cast by PostgreSQL into the columns' own `numeric` types, so
 * nothing is rounded on the way.
 */
async function insertLines(
  txEm: EntityManager,
  change: { id: string; priceListId: string; at: Date },
  lines: readonly RowValueLine[],
): Promise<void> {
  const payload = lines.map((line, seq) => ({
    seq,
    kind: line.kind,
    variant_id: line.variantId,
    product_id: line.productId,
    category_id: line.categoryId,
    attribute_key: line.attributeKey,
    attribute_value: line.attributeValue,
    min_quantity: line.minQuantity,
    max_quantity: line.maxQuantity,
    before_price_type: line.beforePriceType,
    before_amount: line.beforeAmount,
    before_percent: line.beforePercent,
    after_price_type: line.afterPriceType,
    after_amount: line.afterAmount,
    after_percent: line.afterPercent,
  }));
  await txEm.getConnection().execute(
    `insert into "price_list_row_value_changes"
       ("change_id", "seq", "price_list_id", "at", "kind", "variant_id", "product_id", "category_id",
        "attribute_key", "attribute_value", "min_quantity", "max_quantity",
        "before_price_type", "before_amount", "before_percent", "after_price_type", "after_amount", "after_percent")
     select ?::uuid, l."seq", ?::uuid, ?::timestamptz, l."kind", l."variant_id", l."product_id", l."category_id",
            l."attribute_key", l."attribute_value", l."min_quantity", l."max_quantity",
            l."before_price_type", l."before_amount", l."before_percent", l."after_price_type", l."after_amount", l."after_percent"
       from jsonb_to_recordset(?::jsonb) as l(
         "seq" integer, "kind" text, "variant_id" uuid, "product_id" uuid, "category_id" uuid,
         "attribute_key" text, "attribute_value" text, "min_quantity" integer, "max_quantity" integer,
         "before_price_type" text, "before_amount" numeric, "before_percent" numeric,
         "after_price_type" text, "after_amount" numeric, "after_percent" numeric)`,
    [change.id, change.priceListId, change.at.toISOString(), JSON.stringify(payload)],
    'run',
    txEm.getTransactionContext(),
  );
}

