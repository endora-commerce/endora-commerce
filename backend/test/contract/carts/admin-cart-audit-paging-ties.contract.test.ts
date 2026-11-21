import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Cart, CartAuditEntry } from '../../helpers/package-entities.js';
import { collectTiedPages, expectTiesInIdOrder, TIE_PAGE_SIZE, TIE_ROW_COUNT } from '../../helpers/paging-ties.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #1760 — a cart's audit feed pages by offset, newest first. Entries
 * written in the same instant need `id` as the tie-breaker, or a page boundary
 * repeats one entry and skips another.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('GET /api/v1/admin/carts/:id/audit — paging through equal timestamps (issue #1760)', () => {
  let h: BackendServerHandle;
  let cartId = '';
  let seededIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const cart = em.create(Cart, {
      anonymousCartToken: `anon-audit-ties-${Date.now()}`,
      salesChannelId: await systemDefaultSalesChannelId(em),
    });
    await em.persistAndFlush(cart);
    cartId = cart.id;
    const occurredAt = new Date('2001-02-03T04:05:06.000Z');
    const entries = Array.from({ length: TIE_ROW_COUNT }, () =>
      em.create(CartAuditEntry, { cartId, occurredAt, actorType: 'system', action: 'status_changed' }),
    );
    await em.persistAndFlush(entries);
    seededIds = entries.map((e) => e.id);
  });

  afterAll(async () => {
    if (cartId !== '') {
      const connection = h.em().getConnection();
      await connection.execute('delete from cart_audit_entries where cart_id = ?', [cartId]);
      await connection.execute('delete from carts where id = ?', [cartId]);
    }
    await teardownBackendServer(h);
  });

  it('sees every tied entry exactly once, ordered by id desc', async () => {
    const collected = await collectTiedPages(1, async (page) => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/carts/${cartId}/audit?page=${page}&pageSize=${TIE_PAGE_SIZE}`,
        cookies: ADMIN_COOKIE,
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: Array<{ id: string }> };
      return body.data.map((r) => r.id);
    });
    expectTiesInIdOrder(collected, seededIds, 'desc');
  });
});
