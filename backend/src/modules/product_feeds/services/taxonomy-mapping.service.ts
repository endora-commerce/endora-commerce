import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  TaxonomyProviderCode,
} from '@endora-commerce/contracts';
import type { CommandBus } from '../../../commands/index.js';
import { FeedTaxonomy } from '../entities/feed-taxonomy.entity.js';
import { FeedTaxonomyMapping } from '../entities/feed-taxonomy-mapping.entity.js';
import { FeedTaxonomyNode } from '../entities/feed-taxonomy-node.entity.js';
import {
  makeSetTaxonomyMappingCommand,
  unknownTaxonomyNode,
  type SetTaxonomyMappingResult,
} from '../commands/taxonomy-mapping.commands.js';
import {
  resolveEffectiveMapping,
  type EffectiveCategoryMapping,
  type TaxonomyCategoryNode,
  type TaxonomyMappingRow,
} from './taxonomy-mapping-resolver.js';

/**
 * Category → provider node mapping — feature 067 / FR-079–FR-081, FR-085.
 *
 * Every write is a Command (Principle XIII); every read assembles the whole
 * category tree once and resolves effective values in memory, because the
 * mapping screen wants one row per shop category — mapped or not — and doing
 * that with a query per category is how a 900-category shop gets a five-second
 * page.
 */

/** Node search page size; the typeahead never needs more. */
const NODE_SEARCH_LIMIT = 50;

export interface TaxonomyMappingServiceDeps {
  emFactory: () => EntityManager;
  commandBus: CommandBus;
  /**
   * Feature 075, Phase C — the category tree a mapping screen and a generation
   * run are both built over. It was `em.find(Category, …)` against `catalog`'s
   * table, which no gate can see; `catalog` is a binding dependency of this
   * manifest, so the read now fails closed with it.
   */
  catalogCategories: CatalogCategoryReadPort;
}

export interface MappingRowView extends EffectiveCategoryMapping {
  categoryName: string;
  categoryDepth: number;
  /** Localized `A > B > C` of the mapped node, when one resolved. */
  nodeFullPath: string | null;
  inheritedFromCategoryName: string | null;
}

export interface CoverageSummary {
  providerCode: TaxonomyProviderCode;
  revision: string;
  totalCategories: number;
  explicitlyMapped: number;
  coveredByInheritance: number;
  uncovered: number;
  staleMappings: number;
}

export class TaxonomyMappingService {
  constructor(private readonly deps: TaxonomyMappingServiceDeps) {}

  async listInstalled(): Promise<FeedTaxonomy[]> {
    return this.deps
      .emFactory()
      .find(FeedTaxonomy, { isCurrent: true }, { orderBy: { providerCode: 'asc' } });
  }

  private async currentTaxonomy(
    providerCode: TaxonomyProviderCode,
  ): Promise<FeedTaxonomy | null> {
    return this.deps.emFactory().findOne(FeedTaxonomy, { providerCode, isCurrent: true });
  }

  /**
   * Node typeahead over the **localized** full path (FR-079).
   *
   * Matching the localized path rather than the label is deliberate: an
   * operator looking for "chairs" wants to tell office chairs from garden
   * chairs, and only the path carries that.
   */
  async searchNodes(input: {
    providerCode: TaxonomyProviderCode;
    query?: string;
    language: string;
    limit?: number;
  }): Promise<Array<{ externalId: string; parentExternalId: string | null; label: string; fullPath: string; depth: number }>> {
    const taxonomy = await this.currentTaxonomy(input.providerCode);
    if (!taxonomy) return [];

    const em = this.deps.emFactory();
    const limit = Math.min(input.limit ?? NODE_SEARCH_LIMIT, 200);
    const query = (input.query ?? '').trim();

    const rows = query
      ? ((await em.getConnection().execute(
          `select "external_id", "parent_external_id", "label", "full_path", "depth"
             from "product_feed_taxonomy_nodes"
            where "taxonomy_id" = ?
              and coalesce("full_path" ->> ?, "full_path" ->> 'en', '') ilike ?
            order by "depth" asc, "external_id" asc
            limit ?`,
          [taxonomy.id, input.language, `%${query}%`, limit],
          'all',
          em.getTransactionContext(),
        )) as RawNodeRow[])
      : ((await em.getConnection().execute(
          `select "external_id", "parent_external_id", "label", "full_path", "depth"
             from "product_feed_taxonomy_nodes"
            where "taxonomy_id" = ?
            order by "depth" asc, "external_id" asc
            limit ?`,
          [taxonomy.id, limit],
          'all',
          em.getTransactionContext(),
        )) as RawNodeRow[]);

    return rows.map((row) => ({
      externalId: row.external_id,
      parentExternalId: row.parent_external_id,
      label: localized(row.label, input.language),
      fullPath: localized(row.full_path, input.language),
      depth: row.depth,
    }));
  }

