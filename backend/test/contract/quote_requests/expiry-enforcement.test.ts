import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequest } from '../../helpers/package-entities.js';

/**
 * The module's own shipped sentences, read rather than copied — the point of
 * this file is that both codes had sentences in both languages and nothing
 * raised them, so proving the sentence now reaches the client is the finding
 * closed. Duplicating the prose here would make it two sources of truth.
 */
const EN_BUNDLE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../packages/modules/quote_requests/i18n/en.json', import.meta.url),
    ),
    'utf8',
  ),
) as Record<string, string>;

/**
 * The per-request validity deadline an operator sets with `expiresInDays`
 * is enforced on the two customer transitions that consume the seller's
 * price commitment, and on no other.
 *
 * `expiresAt` was written once by `RfqAdminService` and read by no rule
 * between the feature-008 workflow rewrite (`4f24dc948`, which dropped the
 * live check `accept()` carried) and this file — both parties were shown
 * "expires <date>" while the customer could accept and convert for ever.
 *
 * **Not the expiry worker.** That sweeps `updatedAt` against a
 * settings-wide `expiryDays` and never looks at `Approved`, so for a quote
 * the customer has accepted the sweep is not "the window before the worker
 * runs" — it is every window. `integration/quote_requests/expiry-worker.test.ts`
 * owns that concept; this file owns the deadline the operator set.
 *
 * The clock is controlled by moving the deadline into the past
 * (`lapse()`), never by waiting: the operator sets a real `expiresInDays`
 * through the admin route, and the row's `expiresAt` is then backdated the
 * way `expiry-worker.test.ts` backdates `updatedAt`.
 *
 * Every assertion reads `error.code` off the envelope rather than the
 * status alone — a 410 and a 500 are not the same result.
 */
describe('Quote Request validity deadline — contract', () => {
  let h: BackendServerHandle;

  /** A fixed instant well before any run of this suite. */
  const LAPSED_AT = new Date('2026-01-01T00:00:00.000Z');

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  interface Envelope {
    error: { code: string; message: string };
  }

  /**
   * Raises a customer request, has the operator quote it with a validity
   * window, and returns the id plus the revision the customer must pin.
   */
  async function quotedRfq(expiresInDays: number): Promise<{ id: string; revision: number }> {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 9.5 }],
      },
    });
    expect(created.statusCode).toBe(201);
    const rfq = (created.json() as { data: { id: string; version: number } }).data;

    const modified = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${rfq.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9.0 }],
        expiresInDays,
      },
    });
    expect(modified.statusCode).toBe(200);
    const revision = (modified.json() as { data: { currentRevisionNumber: number } }).data
      .currentRevisionNumber;
    return { id: rfq.id, revision };
  }

  /** Moves the operator's deadline into the past. */
  async function lapse(id: string): Promise<void> {
    await h.em().nativeUpdate(QuoteRequest, { id }, { expiresAt: LAPSED_AT });
  }

  const acceptRevision = (id: string, revision: number) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: revision },
    });

  const convertToOrder = (id: string) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/convert-to-order`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });

  // -------------------------------------------------------------------------
  // The two refused paths
  // -------------------------------------------------------------------------

  it('refuses accept-revision past the deadline with 410 RFQ_EXPIRED', async () => {
    const { id, revision } = await quotedRfq(7);
    await lapse(id);

    const res = await acceptRevision(id, revision);

    expect(res.statusCode).toBe(410);
    const envelope = res.json() as Envelope;
    expect(envelope.error.code).toBe('RFQ_EXPIRED');
    expect(envelope.error.message).toBe(EN_BUNDLE['errors.RFQ_EXPIRED']);
  });

  it('refuses convert-to-order past the deadline with 410 QUOTE_VALIDITY_ENDED', async () => {
    const { id, revision } = await quotedRfq(7);

    // Accepted inside the window — the request is Approved and convertible.
    expect((await acceptRevision(id, revision)).statusCode).toBe(200);
    expect((await convertToOrder(id)).statusCode).toBe(200);

    // The same request, past the same deadline, at the same agreed prices.
    await lapse(id);
    const res = await convertToOrder(id);

    expect(res.statusCode).toBe(410);
    const envelope = res.json() as Envelope;
    expect(envelope.error.code).toBe('QUOTE_VALIDITY_ENDED');
    expect(envelope.error.message).toBe(EN_BUNDLE['errors.QUOTE_VALIDITY_ENDED']);
  });

  // -------------------------------------------------------------------------
  // The siblings the rule does not reach
  // -------------------------------------------------------------------------

  it('still lets the customer reject a lapsed revision', async () => {
    const { id, revision } = await quotedRfq(7);
    await lapse(id);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/reject-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: revision, reason: 'too late' },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { status: string } }).data.status).toBe('Canceled');
  });

  it('still lets the customer resubmit a lapsed request', async () => {
    const { id } = await quotedRfq(7);
    await lapse(id);

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/resubmit`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const fresh = (res.json() as { data: { id: string; status: string; expiresAt: string | null } })
      .data;
    expect(fresh.id).not.toBe(id);
    expect(fresh.status).toBe('Pending');
    // The remedy carries no deadline of its own — the operator dates it again.
    expect(fresh.expiresAt).toBeNull();
  });

  it('does not fire on a request the operator never dated', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    const rfq = (created.json() as { data: { id: string; version: number } }).data;
    const modified = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfq.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${rfq.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9.0 }] },
    });
    const revision = (modified.json() as { data: { currentRevisionNumber: number } }).data
      .currentRevisionNumber;

    expect((await acceptRevision(rfq.id, revision)).statusCode).toBe(200);
    expect((await convertToOrder(rfq.id)).statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Refusing the customer is not freezing the record
  // -------------------------------------------------------------------------

  it('lets the operator re-date a lapsed request, after which the customer can accept', async () => {
    const { id, revision } = await quotedRfq(7);
    await lapse(id);
    expect((await acceptRevision(id, revision)).statusCode).toBe(410);

    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    const version = (detail.json() as { data: { version: number } }).data.version;

    const extended = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9.0 }],
        expiresInDays: 14,
      },
    });
    expect(extended.statusCode).toBe(200);
    const reRevision = (extended.json() as { data: { currentRevisionNumber: number } }).data
      .currentRevisionNumber;

    expect((await acceptRevision(id, reRevision)).statusCode).toBe(200);
  });
});
