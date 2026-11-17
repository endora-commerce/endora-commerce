import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  ERROR_CODES,
  type AdminUserReadPort,
  type PriceBookAudienceKind,
  type PriceBookHistoryActor,
  type PriceBookHistoryAudience,
  type PriceBookHistoryChange,
  type PriceBookHistoryChangesResponse,
  type PriceBookHistoryHeader,
  type PriceBookHistoryLine,
  type PriceBookHistoryLinesResponse,
  type PriceBookHistoryProductLine,
  type PriceBookHistoryProductLinesResponse,
  type PriceBookHistoryQuery,
  type PriceBookRowPrice,
} from '@endora-commerce/contracts';
import { HttpError, decodeCursor, encodeCursor } from '@endora-commerce/platform/http';
import type { PriceBookReads } from './price-book-reads.js';
import type { PriceBookScope } from './price-book-scope.js';

/**
 * The reader over a price book's own price-change history — issue #470
 * (D-288; owner ruling O-3), stage 3 (architect rulings 2026-11-17).
 *
 * The store (`price_list_value_changes` and its lines) is read directly, not
 * through the audit log: it was built to be read on its own (the actor kept,
 * its own keyset indexes), and the audit log would cap a history at 500
 * entries. It holds value changes only; status, channels and activation stay
 * in the audit log.
 *
 * - **Scope.** The book is loaded through the same scoped path as
 *   `GET /price-books/:id` (`PriceBookReads.header`, `bookVisible`), so a book
 *   out of the caller's reach answers as an unknown one; every statement below
 *   then filters by that book's id. Both tables are `@RuleScoped` with no
 *   global filter, which is why they are read only that way.
 * - **Keyset paging**, `{ data, pagination: { cursor, hasMore, limit } }`: a
 *   history grows at its head. The cursor carries the stored `at` at the
 *   column's own (microsecond) precision, so ties on `at` page by id.
 * - **Plain SQL on a fresh EntityManager**, never the writer's identity map.
 *   Amounts travel as the stored `numeric` text, never rounded.
 * - **Organization ids a scoped reader may not see** are dropped from each
 *   side's audience and counted in `withheldMemberCount` (ruling 5).
 * - **Actors** are resolved once per page of distinct admin ids (ruling 3).
 *
 * Ids only: labels are stage 4's.
 */

export interface PriceBookHistoryDeps {
  emFactory: () => EntityManager;
  reads: Pick<PriceBookReads, 'header'>;
  adminUsers: Pick<AdminUserReadPort, 'findByIds'>;
}

interface ChangeRow {
  id: string;
  action: string;
  actor_kind: string;
  actor_admin_user_id: string | null;
  at_key: string;
  header_before: unknown;
  header_after: unknown;
  line_count: number | string;
}

interface LineRow {
  change_id: string;
  seq: number | string;
  kind: PriceBookHistoryLine['kind'];
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  attribute_key: string | null;
  attribute_value: string | null;
  min_quantity: number | string;
  max_quantity: number | string | null;
  before_price_type: string | null;
  before_amount: string | null;
  before_percent: string | null;
  after_price_type: string | null;
  after_amount: string | null;
  after_percent: string | null;
  at_key: string;
}

interface ProductLineRow extends LineRow {
  action: string;
  actor_kind: string;
  actor_admin_user_id: string | null;
}

/** `at` as the column holds it, in UTC to the microsecond — what a cursor compares against. */
const AT_KEY = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

const LINE_COLUMNS = `l."change_id", l."seq", l."kind", l."variant_id", l."product_id", l."category_id",
  l."attribute_key", l."attribute_value", l."min_quantity", l."max_quantity",
  l."before_price_type", l."before_amount"::text as "before_amount", l."before_percent"::text as "before_percent",
  l."after_price_type", l."after_amount"::text as "after_amount", l."after_percent"::text as "after_percent",
  ${AT_KEY('l."at"')} as "at_key"`;

const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const changeCursor = z.object({ at: z.string().regex(AT_PATTERN), id: z.string().regex(UUID_PATTERN) }).strict();
const lineCursor = z.object({ seq: z.number().int().nonnegative() }).strict();
const productCursor = z
  .object({ at: z.string().regex(AT_PATTERN), changeId: z.string().regex(UUID_PATTERN), seq: z.number().int().nonnegative() })
  .strict();

function readCursor<T>(schema: z.ZodType<T>, cursor: string | undefined): T | null {
  if (cursor === undefined) return null;
  const decoded = decodeCursor(cursor);
  let parsed: unknown;
  try {
    parsed = decoded === undefined ? undefined : JSON.parse(decoded);
  } catch {
    parsed = undefined;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'cursor: not a cursor this list answered.', [
      { path: 'cursor', issue: 'not a cursor this list answered' },
    ]);
  }
  return result.data;
}

const writeCursor = (value: Record<string, unknown>): string => encodeCursor(JSON.stringify(value));

