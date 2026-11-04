import type { EntityManager, Knex } from '@mikro-orm/postgresql';
import type { CatalogAttributeReadPort } from '@endora-commerce/contracts';
import type {
  CatalogAdminSearchQuery,
  CategoryAdminSearchRow,
  ProductAdminSearchRow,
} from '../admin-search-provider.js';

/**
 * Global search over products and categories (`specs/150-admin-global-search/`,
 * T048).
 *
 * The admin lists' rows: every product and category that is not deleted —
 * inactive and archived ones included (FR-016) — with no channel or audience
 * filter, because the admin screens have none (research R-19). Only the
 * selected fields are matched, literally (`likeEscaped`, Postgres' default
 * `\` LIKE escape). A product matches on its Global name (feature 172,
 * FR-031: one string); a category name matches in **any** language (one value
 * of its per-language map, never a key); `quickSearchAttributes` are the attributes
 * this module flags `quickSearchable`, read through its own attribute port as
 * the storefront type-ahead does. Identifiers (SKU, slug) rank exact → prefix
 * → the rest, then most recent change, then id; `limit + 1` rows, no count.
 */
export class CatalogAdminSearchService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly attributeRead: Pick<CatalogAttributeReadPort, 'listByFlag'>,
  ) {}

  async searchProducts(query: CatalogAdminSearchQuery): Promise<{ rows: ProductAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const quickKeys = fields.has('quickSearchAttributes')
      ? (await this.attributeRead.listByFlag('quickSearchable')).map((a) => a.key)
      : [];
    const matches: Array<(qb: Knex.QueryBuilder) => void> = [];
    if (fields.has('sku')) matches.push((qb) => qb.orWhereRaw('"sku" ilike ?', [contains]));
    if (fields.has('name')) matches.push((qb) => qb.orWhereRaw('"name" ilike ?', [contains]));
    if (fields.has('slug')) matches.push((qb) => qb.orWhereRaw('"slug" ilike ?', [contains]));
    for (const key of quickKeys) {
      matches.push((qb) => qb.orWhereRaw('"attribute_values"->>? ilike ?', [key, contains]));
    }
    if (query.isUuid) matches.push((qb) => qb.orWhereRaw('"id" = ?::uuid', [query.text]));
    const identifiers = ['sku', 'slug'].filter((f) => fields.has(f));
    const rows = await this.#page<{
      id: string;
      sku: string;
      name: string;
      type: string;
      status: string;
    }>('products', ['id', 'sku', 'name', 'type', 'status'], matches, identifiers, query);
    return {
      hasMore: rows.length > query.limit,
      rows: rows.slice(0, query.limit).map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        type: r.type,
        status: r.status,
      })),
    };
  }

  async searchCategories(
    query: CatalogAdminSearchQuery,
  ): Promise<{ rows: CategoryAdminSearchRow[]; hasMore: boolean }> {
    const fields = new Set(query.fields);
    const contains = `%${query.likeEscaped}%`;
    const matches: Array<(qb: Knex.QueryBuilder) => void> = [];
    if (fields.has('name')) {
      matches.push((qb) =>
        qb.orWhereRaw('exists (select 1 from jsonb_each_text("name") n where n.value ilike ?)', [contains]),
      );
    }
    if (fields.has('slug')) matches.push((qb) => qb.orWhereRaw('"slug" ilike ?', [contains]));
    if (query.isUuid) matches.push((qb) => qb.orWhereRaw('"id" = ?::uuid', [query.text]));
    const identifiers = fields.has('slug') ? ['slug'] : [];
    const rows = await this.#page<{ id: string; name: Record<string, string> }>(
      'categories',
      ['id', 'name'],
      matches,
      identifiers,
      query,
    );
    const page = rows.slice(0, query.limit);
    const paths = await this.#ancestorNames(page.map((r) => r.id));
    return {
      hasMore: rows.length > query.limit,
      rows: page.map((r) => ({ id: r.id, name: parseJson(r.name), path: paths.get(r.id) ?? [] })),
    };
  }

  async #page<T>(
    table: 'products' | 'categories',
    columns: readonly string[],
    matches: ReadonlyArray<(qb: Knex.QueryBuilder) => void>,
    identifiers: readonly string[],
    query: CatalogAdminSearchQuery,
  ): Promise<T[]> {
    if (matches.length === 0) return [];
    const em = this.emFactory();
    const builder = em
      .getKnex()(table)
      .select(columns.map((c) => (c === 'id' ? em.getKnex().raw('"id"::text as id') : c)))
      .whereNull('deleted_at')
      .andWhere((or) => {
        for (const match of matches) match(or);
      });
    const exact: string[] = [];
    const starts: string[] = [];
    const exactBindings: string[] = [];
    const startBindings: string[] = [];
    if (query.isUuid) {
      exact.push('"id" = ?::uuid');
      exactBindings.push(query.text);
    }
    for (const column of identifiers) {
      exact.push(`lower("${column}") = lower(?)`);
      exactBindings.push(query.text);
      starts.push(`"${column}" ilike ?`);
      startBindings.push(`${query.likeEscaped}%`);
    }
    if (exact.length > 0) {
      const prefix = starts.length > 0 ? ` when ${starts.join(' or ')} then 1` : '';
      builder.orderByRaw(`case when ${exact.join(' or ')} then 0${prefix} else 2 end`, [
        ...exactBindings,
        ...startBindings,
      ]);
    }
    builder.orderBy('updated_at', 'desc').orderBy('id', 'asc').limit(query.limit + 1);
    return (await em.execute(builder)) as T[];
  }

  /** Each category's ancestors' names, root first — one recursive read for the whole page. */
  async #ancestorNames(ids: readonly string[]): Promise<Map<string, Record<string, string>[]>> {
    const out = new Map<string, Record<string, string>[]>();
    if (ids.length === 0) return out;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = (await this.emFactory().execute(
      `with recursive chain as (
         select c.id as leaf, c.parent_category_id as next_id, 0 as depth
           from categories c where c.id::text in (${placeholders})
         union all
         select chain.leaf, p.parent_category_id, chain.depth + 1
           from chain join categories p on p.id = chain.next_id
          where chain.depth < 32
       )
       select chain.leaf::text as leaf, chain.depth, a.name
         from chain join categories a on a.id = chain.next_id`,
      [...ids],
    )) as Array<{ leaf: string; depth: number; name: Record<string, string> | string }>;
    const byLeaf = new Map<string, Array<{ depth: number; name: Record<string, string> }>>();
    for (const row of rows) {
      const list = byLeaf.get(row.leaf) ?? [];
      list.push({ depth: Number(row.depth), name: parseJson(row.name) });
      byLeaf.set(row.leaf, list);
    }
    for (const [leaf, list] of byLeaf) {
      out.set(
        leaf,
        list.sort((a, b) => b.depth - a.depth).map((entry) => entry.name),
      );
    }
    return out;
  }
}

function parseJson(value: Record<string, string> | string): Record<string, string> {
  return typeof value === 'string' ? (JSON.parse(value) as Record<string, string>) : value;
}
