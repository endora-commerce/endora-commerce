import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Make a Quote Request look as if nothing has happened to it since
 * `lastActivityAt`.
 *
 * The expiry sweep's clock is the request's latest history row, so that is
 * what is moved: every history row of the request is set to `lastActivityAt`.
 * The row's own `created_at` and `updated_at` go with it, so a test cannot pass
 * by accident on whichever of the three timestamps a rule happens to read.
 */
export async function ageQuoteRequest(em: EntityManager, id: string, lastActivityAt: Date): Promise<void> {
  await em.execute(`update "quote_request_events" set "created_at" = ? where "quote_request_id" = ?`, [
    lastActivityAt,
    id,
  ]);
  await em.execute(`update "quote_requests" set "created_at" = ?, "updated_at" = ? where "id" = ?`, [
    lastActivityAt,
    lastActivityAt,
    id,
  ]);
}
