import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  adminNameLanguage,
  foldAdminName,
  priceBookAudienceKindSchema,
  priceBookSelectionKind,
  type CatalogAttributeView,
  type CatalogCategoryReadPort,
  type CatalogAttributeReadPort,
  type CatalogProductReadPort,
  type PriceBook,
  type PriceBookLine,
  type PriceBookLinesQuery,
  type PriceBookListQuery,
  type PriceBookNaturalKey,
  type PriceBookRow,
  type PriceBookRowLabels,
  type PriceBookRowsQuery,
  type PriceBookSelectionKind,
  type PriceBookSummary,
  type PriceBookVariantLine,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { attributeInactiveReason } from './attribute-eligibility.js';
import { priceOfStored, type StoredRow } from './price-book-batch.js';
import { selectionKey } from './price-book-rules.js';
import { priceBookMembership } from './price-book-membership.js';
import { audienceKindWritable, bookVisible, bookWritable, visibleBookSql, type PriceBookScope } from './price-book-scope.js';
import { pgArray } from './sql-array.js';

/**
 * The admin reads of price books — feature 160 (US7,
 * `contracts/admin-price-books-api.md`; G1–G4 of `specs/161-price-book-editor/`).
 *
 * Every read is bounded in statements, not in rows: the book list is one page
 * statement, one count and one channel-binding statement for the page; a
 * book's rows are one statement plus one batched read per kind of target the
 * labels name (products, variants, categories, attributes). A book that is
 * out of the caller's scope answers exactly as a missing one (FR-034).
 *
 * Channel bindings are read through the registered bridge's own subquery
 * (`entityIdsInChannelSubquery`, Principle XII), never by naming the table.
 */

export interface PriceBookReadsDeps {
  emFactory: () => EntityManager;
  channelBridge?: {
    entityIdsInChannelSubquery(channelId: string, entityType: 'price-list'): { sql: string; params: string[] };
  };
  catalogProductRead: Pick<CatalogProductReadPort, 'findByIds' | 'listVariantsByProductIds' | 'pageProductsByAdminName'>;
  catalogCategoryRead: Pick<CatalogCategoryReadPort, 'listAll'>;
  catalogAttributeRead: Pick<CatalogAttributeReadPort, 'listAll'>;
}

interface BookHeaderRow {
  id: string;
  name: string;
  type: string;
  status: PriceBook['status'];
  currency_code: string;
  audience_kind: PriceBook['audience']['kind'];
  priority: number;
  starts_at: Date | string | null;
  ends_at: Date | string | null;
  is_system: boolean;
  version: number;
  ever_activated: boolean;
  member_ids: string[] | null;
  member_org_ids: string[] | null;
  tier_starts: number[] | null;
  row_count: number | string;
}

const HEADER_COLUMNS = `
  l."id", l."name", l."type", l."status", l."currency_code", l."audience_kind", l."priority",
  l."starts_at", l."ends_at", l."is_system", l."version", l."ever_activated",
  array(select coalesce(m."organization_id", m."customer_group_id") from "price_list_audience_members" m
         where m."price_list_id" = l."id" order by 1) as "member_ids",
  array(select m."organization_id" from "price_list_audience_members" m
         where m."price_list_id" = l."id" and m."organization_id" is not null) as "member_org_ids",
  array(select distinct e."min_quantity" from "price_list_matrix_entries" e
         where e."price_list_id" = l."id" order by 1) as "tier_starts",
  (select count(*) from "price_list_matrix_entries" e where e."price_list_id" = l."id") as "row_count"`;

const iso = (value: Date | string | null): string | null =>
  value === null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

/** A label in the admin's language: the exact tag, a tag of the same language, else the fallback. */
export function pickLabel(labels: Record<string, string> | null | undefined, fallback: string, language: string | null): string {
  if (!labels) return fallback;
  if (language) {
    if (labels[language]) return labels[language];
    const prefix = language.split('-')[0]!.toLowerCase();
    for (const [tag, value] of Object.entries(labels)) {
      if (value && tag.split('-')[0]!.toLowerCase() === prefix) return value;
    }
  }
  if (fallback) return fallback;
  return Object.values(labels).find((v) => v.length > 0) ?? '';
}

/** A localized name: the admin's language, else English, else the first non-empty one. */
export function pickName(names: Record<string, string> | null | undefined, language: string | null, fallback: string): string {
  if (!names) return fallback;
  const tags = [language, language?.split('-')[0] ?? null, 'en', 'en-US', 'en-GB'].filter((t): t is string => !!t);
  for (const tag of tags) {
    if (names[tag]) return names[tag];
    const prefix = tag.split('-')[0]!.toLowerCase();
    for (const [key, value] of Object.entries(names)) {
      if (value && key.split('-')[0]!.toLowerCase() === prefix) return value;
    }
  }
  return Object.values(names).find((v) => v.length > 0) ?? fallback;
}