  /**
   * One row per shop category with its effective value (contract §4).
   *
   * `limit`/`offset` page the *categories*, so the surface stays usable above
   * the tree ceiling without a second code path for the data.
   */
  async listMappings(input: {
    providerCode: TaxonomyProviderCode;
    language: string;
    limit: number;
    offset?: number;
  }): Promise<{ rows: MappingRowView[]; total: number }> {
    const em = this.deps.emFactory();
    const categories = orderedTree(await this.deps.catalogCategories.listAll({ liveOnly: true }));
    const mappings = await em.find(FeedTaxonomyMapping, {
      taxonomyProviderCode: input.providerCode,
    });
    const nodesByExternalId = await this.nodeLookup(input.providerCode);

    const categoriesById = toCategoryMap(categories);
    const mappingsByCategoryId = toMappingMap(mappings);
    const nameById = new Map(
      categories.map((c) => [c.id, localized(c.name as Record<string, string>, input.language)]),
    );

    const offset = input.offset ?? 0;
    const page = categories.slice(offset, offset + input.limit);
    const rows = page.map((category) => {
      const effective = resolveEffectiveMapping(
        category.id,
        categoriesById,
        mappingsByCategoryId,
      );
      const node = effective.nodeExternalId
        ? nodesByExternalId.get(effective.nodeExternalId)
        : undefined;
      return {
        ...effective,
        categoryName: nameById.get(category.id) ?? '',
        categoryDepth: depthOf(category.id, categoriesById),
        nodeFullPath: node ? localized(node.fullPath, input.language) : null,
        inheritedFromCategoryName: effective.inheritedFromCategoryId
          ? (nameById.get(effective.inheritedFromCategoryId) ?? null)
          : null,
      };
    });

    return { rows, total: categories.length };
  }

  /** FR-079's coverage strip. The three buckets add up to the category total. */
  async coverage(providerCode: TaxonomyProviderCode): Promise<CoverageSummary | null> {
    const taxonomy = await this.currentTaxonomy(providerCode);
    if (!taxonomy) return null;

    const em = this.deps.emFactory();
    const categories = await this.deps.catalogCategories.listAll({ liveOnly: true });
    const mappings = await em.find(FeedTaxonomyMapping, {
      taxonomyProviderCode: providerCode,
    });
    const categoriesById = toCategoryMap(categories);
    const mappingsByCategoryId = toMappingMap(mappings);

    let explicitlyMapped = 0;
    let coveredByInheritance = 0;
    let uncovered = 0;
    for (const category of categories) {
      const effective = resolveEffectiveMapping(
        category.id,
        categoriesById,
        mappingsByCategoryId,
      );
      // A stale explicit row covers nothing at generation time, so it must not
      // be counted as covered here either — the numbers an operator reads have
      // to mean what the feed will do.
      if (effective.origin === 'explicit' && !effective.stale) explicitlyMapped += 1;
      else if (effective.origin === 'inherited') coveredByInheritance += 1;
      else uncovered += 1;
    }

    return {
      providerCode,
      revision: taxonomy.revision,
      totalCategories: categories.length,
      explicitlyMapped,
      coveredByInheritance,
      uncovered,
      staleMappings: mappings.filter((m) => m.stale).length,
    };
  }

  /** The FR-085 review list. */
  async listStale(
    providerCode: TaxonomyProviderCode,
    language: string,
  ): Promise<MappingRowView[]> {
    const em = this.deps.emFactory();
    const stale = await em.find(FeedTaxonomyMapping, {
      taxonomyProviderCode: providerCode,
      stale: true,
    });
    if (stale.length === 0) return [];

    const categories = await this.deps.catalogCategories.findByIds(stale.map((m) => m.categoryId));
    const nameById = new Map(
      categories.map((c) => [c.id, localized(c.name as Record<string, string>, language)]),
    );
    return stale.map((mapping) => ({
      categoryId: mapping.categoryId,
      categoryName: nameById.get(mapping.categoryId) ?? '',
      categoryDepth: 0,
      nodeExternalId: mapping.nodeExternalId,
      nodeFullPath: null,
      origin: 'explicit' as const,
      inheritedFromCategoryId: null,
      inheritedFromCategoryName: null,
      stale: true,
    }));
  }