const iso = (atKey: string): string => new Date(atKey).toISOString();

function priceOf(type: string | null, amount: string | null, percent: string | null): PriceBookRowPrice | null {
  if (type === 'fixed' && amount !== null) return { type: 'fixed', amount };
  if (type === 'amount' && amount !== null) return { type: 'amount', amount };
  if (type === 'percent' && percent !== null) return { type: 'percent', percent };
  return null;
}

function lineOf(row: LineRow): PriceBookHistoryLine {
  return {
    seq: Number(row.seq),
    kind: row.kind,
    selection: {
      variantId: row.variant_id,
      productId: row.product_id,
      categoryId: row.category_id,
      attributeKey: row.attribute_key,
      attributeValue: row.attribute_value,
    },
    minQuantity: Number(row.min_quantity),
    maxQuantity: row.max_quantity === null ? null : Number(row.max_quantity),
    before: priceOf(row.before_price_type, row.before_amount, row.before_percent),
    after: priceOf(row.after_price_type, row.after_amount, row.after_percent),
  };
}

const AUDIENCE_KINDS: readonly PriceBookAudienceKind[] = ['everyone', 'customer_groups', 'organizations'];
const ACTOR_KINDS: ReadonlyArray<PriceBookHistoryActor['kind']> = ['admin', 'customer', 'system', 'api_key'];

/**
 * One stored side of a header, as a reader in `scope` may see it: only the keys
 * the history records, and the audience with the organization ids outside a
 * scoped reader's reach withheld and counted. A stored audience without a kind
 * (written before ruling 7, on development databases only) is read as
 * `organizations`, so it fails closed.
 */
export function headerForReader(stored: unknown, scope: PriceBookScope): PriceBookHistoryHeader | null {
  if (stored === null || typeof stored !== 'object') return null;
  const raw = stored as Record<string, unknown>;
  const out: PriceBookHistoryHeader = {};
  if (typeof raw['name'] === 'string') out.name = raw['name'];
  if (typeof raw['priority'] === 'number') out.priority = raw['priority'];
  if (typeof raw['amountMultiplier'] === 'string') out.amountMultiplier = raw['amountMultiplier'];
  const audience = raw['audience'];
  if (audience !== null && typeof audience === 'object') {
    const a = audience as Record<string, unknown>;
    const kind = AUDIENCE_KINDS.includes(a['kind'] as PriceBookAudienceKind) ? (a['kind'] as PriceBookAudienceKind) : 'organizations';
    const memberIds = Array.isArray(a['memberIds']) ? a['memberIds'].filter((id): id is string => typeof id === 'string') : [];
    out.audience = audienceForReader(kind, memberIds, scope);
  }
  return out;
}

function audienceForReader(kind: PriceBookAudienceKind, memberIds: string[], scope: PriceBookScope): PriceBookHistoryAudience {
  if (scope.all) return { kind, memberIds };
  if (kind !== 'organizations') return { kind, memberIds, withheldMemberCount: 0 };
  const shown = memberIds.filter((id) => scope.inScope(id));
  return { kind, memberIds: shown, withheldMemberCount: memberIds.length - shown.length };
}

export class PriceBookHistory {
  constructor(private readonly deps: PriceBookHistoryDeps) {}

  /** `GET …/:id/price-history` — the book's changes, `(at desc, id desc)`. */
  async changes(bookId: string, query: PriceBookHistoryQuery, scope: PriceBookScope): Promise<PriceBookHistoryChangesResponse> {
    await this.deps.reads.header(bookId, scope);
    const after = readCursor(changeCursor, query.cursor);
    const params: unknown[] = [bookId];
    let keyset = '';
    if (after) {
      keyset = `and ("at", "id") < (?::timestamptz, ?::uuid)`;
      params.push(after.at, after.id);
    }
    params.push(query.limit + 1);
    const rows = (await this.deps.emFactory().execute(
      `select "id", "action", "actor_kind", "actor_admin_user_id", ${AT_KEY('"at"')} as "at_key",
              "header_before", "header_after", "line_count"
         from "price_list_value_changes"
        where "price_list_id" = ? ${keyset}
        order by "at" desc, "id" desc
        limit ?`,
      params,
    )) as ChangeRow[];
    const page = rows.slice(0, query.limit);
    const actors = await this.#actors(page);
    const data: PriceBookHistoryChange[] = page.map((row) => ({
      id: row.id,
      action: row.action,
      actor: actors(row),
      at: iso(row.at_key),
      headerBefore: headerForReader(row.header_before, scope),
      headerAfter: headerForReader(row.header_after, scope),
      lineCount: Number(row.line_count),
    }));
    const last = page[page.length - 1];
    const hasMore = rows.length > query.limit && last !== undefined;
    return {
      data,
      pagination: { cursor: hasMore ? writeCursor({ at: last.at_key, id: last.id }) : null, hasMore, limit: query.limit },
    };
  }

