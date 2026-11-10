import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #997 — an audit entry written through the Command Bus during an admin
 * request carries that request's client IP, user agent and request id, the same
 * three fields a direct `auditLogService.record` call takes from the request
 * (`request.ip`, the `user-agent` header, `request.id`).
 *
 * `PATCH /admin/catalog/products/:id` writes through `CommandBus.run`
 * (`product.update`), on the bus the harness composes exactly as the production
 * root does. The outside-a-request cases are unit-tested beside the bus
 * (`packages/platform/src/commands/command-bus-request-meta.test.ts`).
 */
describe('Command Bus audit entry — request metadata [real DB] (issue #997)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it("stamps the admin request's IP, user agent and request id on the bus-written entry", async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'CMDBUS-META-997',
        type: 'simple',
        name: 'Request meta product',
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;

    const requestId = `req-997-${id}`;
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${id}`,
      payload: { name: 'Request meta product renamed' },
      cookies: adminCookie,
      remoteAddress: '203.0.113.97',
      headers: { 'x-request-id': requestId, 'user-agent': 'issue-997-agent/1.0' },
    });
    expect(res.statusCode).toBe(200);

    const entries = await h.em().find(AuditLogEntry, { action: 'product.update', objectId: id });
    expect(entries).toHaveLength(1);
    expect({
      ipAddress: entries[0]!.ipAddress,
      userAgent: entries[0]!.userAgent,
      requestId: entries[0]!.requestId,
    }).toEqual({
      ipAddress: '203.0.113.97',
      userAgent: 'issue-997-agent/1.0',
      requestId,
    });
  });
});
