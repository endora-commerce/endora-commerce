import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 054 (US3 / T030) — a converted Command emits its domain event through
 * the bus's EventBus.run scope, dispatched exactly once on commit with a
 * byte-identical payload for existing subscribers (SC-004). The rollback case
 * (commit ⇒ event once, throw ⇒ none) is covered generically by
 * command-bus.transaction.test.ts.
 */
describe('domain event via Command — product.updated.v1 [real DB]', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('dispatches product.updated.v1 once on commit with the legacy payload shape', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'CMDBUS-EVT-1',
        type: 'simple',
        name: { 'en-US': 'Evt product' },
        description: { 'en-US': 'desc' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;

    // Subscribe AFTER create so only the update event is captured. The harness's
    // CommandBus shares this eventBus instance, so buffered emissions dispatch here.
    const received: Array<Record<string, unknown>> = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      received.push(payload as unknown as Record<string, unknown>);
    });

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { name: { 'en-US': 'Evt product renamed' } },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    off();

    const mine = received.filter((p) => p['productId'] === id);
    expect(mine).toHaveLength(1); // dispatched exactly once on commit
    // Byte-compatible payload: same keys the legacy emit produced.
    expect(Object.keys(mine[0]!).sort()).toEqual(
      ['changedFields', 'eventId', 'occurredAt', 'productId'].sort(),
    );
    expect(mine[0]!['changedFields']).toContain('name');
  });
});
