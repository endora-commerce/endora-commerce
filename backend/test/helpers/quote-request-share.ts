import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * `specs/192-quote-request-draft-share/` — test helpers for a quote request's
 * sharing state.
 *
 * `markUnsharedForTest` makes a quote the state an operator's new quote is in
 * once the switch-over lands: invisible to its customer and without a validity
 * date (data-model §1, invariant 1). Written as a column update so a test can
 * stand an unshared quote up before the create path writes one itself; it
 * never stands in for the share, which only the share Command performs.
 */
export async function markUnsharedForTest(em: EntityManager, quoteRequestId: string): Promise<void> {
  await em
    .getConnection()
    .execute(
      `update "quote_requests" set "shared_with_customer" = false, "shared_at" = null,
         "shared_by_admin_user_id" = null, "expires_at" = null where "id" = ?`,
      [quoteRequestId],
    );
}
