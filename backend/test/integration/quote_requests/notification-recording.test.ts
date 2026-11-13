import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Order } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { acceptedQuoteRequest } from '../../helpers/quote-conversion.js';
import { ageQuoteRequest } from '../../helpers/quote-request-age.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const INJECTED = 'notification-recording test: the transition failed after its records';
const DAY_MS = 86_400_000;
const EXPIRY_DAYS = 14;

/**
 * `specs/179-rfq-and-customer-notifications/` FR-001, research R-6 (T030) —
 * every writer records its delivery rows in the transaction of the change they
 * announce.
 *
 * Per writer, two cases against the composed module:
 *
 *  - **committed**: the change, the history entry the records name and the
 *    records are all there, and the delivery queue was kicked once;
 *  - **rolled back**: a failure injected right after the records were written
 *    (the shared `RfqNotificationService.record` answers, then throws) leaves
 *    neither the change, nor its history entry, nor a record — and no kick.
 *
 * The order completion writes no record (FR-003): its status and history entry
 * commit together, and a failure after the history entry rolls both back.
 */
describe('Quote request notifications are recorded inside the transition (WP-04)', () => {
  let h: BackendServerHandle;

  interface SharedDeps {
    notificationService: { record: (...args: never[]) => Promise<number> };
    eventService: { append: (...args: never[]) => Promise<{ id: string; eventType: string }> };
    notificationKick?: () => void;
    onRequestFailed?: (rfqId: string, error: unknown) => void;
  }
  interface Handle {
    rfqService: { deps: SharedDeps };
    adminService: { deps: SharedDeps };
    expiryWorker: { deps: SharedDeps; sweep(now?: Date): Promise<{ expiredCount: number; failedCount: number }> };
    orderCompletionReactor: { onOrderCreated(payload: unknown): Promise<void> };
  }
  const handle = (): Handle => (h.container.resolve('quoteRequests') as { handle(): Handle }).handle();

  // --- reads, on a connection of their own: what is committed ---------------

  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);

  /** What one request holds: its status and version, and how many rows of each kind name it. */
  const snapshot = async (id: string) => {
    const [row] = await h
      .em()
      .fork()
      .execute<Array<{ status: string; version: number }>>(`select "status", "version" from "quote_requests" where "id" = ?`, [id]);
    return {
      status: row?.status,
      version: row ? Number(row.version) : undefined,
      events: await scalar(`select count(*) as "n" from "quote_request_events" where "quote_request_id" = ?`, [id]),
      revisions: await scalar(`select count(*) as "n" from "quote_request_revisions" where "quote_request_id" = ?`, [id]),
      records: await scalar(`select count(*) as "n" from "quote_request_notifications" where "quote_request_id" = ?`, [id]),
    };
  };

  /** Requests carrying `marker` as their header note — how a rolled-back create is looked for. */
  const requestsMarked = (marker: string) =>
    scalar(`select count(*) as "n" from "quote_requests" where "header_note" = ?`, [marker]);

  /**
   * The history entry `change` names and the records naming it. Every record of
   * the request that names this entry carries `change`.
   */
  const recordsOf = async (id: string, change: string, eventType: string) => {
    const events = await h
      .em()
      .fork()
      .execute<Array<{ id: string }>>(
        `select "id" from "quote_request_events" where "quote_request_id" = ? and "event_type" = ? order by "created_at" desc`,
        [id, eventType],
      );
    expect(events.length, `a '${eventType}' history entry of ${id}`).toBeGreaterThan(0);
    const records = await h
      .em()
      .fork()
      .execute<Array<{ change: string; status: string }>>(
        `select "change", "status" from "quote_request_notifications" where "source_event_id" = ?`,
        [events[0]!.id],
      );
    expect(records.length, `records naming the '${eventType}' entry`).toBeGreaterThan(0);
    expect(new Set(records.map((record) => record.change))).toEqual(new Set([change]));
    expect(new Set(records.map((record) => record.status))).toEqual(new Set(['pending']));
    return records;
  };

  // --- seams ------------------------------------------------------------------

  /** Every service's kick replaced by a counter while `act` runs. */
  const kicksDuring = async <T>(act: () => Promise<T>): Promise<{ result: T; kicks: number }> => {
    const all = [handle().rfqService.deps, handle().adminService.deps, handle().expiryWorker.deps];
    const originals = all.map((deps) => deps.notificationKick);
    let kicks = 0;
    for (const deps of all) deps.notificationKick = () => void (kicks += 1);
    try {
      return { result: await act(), kicks };
    } finally {
      all.forEach((deps, index) => {
        if (originals[index] === undefined) delete deps.notificationKick;
        else deps.notificationKick = originals[index];
      });
    }
  };

  /**
   * `act`, with the shared recording step answering — its rows persisted and
   * flushed — and then throwing, as anything after it in the transition could.
   */
  const failingAfterRecords = async <T>(act: () => Promise<T>): Promise<{ result: T; recorded: number; kicks: number }> => {
    const service = handle().rfqService.deps.notificationService;
    const original = service.record;
    let recorded = 0;
    service.record = (async (...args: never[]) => {
      recorded += await original.apply(service, args);
      throw new Error(INJECTED);
    }) as never;
    try {
      const { result, kicks } = await kicksDuring(act);
      return { result, recorded, kicks };
    } finally {
      service.record = original;
    }
  };

  // --- fixtures, through the routes -------------------------------------------

  const submit = async (headerNote?: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 9 }], ...(headerNote ? { headerNote } : {}) },
    });
    return res;
  };
  const submitted = async (): Promise<{ id: string; version: number }> => {
    const res = await submit();
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  };
  const revise = (id: string, version: number) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 8.5 }] },
    });
  /** A buyer's request the operator has priced: Pending, awaiting the buyer. */
  const offered = async (): Promise<{ id: string; version: number; revision: number }> => {
    const rfq = await submitted();
    const res = await revise(rfq.id, rfq.version);
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: { version: number; currentRevisionNumber: number } }).data;
    return { id: rfq.id, version: data.version, revision: data.currentRevisionNumber };
  };
  const createOnBehalf = (headerNote: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 10 }],
        headerNote,
      },
    });
  const respond = (id: string, revision: number, decision: 'accept' | 'reject') =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/${decision}-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: revision, ...(decision === 'reject' ? { reason: 'Too dear' } : {}) },
    });
  const approve = (id: string, version: number) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${id}/approve`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { note: 'Approved after the call.' },
    });
  const cancel = (id: string, version: number) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${id}/cancel`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { reason: 'Out of stock' },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  // --- customer-side writers ----------------------------------------------------

  describe('submit (createForCustomer)', () => {
    it('commits the request, its submitted entry and the records together, then kicks', async () => {
      const { result: res, kicks } = await kicksDuring(() => submit());
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      await recordsOf(id, 'submitted', 'submitted');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves no request, no history and no record', async () => {
      const marker = `wp04-submit-${randomUUID()}`;
      const { result: res, recorded, kicks } = await failingAfterRecords(() => submit(marker));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await requestsMarked(marker)).toBe(0);
      expect(kicks).toBe(0);
    });
  });

  describe('re-submit', () => {
    const resubmit = (id: string, headerNote?: string) =>
      h.app.inject({
        method: 'POST',
        url: `/api/v1/quote-requests/${id}/resubmit`,
        cookies: CUSTOMER,
        payload: headerNote ? { headerNote } : {},
      });

    it('commits the new request, its re-submitted entry and the records together', async () => {
      const source = await submitted();
      const { result: res, kicks } = await kicksDuring(() => resubmit(source.id));
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      await recordsOf(id, 'resubmitted', 're-submitted');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves no new request', async () => {
      const source = await submitted();
      const marker = `wp04-resubmit-${randomUUID()}`;
      const { result: res, recorded, kicks } = await failingAfterRecords(() => resubmit(source.id, marker));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await requestsMarked(marker)).toBe(0);
      expect(kicks).toBe(0);
    });
  });

  for (const decision of ['accept', 'reject'] as const) {
    const change = decision === 'accept' ? 'offer_accepted' : 'offer_rejected';
    const eventType = decision === 'accept' ? 'approved' : 'canceled';
    describe(`${decision} offer`, () => {
      it(`commits the status, the '${eventType}' entry and the records together`, async () => {
        const rfq = await offered();
        const { result: res, kicks } = await kicksDuring(() => respond(rfq.id, rfq.revision, decision));
        expect(res.statusCode, res.body).toBe(200);
        expect((await snapshot(rfq.id)).status).toBe(decision === 'accept' ? 'Approved' : 'Canceled');
        await recordsOf(rfq.id, change, eventType);
        expect(kicks).toBe(1);
      });

      it('a failure after the records leaves the request as it was', async () => {
        const rfq = await offered();
        const before = await snapshot(rfq.id);
        const { result: res, recorded, kicks } = await failingAfterRecords(() => respond(rfq.id, rfq.revision, decision));
        expect(recorded).toBeGreaterThan(0);
        expect(res.statusCode).toBe(500);
        expect(await snapshot(rfq.id)).toEqual(before);
        expect(kicks).toBe(0);
      });
    });
  }

  // --- operator-side writers ----------------------------------------------------

  describe('operator approve', () => {
    it('commits the status, the approved entry and the records together', async () => {
      const rfq = await offered();
      const { result: res, kicks } = await kicksDuring(() => approve(rfq.id, rfq.version));
      expect(res.statusCode, res.body).toBe(200);
      expect((await snapshot(rfq.id)).status).toBe('Approved');
      await recordsOf(rfq.id, 'approved', 'approved');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves the request, its note and its history as they were', async () => {
      const rfq = await offered();
      const before = await snapshot(rfq.id);
      const { result: res, recorded, kicks } = await failingAfterRecords(() => approve(rfq.id, rfq.version));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await snapshot(rfq.id)).toEqual(before);
      expect(kicks).toBe(0);
    });
  });

  describe('operator cancel', () => {
    it('commits the status, the canceled entry and the records together', async () => {
      const rfq = await submitted();
      const { result: res, kicks } = await kicksDuring(() => cancel(rfq.id, rfq.version));
      expect(res.statusCode, res.body).toBe(200);
      expect((await snapshot(rfq.id)).status).toBe('Canceled');
      await recordsOf(rfq.id, 'canceled', 'canceled');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves the request as it was', async () => {
      const rfq = await submitted();
      const before = await snapshot(rfq.id);
      const { result: res, recorded, kicks } = await failingAfterRecords(() => cancel(rfq.id, rfq.version));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await snapshot(rfq.id)).toEqual(before);
      expect(kicks).toBe(0);
    });
  });

  describe('operator modify (a revised offer)', () => {
    it('commits the lines, the revision, the modified entry and the records together', async () => {
      const rfq = await submitted();
      const { result: res, kicks } = await kicksDuring(() => revise(rfq.id, rfq.version));
      expect(res.statusCode, res.body).toBe(200);
      await recordsOf(rfq.id, 'revised', 'modified');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves no revision, no history entry and no record', async () => {
      const rfq = await submitted();
      const before = await snapshot(rfq.id);
      const { result: res, recorded, kicks } = await failingAfterRecords(() => revise(rfq.id, rfq.version));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await snapshot(rfq.id)).toEqual(before);
      expect(kicks).toBe(0);
    });
  });

  describe('create on behalf', () => {
    it('commits the request, its created entry and the records together', async () => {
      const { result: res, kicks } = await kicksDuring(() => createOnBehalf(`wp04-on-behalf-${randomUUID()}`));
      expect(res.statusCode, res.body).toBe(201);
      const id = (res.json() as { data: { id: string } }).data.id;
      await recordsOf(id, 'prepared', 'created');
      expect(kicks).toBe(1);
    });

    it('a failure after the records leaves no request', async () => {
      const marker = `wp04-on-behalf-${randomUUID()}`;
      const { result: res, recorded, kicks } = await failingAfterRecords(() => createOnBehalf(marker));
      expect(recorded).toBeGreaterThan(0);
      expect(res.statusCode).toBe(500);
      expect(await requestsMarked(marker)).toBe(0);
      expect(kicks).toBe(0);
    });
  });

  // --- the system writers ---------------------------------------------------------

  describe('expiry', () => {
    beforeAll(async () => {
      await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, EXPIRY_DAYS, null, {
        actorAdminUserId: null,
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    afterAll(async () => {
      await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
        actorAdminUserId: null,
      });
    });

    const due = async (): Promise<string> => {
      const rfq = await submitted();
      await ageQuoteRequest(h.em(), rfq.id, new Date(Date.now() - EXPIRY_DAYS * DAY_MS - 60_000));
      return rfq.id;
    };

    it('a failure after the records leaves the request Pending; the next pass commits all three, then kicks', async () => {
      const id = await due();
      const before = await snapshot(id);
      const worker = handle().expiryWorker;
      worker.deps.onRequestFailed = () => undefined;
      try {
        const failed = await failingAfterRecords(() => worker.sweep());
        expect(failed.recorded).toBeGreaterThan(0);
        expect(failed.result.failedCount).toBeGreaterThan(0);
        expect(await snapshot(id)).toEqual(before);
        expect(failed.kicks).toBe(0);

        // Past this process's back-off for the request that failed.
        const { kicks } = await kicksDuring(() => worker.sweep(new Date(Date.now() + 3 * 60 * 60_000)));
        expect((await snapshot(id)).status).toBe('Expired');
        await recordsOf(id, 'expired', 'expired');
        expect(kicks).toBe(1);
      } finally {
        delete worker.deps.onRequestFailed;
      }
    });
  });

  describe('order completion', () => {
    /** An order row naming the request, written directly: the subject is the reactor. */
    const orderNaming = async (quoteRequestId: string): Promise<string> => {
      const em = h.em().fork();
      const order = em.create(Order, {
        id: randomUUID(),
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: randomUUID(),
        deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
        deliveryMethodId: randomUUID(),
        deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
        paymentMethodId: randomUUID(),
        paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
        subtotal: '10.00',
        taxTotal: '0.00',
        deliveryTotal: '0.00',
        total: '10.00',
        currency: 'PLN',
        placedAt: new Date(),
        sourceQuoteRequestId: quoteRequestId,
      });
      await em.persistAndFlush(order);
      return order.id;
    };

    it('commits the status and the completed entry together, and records nothing', async () => {
      const rfq = await acceptedQuoteRequest(h);
      const before = await snapshot(rfq.id);
      const orderId = await orderNaming(rfq.id);
      await handle().orderCompletionReactor.onOrderCreated({ orderId });
      const after = await snapshot(rfq.id);
      expect(after.status).toBe('Completed');
      expect(after.events).toBe(before.events + 1);
      expect(after.records).toBe(before.records);
    });

    it('a failure after the completed entry leaves the request Approved, with no completed entry', async () => {
      const rfq = await acceptedQuoteRequest(h);
      const before = await snapshot(rfq.id);
      const orderId = await orderNaming(rfq.id);
      const events = handle().rfqService.deps.eventService;
      const original = events.append;
      events.append = (async (...args: never[]) => {
        const written = await original.apply(events, args);
        if (written.eventType === 'completed') throw new Error(INJECTED);
        return written;
      }) as never;
      try {
        await expect(handle().orderCompletionReactor.onOrderCreated({ orderId })).rejects.toThrow(INJECTED);
      } finally {
        events.append = original;
      }
      expect(await snapshot(rfq.id)).toEqual(before);
    });
  });
});
