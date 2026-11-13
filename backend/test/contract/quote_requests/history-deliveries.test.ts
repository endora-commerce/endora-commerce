import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  quoteRequestHistorySchema,
  quoteRequestSchema,
  type QuoteRequestHistory,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements, keyPaths } from '../../helpers/strict-schema.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';

const CUSTOMER = { cookies: { b2b_session: 'stub-customer-session' } };
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

/**
 * `specs/179-rfq-and-customer-notifications/` WP-06, T050 (US5; FR-070,
 * FR-071; contract `delivery-and-ports.md` §4).
 *
 * The admin History lists, under the entry whose `eventIds` holds a delivery
 * record's `source_event_id`, that record: who (named at read, `''` when the
 * person is gone), through which channel, its status, attempts, last error and
 * when it closed. The buyer's detail of the same request carries none of it.
 *
 * The records are the ones the submit itself wrote (WP-02); no worker runs in
 * this harness, so they are closed here by hand to cover every field.
 */
describe('179 — quote request History carries the notification deliveries', () => {
  let h: BackendServerHandle;
  let rfqId: string;

  type Row = { id: string; source_event_id: string; recipient_kind: string; recipient_id: string; channel: string };

  async function rows(): Promise<Row[]> {
    return (await h
      .em()
      .getConnection()
      .execute(
        `select id, source_event_id, recipient_kind, recipient_id, channel
           from quote_request_notifications where quote_request_id = ? order by id`,
        [rfqId],
      )) as Row[];
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      ...CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    rfqId = (res.json() as { data: { id: string } }).data.id;
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function adminHistory(): Promise<QuoteRequestHistory> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${rfqId}/history`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    const history = (res.json() as { data: QuoteRequestHistory }).data;
    expect(disagreements(deepStrict(quoteRequestHistorySchema), history)).toEqual([]);
    return history;
  }

  it('lists each record under the entry of its source event, with every field of the contract', async () => {
    const recorded = await rows();
    // The submit's own records: the requester's confirmation e-mail at least.
    const requesterEmail = recorded.find(
      (r) => r.recipient_kind === 'customer' && r.recipient_id === TEST_CUSTOMER_ID && r.channel === 'customer_email',
    );
    expect(requesterEmail, JSON.stringify(recorded)).toBeDefined();
    const sourceEventId = requesterEmail!.source_event_id;

    const conn = h.em().getConnection();
    const closedAt = new Date('2026-11-12T10:00:00.000Z');
    await conn.execute(
      `update quote_request_notifications
          set status = 'failed', attempts = 5, last_error = 'SMTP 554 refused', closed_at = ?
        where id = ?`,
      [closedAt, requesterEmail!.id],
    );
    // A recipient who is gone by the time the History is read (no account row).
    const goneId = randomUUID();
    const goneRecord = randomUUID();
    const org = (await conn.execute(`select organization_id from quote_requests where id = ?`, [rfqId])) as Array<{
      organization_id: string;
    }>;
    await conn.execute(
      `insert into quote_request_notifications
         (id, organization_id, quote_request_id, source_event_id, change, recipient_kind, recipient_id, channel,
          status, attempts, source_occurred_at, closed_at)
       values (?, ?, ?, ?, 'submitted', 'customer', ?, 'customer_email', 'skipped_no_recipient', 0, now(), now())`,
      [goneRecord, org[0]!.organization_id, rfqId, sourceEventId, goneId],
    );

    const history = await adminHistory();
    const owner = history.entries.find((e) => e.eventIds.includes(sourceEventId));
    expect(owner, JSON.stringify(history.entries)).toBeDefined();
    // The submit is a merged pair: the entry's own id is the `created` event's.
    expect(owner!.kind).toBe('submitted');
    expect(owner!.id).not.toBe(sourceEventId);

    const listed = owner!.deliveries ?? [];
    expect(listed.map((d) => d.id).sort()).toEqual([...recorded.map((r) => r.id), goneRecord].sort());

    const [account] = (await conn.execute(
      `select first_name, last_name from customer_accounts where id = ?`,
      [TEST_CUSTOMER_ID],
    )) as Array<{ first_name: string | null; last_name: string | null }>;
    const requesterName = [account!.first_name, account!.last_name].filter((p) => p && p.trim()).join(' ');

    expect(listed.find((d) => d.id === requesterEmail!.id)).toEqual({
      id: requesterEmail!.id,
      channel: 'customer_email',
      recipient: { kind: 'customer', id: TEST_CUSTOMER_ID, displayName: expect.any(String) },
      status: 'failed',
      attempts: 5,
      lastError: 'SMTP 554 refused',
      closedAt: closedAt.toISOString(),
    });
    if (requesterName !== '') {
      expect(listed.find((d) => d.id === requesterEmail!.id)!.recipient.displayName).toBe(requesterName);
    }
    expect(listed.find((d) => d.id === goneRecord)).toMatchObject({
      recipient: { kind: 'customer', id: goneId, displayName: '' },
      status: 'skipped_no_recipient',
      attempts: 0,
      lastError: null,
      closedAt: expect.any(String),
    });
    // Operators named by the same directory as the actors.
    for (const d of listed.filter((x) => x.recipient.kind === 'admin')) {
      expect(d.channel).toMatch(/^admin_/);
      if (d.recipient.id === TEST_ADMIN_ID) expect(d.recipient.displayName).not.toBe('');
    }
    // Pending records answer `closedAt: null`.
    for (const d of listed.filter((x) => x.status === 'pending')) {
      expect(d.closedAt).toBeNull();
      expect(d.lastError).toBeNull();
    }
  });

  it('a later entry lists only its own records; with none it carries no `deliveries` key', async () => {
    const detail = await h.app.inject({ method: 'GET', url: `/api/v1/admin/quote-requests/${rfqId}`, ...ADMIN });
    expect(detail.statusCode, detail.body).toBe(200);
    const version = (detail.json() as { data: { version: number } }).data.version;
    const modified = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      ...ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, agreedUnitPrice: 9 }] },
    });
    expect(modified.statusCode, modified.body).toBe(200);

    const before = await adminHistory();
    const submitted = before.entries.find((e) => e.kind === 'submitted')!;
    const revision = before.entries.find((e) => e.kind === 'modified')!;
    expect(revision, JSON.stringify(before.entries)).toBeDefined();
    const all = await rows();
    const ownIds = all.filter((r) => revision.eventIds.includes(r.source_event_id)).map((r) => r.id);
    expect(ownIds.length, 'the revision records the customer side').toBeGreaterThan(0);
    expect((revision.deliveries ?? []).map((d) => d.id).sort()).toEqual([...ownIds].sort());
    for (const d of submitted.deliveries ?? []) expect(ownIds).not.toContain(d.id);

    for (const eventId of revision.eventIds) {
      await h.em().getConnection().execute(`delete from quote_request_notifications where source_event_id = ?`, [eventId]);
    }
    const after = await adminHistory();
    expect(after.entries.find((e) => e.id === revision.id)).not.toHaveProperty('deliveries');
  });

  it("the buyer's detail of the same request carries no delivery (FR-071)", async () => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${rfqId}`, ...CUSTOMER });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json() as { data: unknown };
    expect(keyPaths(body, ['deliveries', 'recipient', 'lastError', 'last_error'])).toEqual([]);
    for (const r of await rows()) expect(res.body).not.toContain(r.id);
    expect(disagreements(deepStrict(quoteRequestSchema), body.data)).toEqual([]);
  });
});
