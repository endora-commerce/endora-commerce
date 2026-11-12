import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORDER_EXTERNAL_REFERENCE_PORT, type OrderExternalReferencePort } from '@endora-commerce/contracts';
import { enterSystemScope } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CRM_ADMIN, seedCrmOrder } from '../../helpers/seed-crm.js';

/**
 * Issue #1030 — the admin orders list finds an order by the number an
 * external system gave it. An operator with the ERP's number on the phone
 * types it into the list's search, and the order the connector recorded that
 * number on comes back, whatever system recorded it.
 *
 * Every reference carries this file's own run tag, because the suite shares
 * one database and the list is unscoped for a platform admin.
 */
const RUN = randomUUID().slice(0, 8).toUpperCase();

interface ListBody {
  data: Array<{ id: string }>;
  pagination: { total: number };
}

describe('admin orders list — search by external reference (issue #1030)', () => {
  let h: BackendServerHandle;
  let erpOrderId: string;
  let wmsOrderId: string;
  let plainOrderId: string;

  const search = async (q: string): Promise<string[]> => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders?q=${encodeURIComponent(q)}&pageSize=100`,
      cookies: CRM_ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as ListBody).data.map((row) => row.id).sort();
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    erpOrderId = (await seedCrmOrder(em)).id;
    wmsOrderId = (await seedCrmOrder(em)).id;
    plainOrderId = (await seedCrmOrder(em)).id;
    const port = h.container.resolve<OrderExternalReferencePort>(ORDER_EXTERNAL_REFERENCE_PORT);
    await enterSystemScope('test: connectors record their references', async () => {
      await port.set(erpOrderId, 'erp_connector', { state: 'synced', reference: `ZS/${RUN}/1042` });
      await port.set(wmsOrderId, 'wms_connector', { state: 'synced', reference: `WMS-${RUN}-7` });
      await port.set(plainOrderId, 'erp_connector', { state: 'error', message: `Order ZS/${RUN}/1042 refused` });
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('finds the order by its full external reference', async () => {
    expect(await search(`ZS/${RUN}/1042`)).toEqual([erpOrderId]);
  });

  it('finds it by a fragment, case-insensitively, as the order number search does', async () => {
    expect(await search(`zs/${RUN.toLowerCase()}`)).toEqual([erpOrderId]);
  });

  it('matches a reference whichever system recorded it', async () => {
    expect(await search(`WMS-${RUN}`)).toEqual([wmsOrderId]);
    expect(await search(RUN)).toEqual([erpOrderId, wmsOrderId].sort());
  });

  it('does not match an external system’s message', async () => {
    expect(await search(`ZS/${RUN}/1042 refused`)).toEqual([]);
  });
});
