import type { EntityManager } from '@mikro-orm/postgresql';
import { normalizeTaxId } from '@endora-commerce/contracts';
import { Organization } from '../entities/organization.entity.js';

/**
 * What {@link TaxIdLookupService.resolveByTaxId} answers, over entities. The
 * port maps it into `TaxIdResolution` (`@endora-commerce/contracts`).
 */
export type TaxIdLookupResolution =
  | { kind: 'none' }
  | { kind: 'one'; organization: Organization }
  | { kind: 'ambiguous'; organizations: Organization[] };

interface MatchRow {
  id: string;
  root_id: string | null;
  deleted: boolean;
  created_at: Date | string;
}

/**
 * `specs/177-tax-id-scope/` (FR-023, FR-024; `contracts/tax-id-scope.md` §4) —
 * the one way this module, and through `organizationDetailsPort` every other,
 * asks "which organization has this tax ID?".
 *
 * `findOne({ taxId })` answered that while a tax ID was on one row. In
 * `per-tree-root` a head office and its branches share one, and `findOne`
 * would return an arbitrary member of the tree; so the list is ordered — the
 * tree's root first (`root_id = id`), then by depth, creation time and id —
 * and the single answer is the root.
 *
 * The root is read from `root_id`, the stored generated column the entity does
 * not map (research R-2), which is why the ordering is SQL. Every method takes
 * an optional `em`, so a Command reads inside its own transaction.
 */
export class TaxIdLookupService {
  constructor(private readonly emFactory: () => EntityManager) {}

  /**
   * Every organization holding the tax ID, root first. Soft-deleted rows only
   * with `includeDeleted`. An input with nothing left after normalising
   * answers `[]` without a query.
   */
  async findByTaxId(
    taxId: string,
    options: { includeDeleted?: boolean; em?: EntityManager } = {},
  ): Promise<Organization[]> {
    const normalized = normalizeTaxId(taxId);
    if (normalized === '') return [];
    const em = options.em ?? this.emFactory();
    const rows = (await em.execute(
      `select "id" from "organizations"
        where "tax_id" = ?${options.includeDeleted ? '' : ' and "deleted_at" is null'}
        ${ORDER_BY}`,
      [normalized],
    )) as Array<{ id: string }>;
    return this.#load(em, rows.map((row) => row.id));
  }

  /**
   * The organization a tax ID resolves to.
   *
   * Deleted rows count when the roots are worked out — a soft-deleted head
   * office still owns its tree (spec, Edge Cases) — but the answer is a live
   * organization: the live root when there is one, else the oldest live match.
   * No live match is `none`. Matches under more than one root are `ambiguous`,
   * which neither scope's database constraint lets happen.
   */
  async resolveByTaxId(
    taxId: string,
    options: { em?: EntityManager } = {},
  ): Promise<TaxIdLookupResolution> {
    const normalized = normalizeTaxId(taxId);
    if (normalized === '') return { kind: 'none' };
    const em = options.em ?? this.emFactory();
    const rows = (await em.execute(
      `select "id", "root_id", ("deleted_at" is not null) as "deleted", "created_at"
         from "organizations"
        where "tax_id" = ?
        ${ORDER_BY}`,
      [normalized],
    )) as MatchRow[];
    const live = rows.filter((row) => !row.deleted);
    if (live.length === 0) return { kind: 'none' };

    const roots = new Set(rows.map((row) => row.root_id ?? row.id));
    if (roots.size > 1) {
      return { kind: 'ambiguous', organizations: await this.#load(em, live.map((row) => row.id)) };
    }
    const [root] = roots;
    const chosen =
      live.find((row) => row.id === root) ??
      [...live].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
          a.id.localeCompare(b.id),
      )[0]!;
    const [organization] = await this.#load(em, [chosen.id]);
    return organization ? { kind: 'one', organization } : { kind: 'none' };
  }

  async #load(em: EntityManager, ids: string[]): Promise<Organization[]> {
    if (ids.length === 0) return [];
    const found = await em.find(Organization, { id: { $in: ids } });
    const byId = new Map(found.map((org) => [org.id, org]));
    return ids.flatMap((id) => {
      const org = byId.get(id);
      return org ? [org] : [];
    });
  }
}

/** Root first, then depth (segments of `path`), creation time, id. */
const ORDER_BY = `order by ("root_id" is not distinct from "id") desc,
          coalesce(array_length(string_to_array(trim(both '/' from "path"), '/'), 1), 0) asc,
          "created_at" asc,
          "id" asc`;
