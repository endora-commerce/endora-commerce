import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { buyerChannelIds, createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import type {
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { AvailabilityWorker } from '../../../../packages/modules/inventory/src/backend/services/availability-worker.js';
import { AvailabilityNotificationService } from '../../../../packages/modules/inventory/src/backend/services/availability-notification-service.js';
import { AvailabilityNotification, CustomerAccount } from '../../helpers/package-entities.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * Issue #468 — the back-in-stock e-mail asks whether the product is still for sale before it
 * is sent. Product owner ruling (2026-11-07), global state only (per-channel and per-audience
 * checks wait on #696):
 *
 *   - deleted, or not found → the subscription is cancelled (a delete cannot be undone);
 *   - archived, globally `inactive`, or outside the global publication window → the
 *     subscription stays queued, not sent and not marked notified;
 *   - otherwise → sent, as before.
 *
 * Both send paths are held to it: `AvailabilityWorker.dispatchForStockIncrease`, which is the
 * one `inventory.adjusted.v1` reaches, and `AvailabilityNotificationService.processRestockedFanOut`.
 */

type Path = 'worker' | 'service';

describe('#468 — the back-in-stock e-mail is sent only for a product that is still for sale [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  let product: MinimumProductFixture;
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);

  beforeAll(async () => {
    h = await setupBackendServer();
    product = await createMinimumProduct(h.em(), {
      sku: `S468-${RUN}`,
      nameEn: `Restock ${RUN}`,
      namePl: `Restock ${RUN}`,
      channelIds: await buyerChannelIds(h.em()),
    });
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from availability_notifications where product_id = ?`, [product.id]);
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await sql(`delete from availability_notifications where product_id = ?`, [product.id]);
    await sql(
      `update products set status = 'active', archived_at = null, deleted_at = null,
         publish_from = null, publish_until = null where id = ?`,
      [product.id],
    );
  });

  async function subscribe(): Promise<string> {
    const em = h.em();
    const customer = await em.findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    const row = em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      organizationId: customer.organizationId,
      productId: product.id,
      variantId: null,
    });
    await em.flush();
    return row.id;
  }

  async function restock(path: Path, mailer: InMemoryMailer): Promise<number> {
    const cradle = h.container.cradle as never as {
      catalogProductReadPort: CatalogProductReadPort;
      customerAccountReadPort: CustomerAccountReadPort;
      catalogProductAvailabilityPort: CatalogProductAvailabilityPort;
    };
    if (path === 'worker') {
      const worker = new AvailabilityWorker(
        h.em,
        mailer,
        cradle.catalogProductReadPort,
        cradle.customerAccountReadPort,
      );
      return (await worker.dispatchForStockIncrease({ productId: product.id })).notified;
    }
    const service = new AvailabilityNotificationService(
      h.em,
      cradle.catalogProductReadPort,
      cradle.customerAccountReadPort,
      cradle.catalogProductAvailabilityPort,
      mailer,
    );
    return (await service.processRestockedFanOut({ productId: product.id })).notified;
  }

  async function rowOf(id: string): Promise<{ status: string; notified_at: Date | null }> {
    const rows = (await sql(`select status, notified_at from availability_notifications where id = ?`, [
      id,
    ])) as Array<{ status: string; notified_at: Date | null }>;
    return rows[0]!;
  }

  for (const path of ['worker', 'service'] as const) {
    describe(`through the ${path === 'worker' ? 'stock worker' : 'restock fan-out'}`, () => {
      it('an available product: the subscriber is mailed and the row is notified', async () => {
        const id = await subscribe();
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(1);
        expect(mailer.sent).toHaveLength(1);
        expect((await rowOf(id)).notified_at).not.toBeNull();
      });

      it('a deleted product: nothing is sent and the subscription is cancelled', async () => {
        const id = await subscribe();
        await sql(`update products set deleted_at = now() where id = ?`, [product.id]);
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(0);
        expect(mailer.sent).toHaveLength(0);
        expect((await rowOf(id)).status).toBe('cancelled');
      });

      it('an archived product: nothing is sent and the subscription stays queued', async () => {
        const id = await subscribe();
        await sql(`update products set archived_at = now() where id = ?`, [product.id]);
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(0);
        expect(mailer.sent).toHaveLength(0);
        expect(await rowOf(id)).toEqual({ status: 'queued', notified_at: null });
      });

      it('a globally inactive product: nothing is sent and the subscription stays queued', async () => {
        const id = await subscribe();
        await sql(`update products set status = 'inactive' where id = ?`, [product.id]);
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(0);
        expect(mailer.sent).toHaveLength(0);
        expect(await rowOf(id)).toEqual({ status: 'queued', notified_at: null });
      });

      it('a subscription cancelled by the customer or an admin is never mailed', async () => {
        const id = await subscribe();
        // What `AvailabilityNotificationService.cancel` writes: the status, and no `notifiedAt`.
        await sql(`update availability_notifications set status = 'cancelled' where id = ?`, [id]);
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(0);
        expect(mailer.sent).toHaveLength(0);
        expect(await rowOf(id)).toEqual({ status: 'cancelled', notified_at: null });
      });

      it('a product outside its global publication window: nothing is sent and the subscription stays queued', async () => {
        const id = await subscribe();
        await sql(`update products set publish_from = now() + interval '1 day' where id = ?`, [product.id]);
        const mailer = new InMemoryMailer();
        expect(await restock(path, mailer)).toBe(0);
        expect(mailer.sent).toHaveLength(0);
        expect(await rowOf(id)).toEqual({ status: 'queued', notified_at: null });
      });
    });
  }
});
