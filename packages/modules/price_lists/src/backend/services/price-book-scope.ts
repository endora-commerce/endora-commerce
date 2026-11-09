import { isOrgInScope, orgConstraintFor, orgScopeSql, type OrgConstraint } from '@endora-commerce/platform/tenancy';

/**
 * Which price books an administrator's request may see and change — feature
 * 160, FR-034 (`contracts/admin-price-books-api.md`, *Common rules*).
 *
 * Read off the ambient tenant context the admin pipeline derives from the
 * administrator's role (Principle XI), never from the request:
 *
 * - a platform administrator reaches every book;
 * - a scoped administrator (a sales representative) sees an organization book
 *   only when it names at least one organization and **every** member is in
 *   their scope — any other organization book, one naming no organization
 *   included, answers exactly as a missing one, everywhere, lists and counts
 *   included (an empty set names none of theirs; `every()` over it would have
 *   handed it to every representative — review finding 4 of release 0.108.0);
 *   sees everyone and customer-group books read-only; and may name only
 *   organizations in scope as members.
 */
export interface PriceBookScope {
  readonly all: boolean;
  /**
   * The reach when `all` is false, read through the platform's helpers only
   * (issue #305): a sales representative's is every organization nobody else
   * governs, which no set of ids names.
   */
  readonly constraint: OrgConstraint;
}

export function currentPriceBookScope(): PriceBookScope {
  const constraint = orgConstraintFor();
  return { all: constraint.kind === 'all', constraint };
}

export interface ScopedBook {
  readonly audienceKind: 'everyone' | 'customer_groups' | 'organizations';
  readonly isSystem: boolean;
  /** The organization members (empty for the other kinds). */
  readonly organizationIds: readonly string[];
}

/** Whether the book exists for the caller at all. */
export function bookVisible(scope: PriceBookScope, book: ScopedBook): boolean {
  if (scope.all || book.audienceKind !== 'organizations') return true;
  return book.organizationIds.length > 0 && book.organizationIds.every((id) => isOrgInScope(id, scope.constraint));
}

/** Whether the caller may change a visible book: a representative changes organization books only. */
export function bookWritable(scope: PriceBookScope, book: ScopedBook): boolean {
  if (scope.all) return true;
  return !book.isSystem && book.audienceKind === 'organizations' && bookVisible(scope, book);
}

/** Whether the caller may create a book of this audience kind. */
export function audienceKindWritable(scope: PriceBookScope, kind: ScopedBook['audienceKind']): boolean {
  return scope.all || kind === 'organizations';
}

/** Whether the caller may name this organization (as a member, a buyer, a filter). */
export function organizationInScope(scope: PriceBookScope, organizationId: string): boolean {
  return scope.all || isOrgInScope(organizationId, scope.constraint);
}

/**
 * A SQL predicate over a book aliased `l` that holds when the book is visible
 * ({@link bookVisible}): no organization member outside the scope, and an
 * organization book names at least one. `null` for a platform administrator
 * (no predicate).
 */
export function visibleBookSql(scope: PriceBookScope): { sql: string; params: unknown[] } | null {
  if (scope.all) return null;
  // `coalesce`: a predicate that is `NULL` for a member must count as "outside
  // the reach", never fall out of the `not exists` as "inside" it.
  const reach = orgScopeSql('sm."organization_id"', scope.constraint);
  return {
    sql: `(not exists (select 1 from "price_list_audience_members" sm
                         where sm."price_list_id" = l."id" and sm."organization_id" is not null
                           and not coalesce(${reach.sql}, false))
           and (l."audience_kind" <> 'organizations'
                or exists (select 1 from "price_list_audience_members" sn
                            where sn."price_list_id" = l."id" and sn."organization_id" is not null)))`,
    params: [...reach.params],
  };
}
