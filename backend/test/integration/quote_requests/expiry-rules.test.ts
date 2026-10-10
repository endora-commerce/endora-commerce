import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { ageQuoteRequest } from '../../helpers/quote-request-age.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const DAY_MS = 86_400_000;
const EXPIRY_DAYS = 7;

/**
 * **Which** Quote Requests the expiry sweep expires, and that it cannot cross
 * a transition somebody else is making.
 *
 * The rule (`RfqExpiryWorker.dueRequests`): a request is due when it is still
 * `Pending` or `Created from admin`, nothing has been written to its history
 * for `quote_requests.expiry_days`, and it carries no offer whose validity
 * date is still ahead. Every case asserts the probe (`hasExpirable`) beside
 * the pass, with the case's request the only one in the table that could be
 * due, because the two read one statement and must not part.
 *
 * Everything runs over the composed module: the worker the scheduled consumer
 * runs, and the services the routes call.
 */
describe('quote_requests expiry sweep — which requests are due, and who wins a race', () => {
  let h: BackendServerHandle;

  interface Sweep {
    expiredCount: number;
    failedCount: number;
    reachedBatchLimit: boolean;
  }
  interface WorkerDeps {
    notificationService: { enqueue: (...args: never[]) => Promise<number> };
    batchSize?: number;
    onRequestFailed?: (rfqId: string, error: unknown) => void;
  }
  interface ServiceWithEm {
    deps: { emFactory: () => EntityManager };
  }
  const handle = () =>
    (
      h.container.cradle as unknown as {
        quoteRequests: {
          handle(): {
            expiryWorker: { sweep(now?: Date): Promise<Sweep>; hasExpirable(now?: Date): Promise<boolean>; deps: WorkerDeps };
            rfqService: ServiceWithEm;
            adminService: ServiceWithEm;
          };
        };
      }
    ).quoteRequests.handle();
  const worker = () => handle().expiryWorker;

  // --- fixtures ---------------------------------------------------------------

  /** A request the customer submitted: `Pending`, waiting for the seller. */
  const submitted = async (): Promise<string> => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }] },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  };

  /** The seller's priced revision of a submitted request — an offer, optionally dated. */
  const quote = async (id: string, expiresInDays?: number): Promise<void> => {
    const response = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: ADMIN,
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 15 }],
        ...(expiresInDays !== undefined ? { expiresInDays } : {}),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  /** A request the seller drafted for the customer: `Created from admin`, waiting for the buyer. */
  const createdFromAdmin = async (expiresInDays?: number): Promise<string> => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: ADMIN,
      payload: {
        organizationId: TEST_ORGANIZATION_ID,
        customerAccountId: TEST_CUSTOMER_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 12 }],
        ...(expiresInDays !== undefined ? { expiresInDays } : {}),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  };

  /** Nothing has happened to the request for `days`. */
  const quietFor = (id: string, days: number) => ageQuoteRequest(h.em(), id, new Date(Date.now() - days * DAY_MS));

  const row = async (id: string) => h.em().findOneOrFail(QuoteRequest, { id }, { filters: false });
  const statusOf = async (id: string): Promise<string> => (await row(id)).status;

  const history = async (id: string): Promise<string[]> =>
    (
      await h
        .em()
        .execute<Array<{ event_type: string }>>(
          `select "event_type" from "quote_request_events" where "quote_request_id" = ? order by "created_at", "id"`,
          [id],
        )
    ).map((entry) => entry.event_type);

  const accept = async (id: string) => {
    const revision = (await row(id)).currentRevisionNumber;
    return h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/accept-revision`,
      cookies: CUSTOMER,
      payload: { expectedRevisionNumber: revision },
    });
  };

  /** Every `rfq.expired.v1` announced while `act` runs. */
  const announcedDuring = async <T>(act: () => Promise<T>) => {
    const announced: string[] = [];
    const off = h.eventBus.on('rfq.expired.v1' as never, (payload: unknown) => {
      announced.push((payload as { rfqId: string }).rfqId);
    });
    try {
      const result = await act();
      await new Promise((resolve) => setTimeout(resolve, 300));
      return { result, announced };
    } finally {
      off();
    }
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, EXPIRY_DAYS, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }, 120_000);

  afterEach(async () => {
    // Leave nothing open behind, so each case's request is the only candidate.
    await h.em().execute(
      `update "quote_requests" set "status" = 'Canceled' where "status" in ('Pending', 'Created from admin')`,
    );
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
      actorAdminUserId: null,
    });
    await teardownBackendServer(h);
  });

  // --- the rule ---------------------------------------------------------------

  describe('which requests are due', () => {
    it('a submitted request nobody answered for longer than expiry_days is due', async () => {
      const id = await submitted();
      await quietFor(id, EXPIRY_DAYS + 1);
      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
      expect(await statusOf(id)).toBe('Expired');
    });

    it('a request quiet for less than expiry_days is not', async () => {
      const id = await submitted();
      await quietFor(id, EXPIRY_DAYS - 1);
      expect(await worker().hasExpirable()).toBe(false);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Pending');
    });

    it('a request the seller drafted is due too — when it is the only one, the probe still says yes', async () => {
      const id = await createdFromAdmin();
      await quietFor(id, EXPIRY_DAYS + 1);
      expect(await statusOf(id)).toBe('Created from admin');
      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
      expect(await statusOf(id)).toBe('Expired');
    });

    it('an offer the seller dated is never expired while its validity date is ahead, and the buyer can still accept it', async () => {
      // The seller quotes with thirty days of validity; expiry_days is seven;
      // nothing happens for eight days.
      const id = await submitted();
      await quote(id, 30);
      await quietFor(id, EXPIRY_DAYS + 1);
      expect((await row(id)).expiresAt!.getTime()).toBeGreaterThan(Date.now() + 20 * DAY_MS);

      expect(await worker().hasExpirable()).toBe(false);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Pending');

      const accepted = await accept(id);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(await statusOf(id)).toBe('Approved');
    });

    it('the same holds for a request the seller drafted with a validity date', async () => {
      const id = await createdFromAdmin(30);
      await quietFor(id, EXPIRY_DAYS + 30);
      // Still twenty-nine days and more to go on the offer itself.
      await h.em().nativeUpdate(QuoteRequest, { id }, { expiresAt: new Date(Date.now() + 2 * DAY_MS) });
      expect(await worker().hasExpirable()).toBe(false);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Created from admin');
    });

    it('an offer whose validity date has passed is subject to the inactivity rule like any other request', async () => {
      const id = await submitted();
      await quote(id, 3);
      await quietFor(id, EXPIRY_DAYS + 1);
      await h.em().nativeUpdate(QuoteRequest, { id }, { expiresAt: new Date(Date.now() - DAY_MS) });
      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
      expect(await statusOf(id)).toBe('Expired');
    });

    it('a passed validity date alone expires nothing: the request has to have been quiet for expiry_days', async () => {
      const id = await submitted();
      await quote(id, 3);
      await quietFor(id, EXPIRY_DAYS - 2);
      await h.em().nativeUpdate(QuoteRequest, { id }, { expiresAt: new Date(Date.now() - DAY_MS) });
      expect(await worker().hasExpirable()).toBe(false);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Pending');
    });

    it('an offer without a validity date is subject to the inactivity rule', async () => {
      const id = await submitted();
      await quote(id);
      await quietFor(id, EXPIRY_DAYS + 1);
      expect((await row(id)).expiresAt ?? null).toBeNull();
      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
    });
  });

  // --- the clock --------------------------------------------------------------

  describe('what restarts the clock', () => {
    it('the buyer opening the request does not — it marks the revision as seen and says nothing to anybody', async () => {
      const id = await submitted();
      await quote(id);
      await quietFor(id, EXPIRY_DAYS + 1);
      const before = (await row(id)).lastCustomerSeenRevisionNumber;

      const viewed = await h.app.inject({ method: 'GET', url: `/api/v1/quote-requests/${id}`, cookies: CUSTOMER });
      expect(viewed.statusCode, viewed.body).toBe(200);
      // The view did write the row: this is the write that used to postpone expiry.
      const after = await row(id);
      expect(after.lastCustomerSeenRevisionNumber).toBeGreaterThan(before);
      expect(after.updatedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
    });

    it('an assignment does not either', async () => {
      const id = await submitted();
      await quietFor(id, EXPIRY_DAYS + 1);
      const assigned = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/quote-requests/${id}/assign`,
        cookies: ADMIN,
        payload: { adminUserId: '00000000-0000-4000-8000-0000000000b1' },
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      expect(await worker().hasExpirable()).toBe(true);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1 });
    });

    it('a revision by the seller does: it writes a history row, and the request is no longer due', async () => {
      const id = await submitted();
      await quietFor(id, EXPIRY_DAYS + 1);
      expect(await worker().hasExpirable()).toBe(true);
      await quote(id);
      expect(await worker().hasExpirable()).toBe(false);
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
      expect(await statusOf(id)).toBe('Pending');
    });
  });

  // --- races ------------------------------------------------------------------

  describe('the sweep and a transition are mutually exclusive', () => {
    /**
     * Run `inject` once at a chosen point inside the next call a service makes
     * on its EntityManager: `find` is what a transition calls between reading
     * the request and taking its row, `flush` what it calls while holding it.
     */
    const duringNext = (service: ServiceWithEm, method: 'find' | 'flush', inject: () => Promise<void>): (() => void) => {
      const original = service.deps.emFactory;
      let done = false;
      service.deps.emFactory = () => {
        const em = original();
        const target = em as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
        const real = target[method]!.bind(em);
        target[method] = async (...args: unknown[]) => {
          if (!done) {
            done = true;
            await inject();
          }
          return real(...args);
        };
        return em;
      };
      return () => {
        service.deps.emFactory = original;
      };
    };

    it('sweep first: the buyer’s accept is refused with a conflict, and the request is Expired and nothing else', async () => {
      const id = await createdFromAdmin();
      await quietFor(id, EXPIRY_DAYS + 1);
      // The accept has read the request as `Created from admin`; the sweep
      // expires it before the accept takes the row.
      let swept: Sweep | undefined;
      const restore = duringNext(handle().rfqService, 'find', async () => {
        swept = await worker().sweep();
      });
      try {
        const { result, announced } = await announcedDuring(() => accept(id));
        expect(swept).toMatchObject({ expiredCount: 1 });
        expect(result.statusCode, result.body).toBe(409);
        expect((result.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');
        expect(announced).toEqual([id]);
      } finally {
        restore();
      }
      const final = await row(id);
      expect(final.status).toBe('Expired');
      expect(final.approvedAt ?? null).toBeNull();
      const entries = await history(id);
      expect(entries.at(-1)).toBe('expired');
      expect(entries).not.toContain('approved');
      expect(entries).not.toContain('customer-accepted-revision');
    });

    it('sweep first: the seller’s approve is refused the same way', async () => {
      const id = await submitted();
      await quote(id);
      await quietFor(id, EXPIRY_DAYS + 1);
      const restore = duringNext(handle().adminService, 'find', async () => {
        await worker().sweep();
      });
      try {
        const approved = await h.app.inject({
          method: 'POST',
          url: `/api/v1/admin/quote-requests/${id}/approve`,
          cookies: ADMIN,
          payload: {},
        });
        expect(approved.statusCode, approved.body).toBe(409);
        expect((approved.json() as { error: { code: string } }).error.code).toBe('VERSION_CONFLICT');
      } finally {
        restore();
      }
      expect(await statusOf(id)).toBe('Expired');
      expect(await history(id)).not.toContain('approved');
    });

    it('accept first, still holding the row: the sweep skips the request, announces nothing, and the accept stands', async () => {
      const id = await createdFromAdmin();
      await quietFor(id, EXPIRY_DAYS + 1);
      const versionBefore = (await row(id)).version;
      let swept: Sweep | undefined;
      // The accept holds the row and is about to write it when the sweep runs.
      const restore = duringNext(handle().rfqService, 'flush', async () => {
        swept = await worker().sweep();
      });
      try {
        const { result, announced } = await announcedDuring(() => accept(id));
        expect(result.statusCode, result.body).toBe(200);
        expect(swept).toMatchObject({ expiredCount: 0, failedCount: 0 });
        expect(announced).toEqual([]);
      } finally {
        restore();
      }
      const final = await row(id);
      expect(final.status).toBe('Approved');
      expect(final.expiredAt ?? null).toBeNull();
      // One transition, one version: nothing was written over.
      expect(final.version).toBe(versionBefore + 1);
      expect(await history(id)).not.toContain('expired');
      // And the next pass has nothing to do with it.
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0 });
    });

    it('accept committed after the sweep listed the request: the re-check under the lock skips it', async () => {
      // Two due requests; the pass lists both, and while it is working on the
      // older one the buyer accepts the younger.
      const older = await submitted();
      const younger = await createdFromAdmin();
      await quietFor(older, EXPIRY_DAYS + 0.5);
      await quietFor(younger, EXPIRY_DAYS + 0.25);
      const deps = worker().deps;
      const original = deps.notificationService.enqueue;
      let accepted: number | undefined;
      deps.notificationService.enqueue = (async (...args: never[]) => {
        if (accepted === undefined) accepted = (await accept(younger)).statusCode;
        return original.apply(deps.notificationService, args);
      }) as never;
      try {
        const { result, announced } = await announcedDuring(() => worker().sweep());
        expect(accepted).toBe(200);
        expect(result).toMatchObject({ expiredCount: 1, failedCount: 0 });
        expect(announced).toEqual([older]);
      } finally {
        deps.notificationService.enqueue = original;
      }
      expect(await statusOf(older)).toBe('Expired');
      const final = await row(younger);
      expect(final.status).toBe('Approved');
      expect(final.expiredAt ?? null).toBeNull();
      expect(await history(younger)).not.toContain('expired');
    });
  });

  // --- a failing head ----------------------------------------------------------

  it('requests that fail every time do not hold the head of the batch: the next pass reaches the others', async () => {
    const failingA = await submitted();
    const failingB = await submitted();
    const healthy = await submitted();
    // Oldest first, and all within the notification grace period, so each
    // reaches the fan-out the two are made to fail in.
    await quietFor(failingA, EXPIRY_DAYS + 0.3);
    await quietFor(failingB, EXPIRY_DAYS + 0.2);
    await quietFor(healthy, EXPIRY_DAYS + 0.1);

    const deps = worker().deps;
    const original = deps.notificationService.enqueue;
    deps.notificationService.enqueue = (async (...args: never[]) => {
      const input = (args as unknown as Array<{ quoteRequestId: string }>)[0]!;
      if (input.quoteRequestId !== healthy) throw new Error('expiry rules test: this request always fails');
      return original.apply(deps.notificationService, args);
    }) as never;
    deps.batchSize = 2;
    deps.onRequestFailed = () => undefined;
    try {
      // The two failing requests are the whole first batch.
      expect(await worker().sweep()).toMatchObject({ expiredCount: 0, failedCount: 2, reachedBatchLimit: true });
      expect(await statusOf(healthy)).toBe('Pending');
      // They are left alone by the next pass, which therefore reaches the third.
      expect(await worker().sweep()).toMatchObject({ expiredCount: 1, failedCount: 0 });
      expect(await statusOf(healthy)).toBe('Expired');
      // With nothing else due, the probe says no: a failing block does not make every tick a working tick.
      expect(await worker().hasExpirable()).toBe(false);
      // After the back-off they are tried again.
      const later = new Date(Date.now() + 3 * 60 * 60_000);
      expect(await worker().hasExpirable(later)).toBe(true);
      expect(await worker().sweep(later)).toMatchObject({ expiredCount: 0, failedCount: 2 });
    } finally {
      deps.notificationService.enqueue = original;
      delete deps.batchSize;
      delete deps.onRequestFailed;
    }
  });
});
