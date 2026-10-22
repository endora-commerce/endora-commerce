import { orgConstraintFor } from '@endora-commerce/platform/tenancy';

/**
 * Which price books an administrator's request may see and change — feature
 * 160, FR-034 (`contracts/admin-price-books-api.md`, *Common rules*).
 *
 * Read off the ambient tenant context the admin pipeline derives from the
 * administrator's role (Principle XI), never from the request:
 *
 * - a platform administrator reaches every book;
 * - a scoped administrator (a sales representative) sees an organization book
 *   only when **every** member is in their scope — any other organization book
 *   answers exactly as a missing one, everywhere, lists and counts included;
 *   sees everyone and customer-group books read-only; and may name only
 *   organizations in scope as members.
 */
export interface PriceBookScope {
  readonly all: boolean;
  /** The organizations in reach when `all` is false. */
  readonly organizationIds: ReadonlySet<string>;
}

export function currentPriceBookScope(): PriceBookScope {
  const constraint = orgConstraintFor();
  switch (constraint.kind) {
    case 'all':
      return { all: true, organizationIds: new Set() };
    case 'single':
      return { all: false, organizationIds: new Set(constraint.organizationId ? [constraint.organizationId] : []) };
    case 'set':
      return { all: false, organizationIds: new Set(constraint.organizationIds) };
  }
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
  return book.organizationIds.every((id) => scope.organizationIds.has(id));
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
  return scope.all || scope.organizationIds.has(organizationId);
}

/**
 * A SQL predicate over a book aliased `l` that holds when the book is visible:
 * no organization member outside the scope. `null` for a platform
 * administrator (no predicate).
 */
export function visibleBookSql(scope: PriceBookScope): { sql: string; params: unknown[] } | null {
  if (scope.all) return null;
  return {
    sql: `not exists (select 1 from "price_list_audience_members" sm
                        where sm."price_list_id" = l."id" and sm."organization_id" is not null
                          and not (sm."organization_id" = any(?::uuid[])))`,
    params: [`{${[...scope.organizationIds].join(',')}}`],
  };
}