export class PriceBookReads {
  constructor(private readonly deps: PriceBookReadsDeps) {}

  #bridge() {
    if (!this.deps.channelBridge) {
      throw new Error('PriceBookReads: the channel bridge accessor is required to read channel bindings (Principle XII).');
    }
    return this.deps.channelBridge;
  }

  /** The header of one book, or a 404 for a missing, old-model or out-of-scope one. */
  async header(id: string, scope: PriceBookScope): Promise<BookHeaderRow> {
    const em = this.deps.emFactory();
    const rows = (await em.execute(
      `select ${HEADER_COLUMNS} from "price_lists" l where l."id" = ?`,
      [id],
    )) as BookHeaderRow[];
    const row = rows[0];
    if (
      !row ||
      !bookVisible(scope, {
        audienceKind: row.audience_kind,
        isSystem: row.is_system,
        organizationIds: row.member_org_ids ?? [],
      })
    ) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    }
    return row;
  }

  /** The 404 of a missing or out-of-scope book, reading only what visibility needs (161 G15). */
  async #visible(id: string, scope: PriceBookScope): Promise<void> {
    const rows = (await this.deps.emFactory().execute(
      `select l."audience_kind", l."is_system",
              array(select m."organization_id" from "price_list_audience_members" m
                     where m."price_list_id" = l."id" and m."organization_id" is not null) as "member_org_ids"
         from "price_lists" l where l."id" = ?`,
      [id],
    )) as Array<Pick<BookHeaderRow, 'audience_kind' | 'is_system' | 'member_org_ids'>>;
    const row = rows[0];
    if (!row || !bookVisible(scope, { audienceKind: row.audience_kind, isSystem: row.is_system, organizationIds: row.member_org_ids ?? [] })) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    }
  }

  /**
   * Which of these books exist for the caller (FR-034) — every one for a
   * platform administrator, one statement otherwise. A book that does not
   * exist is not in the answer either.
   */
  async visibleBookIds(ids: readonly string[], scope: PriceBookScope): Promise<Set<string>> {
    const unique = [...new Set(ids)];
    if (scope.all || unique.length === 0) return new Set(unique);
    const rows = (await this.deps.emFactory().execute(
      `select l."id", l."audience_kind", l."is_system",
              array(select m."organization_id" from "price_list_audience_members" m
                     where m."price_list_id" = l."id" and m."organization_id" is not null) as "member_org_ids"
         from "price_lists" l where l."id" = any(?::uuid[])`,
      [pgArray(unique)],
    )) as Array<Pick<BookHeaderRow, 'id' | 'audience_kind' | 'is_system' | 'member_org_ids'>>;
    return new Set(
      rows
        .filter((row) =>
          bookVisible(scope, { audienceKind: row.audience_kind, isSystem: row.is_system, organizationIds: row.member_org_ids ?? [] }),
        )
        .map((row) => row.id),
    );
  }

  async get(id: string, scope: PriceBookScope): Promise<PriceBook> {
    const header = await this.header(id, scope);
    const [bindings] = [await this.#bindings([header])];
    return bookOf(header, bindings.get(header.id) ?? [], scope);
  }

  async list(
    query: PriceBookListQuery,
    scope: PriceBookScope,
  ): Promise<{ data: PriceBookSummary[]; meta: { page: number; pageSize: number; totalCount: number; creatableAudienceKinds: PriceBook['audience']['kind'][] } }> {
    const em = this.deps.emFactory();
    const where: string[] = ['true'];
    const params: unknown[] = [];
    if (query.type?.length) {
      where.push(`l."type" = any(?::text[])`);
      params.push(pgArray(query.type));
    }
    if (query.status?.length) {
      where.push(`l."status" = any(?::text[])`);
      params.push(pgArray(query.status));
    }
    if (query.currency) {
      where.push(`l."currency_code" = ?`);
      params.push(query.currency);
    }
    if (query.channelId) {
      const bridge = this.#bridge().entityIdsInChannelSubquery(query.channelId, 'price-list');
      where.push(`l."id" in (${bridge.sql})`);
      params.push(...bridge.params);
    }
    if (query.audienceKind) {
      where.push(`l."audience_kind" = ?`);
      params.push(query.audienceKind);
    }
    if (query.memberId) {
      where.push(
        `exists (select 1 from "price_list_audience_members" fm where fm."price_list_id" = l."id"
                  and (fm."organization_id" = ?::uuid or fm."customer_group_id" = ?::uuid))`,
      );
      params.push(query.memberId, query.memberId);
    }
    if (query.search) {
      where.push(`l."name" ilike ?`);
      params.push(`%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    }
    if (query.productId) {
      where.push(
        query.variantId
          ? `exists (select 1 from "price_list_matrix_entries" pe where pe."price_list_id" = l."id" and pe."variant_id" = ?::uuid)`
          : `exists (select 1 from "price_list_matrix_entries" pe where pe."price_list_id" = l."id"
                      and pe."product_id" = ?::uuid and pe."variant_id" is null)`,
      );
      params.push(query.variantId ?? query.productId);
    }
    const scoped = visibleBookSql(scope);
    if (scoped) {
      where.push(scoped.sql);
      params.push(...scoped.params);
    }
    const clause = where.join(' and ');
    const offset = (query.page - 1) * query.pageSize;
    const rows = (await em.execute(
      `select ${HEADER_COLUMNS} from "price_lists" l where ${clause}
        order by l."is_system" desc, l."currency_code" asc, l."priority" desc, l."name" asc, l."id" asc
        limit ? offset ?`,
      [...params, query.pageSize, offset],
    )) as BookHeaderRow[];
    const counted = (await em.execute(`select count(*)::int as "n" from "price_lists" l where ${clause}`, params)) as Array<{ n: number }>;
    const n = counted[0]?.n ?? 0;
    const bindings = await this.#bindings(rows);
    const matches = query.productId ? await this.#matches(rows.map((r) => r.id), query.productId, query.variantId ?? null) : null;
    return {
      data: rows.map((row) => {
        const book = bookOf(row, bindings.get(row.id) ?? [], scope);
        return {
          id: book.id,
          name: book.name,
          type: book.type,
          status: book.status,
          currencyCode: book.currencyCode,
          audienceKind: book.audience.kind,
          priority: book.priority,
          startsAt: book.startsAt,
          endsAt: book.endsAt,
          isSystem: book.isSystem,
          version: book.version,
          tierStarts: book.tierStarts,
          channelCount: book.channels.length,
          memberCount: book.audience.memberIds.length,
          rowCount: book.rowCount,
          appliesToNoOne: book.audience.kind !== 'everyone' && book.audience.memberIds.length === 0,
          appliesNowhere: !book.isSystem && !book.channels.some((c) => !c.dormant),
          ...(matches ? { matches: matches.get(row.id) ?? [] } : {}),
          writable: book.writable,
        };
      }),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalCount: Number(n),
        // G11 — what the caller may create, from the same rule the create route applies.
        creatableAudienceKinds: priceBookAudienceKindSchema.options.filter((kind) => audienceKindWritable(scope, kind)),
      },
    };
  }

  /** The rows of the page's books that name the product (or the variant) directly (G1). */
  async #matches(bookIds: string[], productId: string, variantId: string | null): Promise<Map<string, PriceBookSummary['matches']>> {
    const out = new Map<string, NonNullable<PriceBookSummary['matches']>>();
    if (bookIds.length === 0) return out;
    const rows = (await this.deps.emFactory().execute(
      `select e."id", e."price_list_id", e."variant_id", e."product_id", e."category_id", e."attribute_key",
              e."attribute_value", e."min_quantity", e."max_quantity", e."price_type", e."amount", e."percent"
         from "price_list_matrix_entries" e
        where e."price_list_id" = any(?::uuid[])
          and ${variantId ? `e."variant_id" = ?::uuid` : `e."product_id" = ?::uuid and e."variant_id" is null`}
        order by e."min_quantity" asc`,
      [pgArray(bookIds), variantId ?? productId],
    )) as MatrixRecord[];
    for (const record of rows) {
      const row = storedOf(record);
      const list = out.get(record.price_list_id) ?? [];
      list.push({
        rowId: row.id,
        selectionKind: row.variantId ? 'variant' : 'product',
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
        price: priceOfStored(row),
      });
      out.set(record.price_list_id, list);
    }
    return out;
  }

  /** Each book's channel bindings, in one statement over the registered bridge. */
  async #bindings(books: readonly BookHeaderRow[]): Promise<Map<string, Array<{ channelId: string; dormant: boolean }>>> {
    const out = new Map<string, Array<{ channelId: string; dormant: boolean }>>();
    const nonSystem = books.filter((b) => !b.is_system);
    if (nonSystem.length === 0) return out;
    const em = this.deps.emFactory();
    const channels = await em.find(SalesChannel, {}, { fields: ['id', 'currencies', 'defaultCurrency'], orderBy: { id: 'asc' } });
    if (channels.length === 0) return out;
    const bridge = this.#bridge();
    const parts: string[] = [];
    const params: unknown[] = [];
    for (const channel of channels) {
      const sub = bridge.entityIdsInChannelSubquery(channel.id, 'price-list');
      parts.push(`select ?::uuid as "channel_id", b."id" as "book_id" from unnest(?::uuid[]) b("id") where b."id" in (${sub.sql})`);
      params.push(channel.id, pgArray(nonSystem.map((b) => b.id)), ...sub.params);
    }
    const rows = (await em.execute(parts.join(' union all '), params)) as Array<{ channel_id: string; book_id: string }>;
    const byId = new Map(channels.map((c) => [c.id, c]));
    const currencyOf = new Map(nonSystem.map((b) => [b.id, b.currency_code.trim().toUpperCase()]));
    for (const row of rows) {
      const channel = byId.get(row.channel_id)!;
      const offered = [...(channel.currencies ?? []), channel.defaultCurrency].map((c) => c.toUpperCase());
      const list = out.get(row.book_id) ?? [];
      list.push({ channelId: row.channel_id, dormant: !offered.includes(currencyOf.get(row.book_id)!) });
      out.set(row.book_id, list);
    }
    for (const list of out.values()) list.sort((a, b) => (a.channelId < b.channelId ? -1 : 1));
    return out;
  }

  /**
   * The labels of stored rows named by id, whichever books hold them — the
   * explanation's runner-ups (G16 of 161): one statement for the rows, then
   * the batched label reads. A row that is gone is absent from the map.
   */
  async rowLabels(rowIds: readonly string[], language: string | null): Promise<Map<string, PriceBookRowLabels>> {
    const ids = [...new Set(rowIds)];
    if (ids.length === 0) return new Map();
    const rows = (await this.deps.emFactory().execute(
      `select e."id", e."price_list_id", e."variant_id", e."product_id", e."category_id", e."attribute_key",
              e."attribute_value", e."min_quantity", e."max_quantity", e."price_type", e."amount", e."percent"
         from "price_list_matrix_entries" e where e."id" = any(?::uuid[])`,
      [pgArray(ids)],
    )) as MatrixRecord[];
    const labelled = await this.label(rows.map(storedOf), language);
    return new Map(labelled.map((row) => [row.id, row.labels]));
  }

  /** A book's stored rows (no labels). */
  async storedRows(bookId: string, em: EntityManager = this.deps.emFactory()): Promise<StoredRow[]> {
    const rows = (await em.execute(
      `select e."id", e."price_list_id", e."variant_id", e."product_id", e."category_id", e."attribute_key",
              e."attribute_value", e."min_quantity", e."max_quantity", e."price_type", e."amount", e."percent"
         from "price_list_matrix_entries" e where e."price_list_id" = ?`,
      [bookId],
    )) as MatrixRecord[];
    return rows.map(storedOf);
  }

  /**
   * A page of a book's rows with labels, natural keys and inactive reasons (G2),
   * filtered and searched (G3), ordered general to specific and by label within
   * a kind (161 FR-006).
   */
  async rows(
    bookId: string,
    query: PriceBookRowsQuery,
    scope: PriceBookScope,
    language: string | null,
  ): Promise<{ data: PriceBookRow[]; meta: { page: number; pageSize: number; totalCount: number } }> {
    await this.header(bookId, scope);
    const stored = await this.storedRows(bookId);
    const labelled = await this.label(stored, language);
    const search = query.search?.toLowerCase() ?? null;
    const filtered = labelled.filter((row) => {
      if (query.selectionKind?.length && !query.selectionKind.includes(row.selectionKind)) return false;
      if (query.productId && row.selection.productId !== query.productId) return false;
      if (query.variantId && row.selection.variantId !== query.variantId) return false;
      if (query.categoryId && row.selection.categoryId !== query.categoryId) return false;
      if (query.attributeKey && row.selection.attribute?.key !== query.attributeKey) return false;
      if (search) {
        const haystack = [
          ...Object.values(row.labels),
          row.naturalKey.productSku,
          row.naturalKey.variantSku,
          row.naturalKey.categoryPath,
          row.naturalKey.attribute?.valueCode,
          row.selection.attribute?.key,
        ]
          .filter((v): v is string => typeof v === 'string')
          .join('\u0000')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    filtered.sort(compareRows);
    const offset = (query.page - 1) * query.pageSize;
    return {
      data: filtered.slice(offset, offset + query.pageSize),
      meta: { page: query.page, pageSize: query.pageSize, totalCount: filtered.length },
    };
  }

  /**
   * One page of a book's **lines** (G15 of 161): a line is a selection with
   * every row it holds, a product line carries its variant lines, and the page
   * is cut between lines, general to specific and by label within a kind
   * (FR-006). Within 150 ms p95 at 50 000 lines (redesign, `research.md` R14):
   *
   * 1. a visibility-only header;
   * 2. the attribute and category lines (few) in one statement, labelled in
   *    full, searched and ordered by `foldAdminName`, the catalogue's fold;
   * 3. the product segment ordered, searched and cut by the catalogue's stored
   *    admin name key (`pageProductsByAdminName`) over this book's membership
   *    seam, counted from `price_list_product_lines` when nothing narrows it;
   * 4. rows and labels read for the page's lines only.
   *
   * The labels and the order use the admin language (`en` or `pl`), so a
   * product line's label (`pickName`) is the name its key was built from.
   */
  /**
   * The named products that have a line in the book (161, Checkpoint 5
   * review), from `price_list_product_lines` — one indexed probe per id on its
   * primary key, whatever the book's size — in the order they were named.
   */
  async productLines(bookId: string, productIds: readonly string[], scope: PriceBookScope): Promise<string[]> {
    await this.#visible(bookId, scope);
    const rows = (await this.deps.emFactory().execute(
      `select l."product_id" from "price_list_product_lines" l where l."price_list_id" = ? and l."product_id" = any(?::uuid[])`,
      [bookId, pgArray(productIds)],
    )) as Array<{ product_id: string }>;
    const present = new Set(rows.map((r) => r.product_id));
    return productIds.filter((id) => present.has(id));
  }

  async lines(
    bookId: string,
    query: PriceBookLinesQuery,
    scope: PriceBookScope,
    language: string | null,
  ): Promise<{ data: PriceBookLine[]; meta: { page: number; pageSize: number; totalLines: number } }> {
    // A visibility check only: the book read's tier starts and row count are not this read's (R14).
    await this.#visible(bookId, scope);
    const em = this.deps.emFactory();
    const kinds = new Set<PriceBookSelectionKind>(query.kind ?? []);
    const wants = (kind: PriceBookSelectionKind) => kinds.size === 0 || kinds.has(kind);
    const search = query.search?.trim() ? foldAdminName(query.search.trim()) : null;
    // The admin language the catalogue keys, the labels and the order are read in.
    language = adminNameLanguage(language);

    // 1. The few selections that name no product: all, attribute, category, category ∩ attribute.
    const smallKinds = (['all', 'attribute', 'category', 'category_attribute'] as const).filter(wants);
    const small =
      smallKinds.length === 0
        ? []
        : ((await em.execute(
            `select distinct e."category_id", e."attribute_key", e."attribute_value"
               from "price_list_matrix_entries" e
              where e."price_list_id" = ? and e."product_id" is null`,
            [bookId],
          )) as Array<{ category_id: string | null; attribute_key: string | null; attribute_value: string | null }>);
    const smallSelections = small.map((r) => selectionRow(null, null, r.category_id, r.attribute_key, r.attribute_value));
    const smallLabelled = (await this.label(smallSelections, language))
      .filter((line) => wants(line.selectionKind))
      .filter((line) => !search || foldAdminName(haystackOf(line)).includes(search))
      .sort(compareLines);

    // 2. The page cut: the small kinds come first, the products after them —
    // ordered, searched and cut by the catalogue's stored admin name key over
    // this book's membership seam (`price-book-membership.ts`).
    const offset = (query.page - 1) * query.pageSize;
    const smallPage = smallLabelled.slice(offset, offset + query.pageSize);
    const productOffset = Math.max(0, offset - smallLabelled.length);
    const productLimit = query.pageSize - smallPage.length;
    const productLines = wants('product') || wants('variant');
    const productKinds = new Set([...kinds].filter((k) => k === 'product' || k === 'variant'));
    // Without a search or a kind filter the line table counts the product lines (PK, index-only).
    const countsLines = productLines && !query.search && kinds.size === 0;
    const [productPage, lineCount] = productLines
      ? await Promise.all([
          this.deps.catalogProductRead.pageProductsByAdminName({
            membership: priceBookMembership(bookId, productKinds),
            ...(query.search ? { search: query.search } : {}),
            language,
            offset: productOffset,
            limit: productLimit,
            withTotal: !countsLines,
          }),
          countsLines
            ? (em.execute(`select count(*)::int as "n" from "price_list_product_lines" l where l."price_list_id" = ?`, [bookId]) as Promise<
                Array<{ n: number }>
              >).then((rows) => Number(rows[0]?.n ?? 0))
            : Promise.resolve(null),
        ])
      : [{ ids: [] as string[], total: 0 }, null];
    const productTotal = lineCount ?? productPage.total ?? 0;

    // 3. Rows and labels of the page's lines only.
    const smallKeys = smallPage.map((line) => smallKeyOf(line.selection.categoryId, line.selection.attribute?.key ?? null, line.selection.attribute?.value ?? null));
    const pageRows =
      smallKeys.length === 0 && productPage.ids.length === 0
        ? []
        : // The page's product rows through a LATERAL per id, fenced with `offset 0` so
          // it is not flattened into a join: each probe is an index lookup on
          // `(price_list_id, product_id)` whatever the statistics. On a book never
          // analysed (right after a bulk import) the planner otherwise estimated a
          // 125 000-row book at 86 rows and filtered all of it with `price_list_id`
          // as the only index condition — 27–40 ms instead of 0.5 ms (161 G15,
          // Checkpoint 2b). The small kinds' rows are few (`product_id is null`).
          ((await em.execute(
            `select e."id", e."price_list_id", e."variant_id", e."product_id", e."category_id", e."attribute_key",
                    e."attribute_value", e."min_quantity", e."max_quantity", e."price_type", e."amount", e."percent"
               from (
                 select x.* from unnest(?::uuid[]) as "pid"("id")
                  cross join lateral (
                    select r.* from "price_list_matrix_entries" r
                     where r."price_list_id" = ? and r."product_id" = "pid"."id"
                    offset 0
                  ) x
                 union all
                 select r.* from "price_list_matrix_entries" r
                  where r."price_list_id" = ? and r."product_id" is null
                    and coalesce(r."category_id"::text, '') || '|' || coalesce(r."attribute_key", '') || '|' || coalesce(r."attribute_value", '') = any(?::text[])
               ) e
              order by e."min_quantity" asc, e."id" asc`,
            [pgArray(productPage.ids), bookId, bookId, pgArray(smallKeys)],
          )) as MatrixRecord[]).map(storedOf);
    const productSelections = productPage.ids.map((id) => selectionRow(null, id, null, null, null));
    const labelled = await this.label([...pageRows, ...productSelections], language);
    const rows = labelled.slice(0, pageRows.length);
    const productHeads = new Map(labelled.slice(pageRows.length).map((line) => [line.selection.productId!, line]));
    const rowsByKey = new Map<string, PriceBookRow[]>();
    rows.forEach((row, index) => {
      const key = selectionKey(pageRows[index]!);
      const list = rowsByKey.get(key);
      if (list) list.push(row);
      else rowsByKey.set(key, [row]);
    });

    const lineOf = (head: PriceBookRow, key: string): PriceBookVariantLine => ({
      selectionKey: key,
      selectionKind: head.selectionKind,
      selection: head.selection,
      labels: head.labels,
      naturalKey: head.naturalKey,
      inactiveReason: head.inactiveReason,
      targetDeleted: head.targetDeleted,
      rows: rowsByKey.get(key) ?? [],
    });
    const data: PriceBookLine[] = [
      ...smallPage.map((head) => lineOf(head, selectionKey(storedOfSelection(head)))),
      ...productPage.ids.map((productId) => {
        const head = productHeads.get(productId)!;
        const variants = new Map<string, PriceBookRow>();
        for (const row of rows) {
          if (row.selection.productId === productId && row.selection.variantId && !variants.has(row.selection.variantId)) {
            variants.set(row.selection.variantId, row);
          }
        }
        return {
          ...lineOf(head, selectionKey(storedOfSelection(head))),
          variants: [...variants.values()]
            .map((variant) => lineOf(variant, selectionKey(storedOfSelection(variant))))
            .sort(
              (a, b) =>
                (a.labels.variantLabel ?? '').localeCompare(b.labels.variantLabel ?? '') ||
                (a.labels.variantSku ?? '').localeCompare(b.labels.variantSku ?? '') ||
                (a.selection.variantId! < b.selection.variantId! ? -1 : 1),
            ),
        };
      }),
    ];
    return {
      data,
      meta: { page: query.page, pageSize: query.pageSize, totalLines: smallLabelled.length + productTotal },
    };
  }

  /** Labels and natural keys for stored rows, in one batched read per target kind. */
  async label(rows: readonly StoredRow[], language: string | null): Promise<PriceBookRow[]> {
    const productIds = [...new Set(rows.map((r) => r.productId).filter((id): id is string => id !== null))];
    const needsCategories = rows.some((r) => r.categoryId !== null);
    const needsAttributes = rows.some((r) => r.attributeKey !== null);
    const [products, variants, categories, attributes] = await Promise.all([
      productIds.length > 0 ? this.deps.catalogProductRead.findByIds(productIds) : Promise.resolve([]),
      rows.some((r) => r.variantId !== null)
        ? this.deps.catalogProductRead.listVariantsByProductIds(
            [...new Set(rows.filter((r) => r.variantId !== null).map((r) => r.productId!).filter(Boolean))],
          )
        : Promise.resolve([]),
      needsCategories ? this.deps.catalogCategoryRead.listAll() : Promise.resolve([]),
      needsAttributes ? this.deps.catalogAttributeRead.listAll() : Promise.resolve([]),
    ]);
    const productById = new Map(products.map((p) => [p.id, p]));
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const attributeByKey = new Map<string, CatalogAttributeView>(attributes.map((a) => [a.key, a]));
    const path = (id: string, field: 'slug' | 'name'): string | null => {
      const parts: string[] = [];
      let current = categoryById.get(id);
      let guard = 0;
      while (current && guard < 64) {
        parts.unshift(field === 'slug' ? current.slug : pickName(current.name, language, current.slug));
        current = current.parentCategoryId ? categoryById.get(current.parentCategoryId) : undefined;
        guard += 1;
      }
      return parts.length > 0 ? parts.join(field === 'slug' ? '/' : ' › ') : null;
    };
    const optionLabel = (view: CatalogAttributeView | undefined, value: string | null): string | null => {
      if (!view || value === null) return value;
      const option = view.options.find((o) => o.value === value);
      return option ? pickLabel(option.label, option.labelDefault, language) : value;
    };
    const variantLabel = (attributesOf: Record<string, unknown>): string | null => {
      const parts = Object.entries(attributesOf)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
        .map(([key, value]) => optionLabel(attributeByKey.get(key), String(value)) ?? String(value));
      return parts.length > 0 ? parts.join(' / ') : null;
    };

    return rows.map((row) => {
      const product = row.productId ? productById.get(row.productId) : undefined;
      const variant = row.variantId ? variantById.get(row.variantId) : undefined;
      const category = row.categoryId ? categoryById.get(row.categoryId) : undefined;
      const attribute = row.attributeKey ? attributeByKey.get(row.attributeKey) : undefined;
      const targetDeleted =
        (row.productId !== null && (!product || product.deletedAt !== null)) ||
        (row.variantId !== null && !variant) ||
        (row.categoryId !== null && (!category || category.deletedAt !== null));
      const labels: PriceBookRowLabels = {
        productName: product ? product.name /* 168-shim: Global text */ : null,
        productSku: product?.sku ?? null,
        variantLabel: variant ? variantLabel(variant.variantAttributeValues) : null,
        variantSku: variant?.sku ?? null,
        categoryPath: row.categoryId ? path(row.categoryId, 'name') : null,
        attributeLabel: row.attributeKey ? (attribute ? pickLabel(attribute.label, attribute.labelDefault, language) : row.attributeKey) : null,
        attributeValueLabel: row.attributeKey ? optionLabel(attribute, row.attributeValue) : null,
      };
      const naturalKey: PriceBookNaturalKey = {
        ...(row.variantId ? (variant ? { variantSku: variant.sku } : {}) : product ? { productSku: product.sku } : {}),
        ...(row.categoryId ? { categoryPath: path(row.categoryId, 'slug') ?? undefined } : {}),
        ...(row.attributeKey ? { attribute: { key: row.attributeKey, valueCode: row.attributeValue ?? '' } } : {}),
      };
      if (naturalKey.categoryPath === undefined) delete naturalKey.categoryPath;
      const reason = row.attributeKey ? attributeInactiveReason(attribute ?? null) : null;
      return {
        id: row.id,
        selectionKind: priceBookSelectionKind({
          variantId: row.variantId,
          productId: row.productId,
          categoryId: row.categoryId,
          attribute: row.attributeKey ? { key: row.attributeKey, value: row.attributeValue ?? '' } : null,
        }),
        selection: {
          variantId: row.variantId,
          productId: row.productId,
          categoryId: row.categoryId,
          attribute: row.attributeKey ? { key: row.attributeKey, value: row.attributeValue ?? '' } : null,
        },
        minQuantity: row.minQuantity,
        maxQuantity: row.maxQuantity,
        price: priceOfStored(row),
        inactiveReason: targetDeleted
          ? 'target_deleted'
          : reason === 'attribute_not_found'
            ? 'attribute_deleted'
            : reason !== null
              ? 'attribute_not_price_rule'
              : null,
        targetDeleted,
        labels,
        naturalKey,
      };
    });
  }
}

const KIND_ORDER: Record<PriceBookRow['selectionKind'], number> = {
  all: 0,
  attribute: 1,
  category: 2,
  category_attribute: 3,
  product: 4,
  variant: 5,
};

/** General to specific; variants under their product; by label within a kind; then by tier. */
function compareRows(a: PriceBookRow, b: PriceBookRow): number {
  const kindA = a.selectionKind === 'variant' ? KIND_ORDER.product : KIND_ORDER[a.selectionKind];
  const kindB = b.selectionKind === 'variant' ? KIND_ORDER.product : KIND_ORDER[b.selectionKind];
  if (kindA !== kindB) return kindA - kindB;
  const label = (r: PriceBookRow) =>
    [r.labels.productName, r.labels.categoryPath, r.labels.attributeLabel, r.labels.attributeValueLabel]
      .filter(Boolean)
      .join(' ');
  const byLabel = label(a).localeCompare(label(b));
  if (byLabel !== 0) return byLabel;
  if (a.selectionKind !== b.selectionKind) return a.selectionKind === 'variant' ? 1 : -1;
  const byVariant = (a.labels.variantLabel ?? '').localeCompare(b.labels.variantLabel ?? '');
  if (byVariant !== 0) return byVariant;
  return a.minQuantity - b.minQuantity;
}

/** General to specific, then by label (the small kinds of a lines page). */
function compareLines(a: PriceBookRow, b: PriceBookRow): number {
  const byKind = KIND_ORDER[a.selectionKind] - KIND_ORDER[b.selectionKind];
  if (byKind !== 0) return byKind;
  // The catalogue's fold, compared bytewise, as its stored product keys are (161 G15).
  const label = (r: PriceBookRow) => foldAdminName([r.labels.categoryPath, r.labels.attributeLabel, r.labels.attributeValueLabel].filter(Boolean).join(' '));
  const [x, y] = [label(a), label(b)];
  if (x !== y) return x < y ? -1 : 1;
  const [kx, ky] = [selectionKey(storedOfSelection(a)), selectionKey(storedOfSelection(b))];
  return kx < ky ? -1 : kx > ky ? 1 : 0;
}

/** What a search matches on a line: its labels, natural key and attribute key (as `rows`' search, G3). */
function haystackOf(row: PriceBookRow): string {
  return [
    ...Object.values(row.labels),
    row.naturalKey.productSku,
    row.naturalKey.variantSku,
    row.naturalKey.categoryPath,
    row.naturalKey.attribute?.valueCode,
    row.selection.attribute?.key,
  ]
    .filter((v): v is string => typeof v === 'string')
    .join('\u0000')
    .toLowerCase();
}

/** A selection as a stored row with no price — what `label` needs to name it. */
function selectionRow(
  variantId: string | null,
  productId: string | null,
  categoryId: string | null,
  attributeKey: string | null,
  attributeValue: string | null,
): StoredRow {
  return {
    id: `selection:${[variantId, productId, categoryId, attributeKey, attributeValue].map((v) => v ?? '').join('|')}`,
    variantId,
    productId,
    categoryId,
    attributeKey,
    attributeValue,
    minQuantity: 1,
    maxQuantity: null,
    priceType: 'fixed',
    amount: null,
    percent: null,
  };
}

function storedOfSelection(row: PriceBookRow): Pick<StoredRow, 'variantId' | 'productId' | 'categoryId' | 'attributeKey' | 'attributeValue'> {
  return {
    variantId: row.selection.variantId,
    productId: row.selection.productId,
    categoryId: row.selection.categoryId,
    attributeKey: row.selection.attribute?.key ?? null,
    attributeValue: row.selection.attribute?.value ?? null,
  };
}

/** The key the page's row read matches a small selection by. */
function smallKeyOf(categoryId: string | null, attributeKey: string | null, attributeValue: string | null): string {
  return `${categoryId ?? ''}|${attributeKey ?? ''}|${attributeValue ?? ''}`;
}


interface MatrixRecord {
  id: string;
  price_list_id: string;
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  attribute_key: string | null;
  attribute_value: string | null;
  min_quantity: number;
  max_quantity: number | null;
  price_type: string;
  amount: string | null;
  percent: string | null;
}

function storedOf(r: MatrixRecord): StoredRow {
  return {
    id: r.id,
    variantId: r.variant_id,
    productId: r.product_id,
    categoryId: r.category_id,
    attributeKey: r.attribute_key,
    attributeValue: r.attribute_value,
    minQuantity: Number(r.min_quantity),
    maxQuantity: r.max_quantity === null ? null : Number(r.max_quantity),
    priceType: r.price_type === 'percent' ? 'percent' : r.price_type === 'amount' ? 'amount' : 'fixed',
    amount: r.amount === null ? null : String(r.amount),
    percent: r.percent === null ? null : String(r.percent),
  };
}

function bookOf(row: BookHeaderRow, channels: Array<{ channelId: string; dormant: boolean }>, scope: PriceBookScope): PriceBook {
  return {
    id: row.id,
    name: row.name,
    type: row.type === 'sale' ? 'sale' : 'regular',
    status: row.status,
    currencyCode: row.currency_code.trim(),
    audience: { kind: row.audience_kind, memberIds: row.member_ids ?? [] },
    priority: Number(row.priority),
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    isSystem: row.is_system,
    everActivated: row.ever_activated,
    version: Number(row.version),
    tierStarts: (row.tier_starts ?? []).map(Number),
    channels,
    rowCount: Number(row.row_count),
    // G11 — the scope rule the write routes apply, so the flag predicts their answer.
    writable: bookWritable(scope, { audienceKind: row.audience_kind, isSystem: row.is_system, organizationIds: row.member_org_ids ?? [] }),
  };
}