  /** Every write goes through the Command Bus (FR-059). */
  async setMapping(input: {
    providerCode: TaxonomyProviderCode;
    categoryId: string;
    nodeExternalId: string | null;
  }): Promise<SetTaxonomyMappingResult> {
    if (input.nodeExternalId !== null) {
      const taxonomy = await this.currentTaxonomy(input.providerCode);
      const node = taxonomy
        ? await this.deps.emFactory().findOne(FeedTaxonomyNode, {
            taxonomyId: taxonomy.id,
            externalId: input.nodeExternalId,
          })
        : null;
      // Refusing an unknown node here is what keeps `stale` meaning "the
      // provider dropped it", rather than also meaning "someone typed it wrong".
      if (!node) throw unknownTaxonomyNode(input.nodeExternalId);
    }
    return this.deps.commandBus.run(makeSetTaxonomyMappingCommand(input));
  }

  /**
   * The generation pipeline's input: the category tree and the mapping rows,
   * read once per run rather than per product.
   */
  async resolutionContext(providerCode: TaxonomyProviderCode): Promise<{
    categoriesById: Map<string, TaxonomyCategoryNode>;
    mappingsByCategoryId: Map<string, TaxonomyMappingRow>;
  }> {
    const em = this.deps.emFactory();
    const [categories, mappings] = await Promise.all([
      this.deps.catalogCategories.listAll({ liveOnly: true }),
      em.find(FeedTaxonomyMapping, { taxonomyProviderCode: providerCode }),
    ]);
    return {
      categoriesById: toCategoryMap(categories),
      mappingsByCategoryId: toMappingMap(mappings),
    };
  }

  private async nodeLookup(
    providerCode: TaxonomyProviderCode,
  ): Promise<Map<string, FeedTaxonomyNode>> {
    const taxonomy = await this.currentTaxonomy(providerCode);
    if (!taxonomy) return new Map();
    const nodes = await this.deps
      .emFactory()
      .find(FeedTaxonomyNode, { taxonomyId: taxonomy.id });
    return new Map(nodes.map((n) => [n.externalId, n]));
  }
}

interface RawNodeRow {
  external_id: string;
  parent_external_id: string | null;
  label: Record<string, string>;
  full_path: Record<string, string>;
  depth: number;
}

/** Language, then its bare tag, then `en`, then anything populated. */
export function localized(map: Record<string, string>, language: string): string {
  const bare = language.split('-')[0] ?? language;
  const candidates = [language, bare, 'en'];
  for (const code of candidates) {
    const value = map[code];
    if (typeof value === 'string' && value !== '') return value;
  }
  return Object.values(map).find((v) => typeof v === 'string' && v !== '') ?? '';
}

/**
 * Sort order then **id**, which is the order the mapping screen has always
 * paged in. `CatalogCategoryReadPort.listAll` breaks ties on `slug` instead —
 * a better key, but a different one, and a boundary cut is not the place to
 * change what row an operator sees on page 2 (feature 075, Phase C).
 */
function orderedTree(categories: CatalogCategoryRecord[]): CatalogCategoryRecord[] {
  return [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function toCategoryMap(categories: CatalogCategoryRecord[]): Map<string, TaxonomyCategoryNode> {
  return new Map(
    categories.map((c) => [
      c.id,
      {
        id: c.id,
        parentCategoryId: c.parentCategoryId ?? null,
        sortOrder: c.sortOrder,
      },
    ]),
  );
}

function toMappingMap(mappings: FeedTaxonomyMapping[]): Map<string, TaxonomyMappingRow> {
  return new Map(
    mappings.map((m) => [
      m.categoryId,
      { categoryId: m.categoryId, nodeExternalId: m.nodeExternalId, stale: m.stale },
    ]),
  );
}

function depthOf(
  categoryId: string,
  categoriesById: ReadonlyMap<string, TaxonomyCategoryNode>,
): number {
  let depth = 0;
  let current = categoriesById.get(categoryId);
  const seen = new Set<string>();
  while (current?.parentCategoryId && !seen.has(current.id)) {
    seen.add(current.id);
    current = categoriesById.get(current.parentCategoryId);
    depth += 1;
    if (depth > 32) break;
  }
  return depth;
}
