import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * T046 — Negotiation loop integration test.
 *
 * Covers the full US3 cycle:
 *   1. Customer submits → Pending
 *   2. Admin modifies → awaiting customer revision acceptance
 *   3. Customer rejects revision → Canceled
 *
 * Plus the happy path (customer accepts revision → Approved) and the
 * stale-revision-number 409 conflict.
 */
describe('Quote Requests — negotiation loop (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createPending(quantity = 50, desiredUnitPrice = 8): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity, desiredUnitPrice }],
      },
    });
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('admin modify flips awaiting_customer_revision_acceptance and emits a modified event with diff', async () => {
    const created = await createPending();
    const modifyRes = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 8.5 },
        ],
      },
    });
    expect(modifyRes.statusCode).toBe(200);
    const modified = (modifyRes.json() as { data: { awaitingCustomerRevisionAcceptance: boolean; currentRevisionNumber: number; events: Array<{ eventType: string; payload: Record<string, unknown> }> } }).data;
    expect(modified.awaitingCustomerRevisionAcceptance).toBe(true);
    expect(modified.currentRevisionNumber).toBeGreaterThan(0);
    const modifyEvent = modified.events.find((e) => e.eventType === 'modified');
    expect(modifyEvent).toBeDefined();
    expect(modifyEvent?.payload).toMatchObject({ type: 'modified' });
  });

  it('customer accepts revision → Approved', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 8.25 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;

    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: detail.currentRevisionNumber },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = (acceptRes.json() as { data: { status: string; awaitingCustomerRevisionAcceptance: boolean } }).data;
    expect(accepted.status).toBe('Approved');
    expect(accepted.awaitingCustomerRevisionAcceptance).toBe(false);
  });

  it('customer rejects revision with reason → Canceled', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 12.0 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { currentRevisionNumber: number } }).data;

    const rejectRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/reject-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        expectedRevisionNumber: detail.currentRevisionNumber,
        reason: 'Price too high',
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    const rejected = (rejectRes.json() as { data: { status: string; cancellationReason: string | null } }).data;
    expect(rejected.status).toBe('Canceled');
    expect(rejected.cancellationReason).toBe('Price too high');
  });

  it('rejects accept-revision with stale expectedRevisionNumber (409)', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 50, agreedUnitPrice: 9.0 }],
      },
    });
    const acceptRes = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${created.id}/accept-revision`,
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { expectedRevisionNumber: 999 },
    });
    expect(acceptRes.statusCode).toBe(409);
  });

  it('detail surfaces a comparison block while awaiting acceptance', async () => {
    const created = await createPending();
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      headers: { 'if-match': `"${created.version}"` },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 60, agreedUnitPrice: 8.0 }],
      },
    });
    const detailRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${created.id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (detailRes.json() as { data: { comparisonAgainstLastSeen: { diff: Array<{ kind: string }> } | null } }).data;
    expect(detail.comparisonAgainstLastSeen).not.toBeNull();
    const kinds = detail.comparisonAgainstLastSeen?.diff.map((d) => d.kind);
    expect(kinds).toContain('line_quantity');
    expect(kinds).toContain('line_agreed_unit_price');
  });
  // -------------------------------------------------------------------------
  // Feature 146, Phase 6 — the draft-edit guard (FR-038, US1 #11; research
  // R15; threat model T3). A customer may edit until an administrator has
  // revised the request, and never after — whichever of the three marks of an
  // admin revision happens to be visible first.
  // -------------------------------------------------------------------------
  describe('146 — customer draft edits (FR-038, T3)', () => {
    const OWNER = { b2b_session: 'stub-customer-session' };
    const COLLEAGUE = { b2b_session: 'stub-customer-session-rfq' };

    const sql = <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
      h.em().getConnection().execute<T[]>(query, params);

    const createAs = async (cookies: Record<string, string>): Promise<{ id: string; version: number }> => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/quote-requests',
        cookies,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 5, desiredUnitPrice: 8 }] },
      });
      expect(res.statusCode, res.body).toBe(201);
      return (res.json() as { data: { id: string; version: number } }).data;
    };

    const editAs = (cookies: Record<string, string>, id: string, quantity: number) =>
      h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${id}`,
        cookies,
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity }] },
      });

    /** What a refused edit must have left exactly as it was. */
    const footprint = async (id: string) => {
      const em = h.em();
      em.clear();
      const lines = await em.find(QuoteRequestItem, { quoteRequestId: id });
      const [row] = await sql<{ version: number; current_revision_number: number }>(
        'select version, current_revision_number from quote_requests where id = ?',
        [id],
      );
      const [counts] = await sql<{ revisions: string; events: string }>(
        `select (select count(*) from quote_request_revisions where quote_request_id = ?) as revisions,
                (select count(*) from quote_request_events where quote_request_id = ?) as events`,
        [id, id],
      );
      return {
        quantities: lines.map((l) => l.quantity).sort(),
        version: Number(row!.version),
        revision: Number(row!.current_revision_number),
        revisions: Number(counts!.revisions),
        events: Number(counts!.events),
      };
    };

    const expectNotDraft = (res: { statusCode: number; body: string; json: () => unknown }) => {
      expect(res.statusCode, res.body).toBe(409);
      expect((res.json() as { error: { code: string } }).error.code).toBe('RFQ_NOT_DRAFT');
    };

    it('consecutive customer edits succeed — two, then five more (customer-only edits never close the draft)', async () => {
      const { id } = await createAs(OWNER);
      for (let edit = 1; edit <= 7; edit += 1) {
        const res = await editAs(OWNER, id, 10 + edit);
        expect(res.statusCode, `edit ${edit}: ${res.body}`).toBe(200);
      }
      expect((await footprint(id)).quantities).toEqual([17]);
    });

    it('after an admin modify, a further customer edit is refused 409 RFQ_NOT_DRAFT and writes nothing', async () => {
      const created = await createAs(OWNER);
      expect((await editAs(OWNER, created.id, 6)).statusCode).toBe(200);
      const [row] = await sql<{ version: number }>('select version from quote_requests where id = ?', [created.id]);
      const version = row!.version;
      const modify = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/quote-requests/${created.id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        headers: { 'if-match': `"${Number(version)}"` },
        payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 6, agreedUnitPrice: 7.5 }] },
      });
      expect(modify.statusCode, modify.body).toBe(200);

      const before = await footprint(created.id);
      expectNotDraft(await editAs(OWNER, created.id, 99));
      expect(await footprint(created.id)).toEqual(before);
    });

    it('an admin note-added event does not close the draft', async () => {
      const { id } = await createAs(OWNER);
      await sql(
        `insert into quote_request_events (id, quote_request_id, event_type, actor_admin_user_id, actor_role_label, payload, created_at)
         values (gen_random_uuid(), ?, 'note-added', ?, 'Admin', ?::jsonb, now())`,
        [id, TEST_ADMIN_ID, JSON.stringify({ type: 'note-added', note: 'internal' })],
      );
      const res = await editAs(OWNER, id, 9);
      expect(res.statusCode, res.body).toBe(200);
    });

    it('is refused when only awaitingCustomerRevisionAcceptance is set', async () => {
      const { id } = await createAs(OWNER);
      await sql('update quote_requests set awaiting_customer_revision_acceptance = true where id = ?', [id]);
      const before = await footprint(id);
      expectNotDraft(await editAs(OWNER, id, 9));
      expect(await footprint(id)).toEqual(before);
    });

    it('is refused when only the latest revision is admin-authored, with no modified event yet', async () => {
      const { id } = await createAs(OWNER);
      await sql(
        `update quote_request_revisions
            set created_by_admin_user_id = ?, created_by_customer_account_id = null
          where quote_request_id = ?
            and revision_number = (select max(revision_number) from quote_request_revisions where quote_request_id = ?)`,
        [TEST_ADMIN_ID, id, id],
      );
      const before = await footprint(id);
      expectNotDraft(await editAs(OWNER, id, 9));
      expect(await footprint(id)).toEqual(before);
    });

    it('an organization administrator editing a colleague’s draft does not close it', async () => {
      const { id } = await createAs(COLLEAGUE);
      expect((await editAs(OWNER, id, 7)).statusCode).toBe(200);
      expect((await editAs(OWNER, id, 8)).statusCode).toBe(200);
      const res = await editAs(COLLEAGUE, id, 9);
      expect(res.statusCode, res.body).toBe(200);
      expect((await footprint(id)).quantities).toEqual([9]);
    });

    // T037a — a customer edit racing an admin `modify` must be refused, and
    // must never write over the admin revision. The modify used to commit its
    // revision and line rewrite before it appended its `modified` event, which
    // opened a window between the two; since
    // `specs/179-rfq-and-customer-notifications/` WP-04 all three commit in the
    // row lock's transaction, so the window is gone and the edit waits on the
    // lock instead.
    describe('race with an admin modify (T037a)', () => {
      interface EventServiceLike {
        append: (input: { eventType: string; actor: { adminUserId?: string } }, ...rest: unknown[]) => Promise<unknown>;
      }
      const adminEventService = () =>
        (
          h.container.cradle as unknown as {
            quoteRequests: { handle(): { adminService: { deps: { eventService: EventServiceLike } } } };
          }
        ).quoteRequests.handle().adminService.deps.eventService;

      it('a customer edit while the admin modify is in flight waits for it, is refused and writes nothing', async () => {
        const created = await createAs(OWNER);
        const committedBefore = await footprint(created.id);
        const eventService = adminEventService();
        const original = eventService.append;
        let reached!: () => void;
        const gateReached = new Promise<void>((resolve) => (reached = resolve));
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        eventService.append = async function (input, ...rest) {
          if (input.eventType === 'modified' && input.actor.adminUserId) {
            reached();
            await gate;
          }
          return original.call(this, input, ...rest);
        };
        try {
          const modify = h.app.inject({
            method: 'PATCH',
            url: `/api/v1/admin/quote-requests/${created.id}`,
            cookies: { b2b_session: 'stub-admin-session' },
            headers: { 'if-match': `"${created.version}"` },
            payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 40, agreedUnitPrice: 7 }] },
          });
          await gateReached;
          // The admin's lines, revision and event commit together: while the
          // event is not yet appended, none of them is visible.
          const [adminEvents] = await sql<{ n: string }>(
            `select count(*) as n from quote_request_events
              where quote_request_id = ? and event_type = 'modified' and actor_admin_user_id is not null`,
            [created.id],
          );
          expect(Number(adminEvents!.n)).toBe(0);
          expect(await footprint(created.id)).toEqual(committedBefore);

          // The edit passes its checks against what is committed and then
          // waits on the row the modify holds.
          const edit = editAs(OWNER, created.id, 1);
          await new Promise((resolve) => setTimeout(resolve, 200));
          release();
          expect((await modify).statusCode).toBe(200);
          const refused = await edit;
          expect(refused.statusCode, refused.body).toBe(409);
        } finally {
          release();
          eventService.append = original;
        }
        const after = await footprint(created.id);
        expect(after.quantities).toEqual([40]);
        const [customerRevisions] = await sql<{ n: string }>(
          `select count(*) as n from quote_request_revisions
            where quote_request_id = ? and revision_number > 1 and created_by_customer_account_id is not null`,
          [created.id],
        );
        expect(Number(customerRevisions!.n)).toBe(0);
      });

      it('a customer edit waiting on the row lock re-checks the guard once it holds the row', async () => {
        const { id } = await createAs(OWNER);
        // A second connection holds the row, as an admin rewrite in flight
        // would, and in that transaction the request gains an admin-authored
        // revision without its version moving — so neither the pre-lock check
        // nor the version comparison can be what refuses the waiting edit.
        const before = await footprint(id);
        const holder = h.em().fork();
        await holder.begin();
        let committed = false;
        try {
          await holder.execute('select id from quote_requests where id = ? for update', [id]);
          const edit = editAs(OWNER, id, 3);
          // Wait — by observation, never by a sleep alone — until the edit is
          // blocked on this row.
          const deadline = Date.now() + 10_000;
          for (;;) {
            const waiting = await sql<{ n: string }>(
              `select count(*) as n from pg_stat_activity
                where wait_event_type = 'Lock' and query ilike '%from "quote_requests"%for update%'`,
            );
            if (Number(waiting[0]!.n) > 0) break;
            if (Date.now() > deadline) throw new Error('the customer edit never waited on the row lock');
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          await holder.execute(
            `update quote_request_revisions
                set created_by_admin_user_id = ?, created_by_customer_account_id = null
              where quote_request_id = ?`,
            [TEST_ADMIN_ID, id],
          );
          await holder.commit();
          committed = true;
          const res = await edit;
          expectNotDraft(res);
          expect(await footprint(id)).toEqual(before);
        } finally {
          if (!committed) await holder.rollback();
        }
      });
    });
  });
});
