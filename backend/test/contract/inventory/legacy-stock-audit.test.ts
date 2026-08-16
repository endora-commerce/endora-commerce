import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Issue #122 — the legacy single-bucket stock write audits like the other one.
 *
 * `PUT /api/v1/admin/inventory` is foundation 001's backward-compatible stock
 * setter. The audited path for a stock change has been `StockLevelService`
 * (`stock_level.adjust`) since feature 024, and this endpoint wrote straight
 * through the EntityManager instead, recording nothing — invisible to
 * `check-command-coverage`, which never opened a `routes*.ts` file.
 *
 * `admin-stock.test.ts` claims this surface is "covered by `legacy-stock.test.ts`".
 * That file has never existed.
 */
const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';

describe('legacy admin stock write (issue #122)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const put = (onHand: number) =>
    h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/inventory',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { productId: SEED_PRODUCT_101_ID, onHand },
    });

  it('records a stock_level.adjust entry carrying the delta', async () => {
    const first = await put(41);
    expect(first.statusCode).toBe(200);
    const second = await put(77);
    expect(second.statusCode).toBe(200);
    expect((second.json() as { data: { onHand: number } }).data.onHand).toBe(77);

    const entries = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const last = entries.at(-1)!;
    expect((last.stateBefore as { onHand?: number } | null)?.onHand).toBe(41);
    expect((last.stateAfter as { onHand?: number; delta?: number } | null)?.onHand).toBe(77);
    expect((last.stateAfter as { delta?: number } | null)?.delta).toBe(36);
  });

  it('writes no audit row when the value does not change', async () => {
    await put(77);
    const before = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    await put(77);
    const after = await h.em().find(AuditLogEntry, {
      action: 'stock_level.adjust',
      objectId: `${SEED_PRODUCT_101_ID}:${DEFAULT_WAREHOUSE_ID}`,
    });
    // "no write ⇒ no audit row", the same rule `CommandOutcome.skipAudit` keeps.
    expect(after.length).toBe(before.length);
  });
});
