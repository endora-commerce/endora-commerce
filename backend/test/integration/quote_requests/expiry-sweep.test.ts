import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { ageQuoteRequest } from '../../helpers/quote-request-age.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const DAY_MS = 86_400_000;
const EXPIRY_DAYS = 14;

/**
 * The expiry sweep, one Quote Request at a time.
 *
 * The pass used to flush every due request to `Expired` at once and then walk
 * them, writing each one's history row and notifications and emitting its
 * event. A throw on the second of three left three requests `Expired`, one
 * announced, and nothing for the next pass to find.
 *
 * Every case drives the **composed** worker — the instance the module builds
 * and the scheduled consumer runs — over real rows. Where a case needs one
 * request to fail, or a small batch, it reaches the worker's own dependencies;
 * nothing else is stood in for.
 */
describe('RfqExpiryWorker — each Quote Request expires as one unit of work', () => {
  let h: BackendServerHandle;

  interface Deps {
    notificationService: { enqueue: (...args: never[]) => Promise<number> };
    salesRepAssignment: { listForOrganization: (organizationId: string) => Promise<unknown[]> };
    batchSize?: number;
    onRequestFailed?: (rfqId: string, error: unknown) => void;
  }
  interface SweepResult {
    expiredCount: number;
    failedCount?: number;
    notificationsSuppressedCount?: number;
    reachedBatchLimit?: boolean;
  }
  const worker = (): { sweep(now?: Date): Promise<SweepResult>; deps: Deps } =>
    (
      h.container.cradle as unknown as {
        quoteRequests: { handle(): { expiryWorker: { sweep(now?: Date): Promise<SweepResult>; deps: Deps } } };
      }
    ).quoteRequests.handle().expiryWorker;

  /** A Pending request that became due `overdueMs` ago. */
  const dueRequest = async (overdueMs: number): Promise<string> => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await ageQuoteRequest(h.em(), id, new Date(Date.now() - EXPIRY_DAYS * DAY_MS - overdueMs));
    return id;
  };

  const statusOf = async (id: string): Promise<string> =>
    (await h.em().findOneOrFail(QuoteRequest, { id }, { filters: false })).status;

  const count = async (table: string, id: string, extra = ''): Promise<number> =>
    Number(
      (
        await h
          .em()
          .execute<Array<{ n: string }>>(
            `select count(*) as "n" from "${table}" where "quote_request_id" = ? ${extra}`,
            [id],
          )
      )[0]!.n,
    );
  const expiredHistoryRows = (id: string) => count('quote_request_events', id, `and "event_type" = 'expired'`);
  const notificationRows = (id: string) => count('quote_request_notification_events', id);

  /** Every `rfq.expired.v1` announced while `act` runs, for the given requests. */
  const announcedDuring = async <T>(ids: readonly string[], act: () => Promise<T>) => {
    const announced: Array<{ rfqId: string; organizationId?: string }> = [];
    const off = h.eventBus.on('rfq.expired.v1' as never, (payload: unknown) => {
      const event = payload as { rfqId: string; organizationId?: string };
      if (ids.includes(event.rfqId)) announced.push(event);
    });
    try {
      const result = await act();
      // Outside a scope the bus does not wait for its subscribers.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { result, announced };
    } finally {
      off();
    }
  };

  /** Leave nothing due behind, so each case counts only what it seeded. */
  const drain = async (): Promise<void> => {
    await h.em().execute(
      `update "quote_requests" set "status" = 'Canceled' where "status" in ('Pending', 'Created from admin')`,
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, EXPIRY_DAYS, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }, 120_000);

  afterEach(async () => {
    await drain();
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
      actorAdminUserId: null,
    });
    await teardownBackendServer(h);
  });

  it('a request that fails stays due, is not announced, and does not stop the others — the next pass expires it', async () => {
    const first = await dueRequest(3 * 60_000);
    const second = await dueRequest(2 * 60_000);
    const third = await dueRequest(60_000);
    const ids = [first, second, third];

    // The fan-out of the second request fails once.
    const deps = worker().deps;
    const original = deps.notificationService.enqueue;
    let calls = 0;
    deps.notificationService.enqueue = (async (...args: never[]) => {
      calls += 1;
      if (calls === 2) throw new Error('expiry sweep test: the fan-out failed');
      return original.apply(deps.notificationService, args);
    }) as never;
    const reported: string[] = [];
    deps.onRequestFailed = (rfqId) => reported.push(rfqId);

    try {
      const { announced } = await announcedDuring(ids, () => worker().sweep().catch(() => undefined));

      // The one that failed is as it was: still Pending, no history row, not announced.
      expect(await statusOf(second)).toBe('Pending');
      expect(await expiredHistoryRows(second)).toBe(0);
      expect(await notificationRows(second)).toBe(await notificationRowsBeforeExpiry(second));
      expect(announced.map((event) => event.rfqId)).not.toContain(second);
      // The other two are expired whole, and each was announced once.
      for (const id of [first, third]) {
        expect(await statusOf(id)).toBe('Expired');
        expect(await expiredHistoryRows(id)).toBe(1);
      }
      expect(announced.map((event) => event.rfqId).sort()).toEqual([first, third].sort());

      // This process leaves a request that failed alone for a while, so the
      // pass right after does not touch it …
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0, failedCount: 0 });
      expect(await statusOf(second)).toBe('Pending');
      // … and the first pass after that expires it.
      const next = await announcedDuring(ids, () => worker().sweep(new Date(Date.now() + 3 * 60 * 60_000)));
      expect(await statusOf(second)).toBe('Expired');
      expect(await expiredHistoryRows(second)).toBe(1);
      expect(next.announced.map((event) => event.rfqId)).toEqual([second]);
    } finally {
      deps.notificationService.enqueue = original;
      delete deps.onRequestFailed;
    }
  });

  /** A submission queues notifications of its own; the baseline for "expiry added none". */
  async function notificationRowsBeforeExpiry(id: string): Promise<number> {
    return count(
      'quote_request_notification_events',
      id,
      `and "source_event_id" not in (select "id" from "quote_request_events" where "event_type" = 'expired')`,
    );
  }

  it('rfq.expired.v1 announces a request that is already saved as Expired, with its history row', async () => {
    const id = await dueRequest(60_000);
    const bus = h.eventBus as unknown as { emit: (name: string, payload: unknown) => void };
    const originalEmit = bus.emit;
    const reads: Array<Promise<{ status: string; history: number }>> = [];
    // Read on a connection of its own, started inside `emit` — before any
    // subscriber runs — so the answer is what was committed at that moment.
    bus.emit = function emit(this: unknown, name: string, payload: unknown): void {
      if (name === 'rfq.expired.v1' && (payload as { rfqId: string }).rfqId === id) {
        reads.push(
          (async () => ({ status: await statusOf(id), history: await expiredHistoryRows(id) }))(),
        );
      }
      originalEmit.call(this, name, payload);
    };
    // A commit that takes a second: emitted from inside the transaction, the
    // event would be out, and the read answered, before the commit.
    await h.em().execute(`
      create function rfq_expiry_test_slow_commit() returns trigger language plpgsql as $$
      begin
        perform pg_sleep(1);
        return null;
      end $$;
      create constraint trigger rfq_expiry_test_slow_commit
        after update on "quote_requests"
        deferrable initially deferred
        for each row execute function rfq_expiry_test_slow_commit();
    `);
    try {
      await worker().sweep();
    } finally {
      bus.emit = originalEmit;
      await h.em().execute(`
        drop trigger rfq_expiry_test_slow_commit on "quote_requests";
        drop function rfq_expiry_test_slow_commit();
      `);
    }
    expect(await Promise.all(reads)).toEqual([{ status: 'Expired', history: 1 }]);
  });

  it('a request whose expiry fails at commit is not announced and stays due', async () => {
    const id = await dueRequest(60_000);
    await h.em().execute(`
      create function rfq_expiry_test_failing_commit() returns trigger language plpgsql as $$
      begin
        raise exception 'expiry sweep test: forced failure at commit';
      end $$;
      create constraint trigger rfq_expiry_test_failing_commit
        after update on "quote_requests"
        deferrable initially deferred
        for each row execute function rfq_expiry_test_failing_commit();
    `);
    const deps = worker().deps;
    deps.onRequestFailed = () => undefined;
    try {
      const { result, announced } = await announcedDuring([id], () => worker().sweep());
      expect(result).toMatchObject({ expiredCount: 0, failedCount: 1 });
      expect(announced).toEqual([]);
    } finally {
      delete deps.onRequestFailed;
      await h.em().execute(`
        drop trigger rfq_expiry_test_failing_commit on "quote_requests";
        drop function rfq_expiry_test_failing_commit();
      `);
    }
    expect(await statusOf(id)).toBe('Pending');
    expect(await expiredHistoryRows(id)).toBe(0);
  });

  it('announces the Organization the request belongs to', async () => {
    const id = await dueRequest(60_000);
    const { announced } = await announcedDuring([id], () => worker().sweep());
    const organizationId = (await h.em().findOneOrFail(QuoteRequest, { id }, { filters: false })).organizationId;
    expect(announced).toEqual([expect.objectContaining({ rfqId: id, organizationId })]);
  });

  it('a backlog is expired a bounded batch at a time, oldest first', async () => {
    const ids: string[] = [];
    // Seven requests, the first the longest overdue.
    for (let index = 0; index < 7; index += 1) ids.push(await dueRequest((70 - index) * DAY_MS));
    const deps = worker().deps;
    deps.batchSize = 3;
    try {
      const first = await worker().sweep();
      expect(first).toMatchObject({ expiredCount: 3, failedCount: 0, reachedBatchLimit: true });
      expect(await Promise.all(ids.map(statusOf))).toEqual([
        'Expired',
        'Expired',
        'Expired',
        'Pending',
        'Pending',
        'Pending',
        'Pending',
      ]);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 3, reachedBatchLimit: true });
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1, reachedBatchLimit: false });
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0, reachedBatchLimit: false });
      expect(new Set(await Promise.all(ids.map(statusOf)))).toEqual(new Set(['Expired']));
    } finally {
      delete deps.batchSize;
    }
  });

  it('first run over a backlog: every request is expired and announced, and only the recent ones are notified about', async () => {
    // What an instance that never ran the sweep holds: requests due for months,
    // beside two that became due within the last day.
    const stale = [await dueRequest(200 * DAY_MS), await dueRequest(45 * DAY_MS), await dueRequest(2 * DAY_MS)];
    const recent = [await dueRequest(23 * 60 * 60_000), await dueRequest(5 * 60_000)];
    const all = [...stale, ...recent];
    const before = new Map<string, number>();
    for (const id of all) before.set(id, await notificationRows(id));

    const { result, announced } = await announcedDuring(all, () => worker().sweep());

    expect(result).toMatchObject({ expiredCount: 5, failedCount: 0, notificationsSuppressedCount: 3 });
    // The state becomes true for all of them, and all of them are announced on the bus.
    for (const id of all) {
      expect(await statusOf(id)).toBe('Expired');
      expect(await expiredHistoryRows(id)).toBe(1);
    }
    expect(announced.map((event) => event.rfqId).sort()).toEqual([...all].sort());
    // Late news is not sent: no notification row, for the customer or anybody else.
    for (const id of stale) expect(await notificationRows(id)).toBe(before.get(id));
    // Expiry within the grace period is: the customer and the sales side, by e-mail and in the app.
    for (const id of recent) expect(await notificationRows(id)).toBeGreaterThan(before.get(id) ?? 0);
  });

  it('expiry_days = 0 expires nothing, however overdue', async () => {
    const id = await dueRequest(400 * DAY_MS);
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    try {
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Pending');
    } finally {
      await h.settings.adminService.setValueForAllChannels(
        QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
        EXPIRY_DAYS,
        null,
        { actorAdminUserId: null },
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
  });
});