  /** `GET …/:id/price-history/:changeId/lines` — one change's lines, `seq` ascending; another book's change is a 404. */
  async lines(
    bookId: string,
    changeId: string,
    query: PriceBookHistoryQuery,
    scope: PriceBookScope,
  ): Promise<PriceBookHistoryLinesResponse> {
    await this.deps.reads.header(bookId, scope);
    const after = readCursor(lineCursor, query.cursor);
    const em = this.deps.emFactory();
    const owned = (await em.execute(
      `select 1 from "price_list_value_changes" where "id" = ? and "price_list_id" = ?`,
      [changeId, bookId],
    )) as unknown[];
    if (owned.length === 0) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price change not found.');
    const rows = (await em.execute(
      `select ${LINE_COLUMNS}
         from "price_list_row_value_changes" l
        where l."change_id" = ? and l."price_list_id" = ? ${after ? 'and l."seq" > ?' : ''}
        order by l."seq"
        limit ?`,
      [changeId, bookId, ...(after ? [after.seq] : []), query.limit + 1],
    )) as LineRow[];
    const page = rows.slice(0, query.limit);
    const last = page[page.length - 1];
    const hasMore = rows.length > query.limit && last !== undefined;
    return {
      data: page.map(lineOf),
      pagination: { cursor: hasMore ? writeCursor({ seq: Number(last.seq) }) : null, hasMore, limit: query.limit },
    };
  }

  /**
   * `GET …/:id/price-history/products/:productId` — the product's own lines and
   * its variants' (a variant row carries its parent's `product_id`),
   * `(at desc, change_id desc, seq asc)`. Category, attribute and all-products
   * lines name no product and are not here. The mixed directions are an
   * explicit predicate, not a row comparison.
   */
  async productLines(
    bookId: string,
    productId: string,
    query: PriceBookHistoryQuery,
    scope: PriceBookScope,
  ): Promise<PriceBookHistoryProductLinesResponse> {
    await this.deps.reads.header(bookId, scope);
    const after = readCursor(productCursor, query.cursor);
    const params: unknown[] = [bookId, productId];
    let keyset = '';
    if (after) {
      keyset = `and (l."at" < ?::timestamptz
                     or (l."at" = ?::timestamptz and (l."change_id" < ?::uuid
                                                     or (l."change_id" = ?::uuid and l."seq" > ?))))`;
      params.push(after.at, after.at, after.changeId, after.changeId, after.seq);
    }
    params.push(query.limit + 1);
    const rows = (await this.deps.emFactory().execute(
      `select ${LINE_COLUMNS}, c."action", c."actor_kind", c."actor_admin_user_id"
         from "price_list_row_value_changes" l
         join "price_list_value_changes" c on c."id" = l."change_id"
        where l."price_list_id" = ? and l."product_id" = ? ${keyset}
        order by l."at" desc, l."change_id" desc, l."seq" asc
        limit ?`,
      params,
    )) as ProductLineRow[];
    const page = rows.slice(0, query.limit);
    const actors = await this.#actors(page);
    const data: PriceBookHistoryProductLine[] = page.map((row) => ({
      ...lineOf(row),
      changeId: row.change_id,
      at: iso(row.at_key),
      action: row.action,
      actor: actors(row),
    }));
    const last = page[page.length - 1];
    const hasMore = rows.length > query.limit && last !== undefined;
    return {
      data,
      pagination: {
        cursor: hasMore ? writeCursor({ at: last.at_key, changeId: last.change_id, seq: Number(last.seq) }) : null,
        hasMore,
        limit: query.limit,
      },
    };
  }

  /**
   * The actors of one page, in one lookup of its distinct admin ids. Only an
   * `admin` actor carries an id and a name ("first last", else the e-mail; a
   * deleted admin is still found, an unknown one has no name). Every other
   * kind serves neither — #1052's writer kept the admin id for any kind.
   */
  async #actors(
    rows: ReadonlyArray<Pick<ChangeRow, 'actor_kind' | 'actor_admin_user_id'>>,
  ): Promise<(row: Pick<ChangeRow, 'actor_kind' | 'actor_admin_user_id'>) => PriceBookHistoryActor> {
    const ids = [...new Set(rows.filter((r) => r.actor_kind === 'admin' && r.actor_admin_user_id).map((r) => r.actor_admin_user_id!))];
    const names = new Map(
      (ids.length > 0 ? await this.deps.adminUsers.findByIds(ids) : []).map((admin) => [
        admin.id,
        `${admin.firstName} ${admin.lastName}`.trim() || admin.email,
      ]),
    );
    return (row) => {
      const kind = ACTOR_KINDS.includes(row.actor_kind as PriceBookHistoryActor['kind'])
        ? (row.actor_kind as PriceBookHistoryActor['kind'])
        : 'system';
      if (kind !== 'admin' || !row.actor_admin_user_id) return { kind, id: null, name: null };
      return { kind, id: row.actor_admin_user_id, name: names.get(row.actor_admin_user_id) ?? null };
    };
  }
}
