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

/** Anything that can answer an injected request — a `BackendServerHandle`'s `app`. */
interface Injectable {
  inject(request: {
    method: 'POST';
    url: string;
    cookies: Record<string, string>;
  }): Promise<{ statusCode: number; body: string; json(): unknown }>;
}

/**
 * Shares an operator's quote with its customer through the route an operator
 * uses (`POST /api/v1/admin/quote-requests/:id/share`), as the stub
 * administrator unless `cookies` names another — what every test needs before
 * it acts as the customer on a quote an operator created, since such a quote
 * starts unshared. Answers the shared quote's `version`; throws on anything but
 * `200`, naming the reply.
 */
export async function shareQuoteRequestForTest(
  app: Injectable,
  quoteRequestId: string,
  cookies: Record<string, string> = { b2b_session: 'stub-admin-session' },
): Promise<{ version: number; expiresAt: string | null }> {
  const res = await app.inject({ method: 'POST', url: `/api/v1/admin/quote-requests/${quoteRequestId}/share`, cookies });
  if (res.statusCode !== 200) throw new Error(`shareQuoteRequestForTest: ${res.statusCode} ${res.body}`);
  return (res.json() as { data: { version: number; expiresAt: string | null } }).data;
}
