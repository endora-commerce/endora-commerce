import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type {
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { createMinimumProduct, minimumFixtureRun, type MinimumProductFixture } from '../../helpers/order-minimum-fixture.js';
import { clearValueOverrides } from '../../helpers/product-scope-fixture.js';
import { seedScopedValues } from '../../helpers/scoped-values.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { AvailabilityNotification, CustomerAccount } from '../../helpers/package-entities.js';
import type { AvailabilityWorker } from '../../../../packages/modules/inventory/src/backend/services/availability-worker.js';
import { AvailabilityNotificationService } from '../../../../packages/modules/inventory/src/backend/services/availability-notification-service.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * Issue #696 — the buyer's back-in-stock e-mail names the product as the buyer saw it: by its
 * effective name at the subscription's sales channel and language (C×L → C → Global), which
 * `catalogProductAvailabilityPort.effectiveTexts` answers
 * (`specs/174-product-editor-scope-switcher/contracts/readers.md` §1, T067 buyer half).
 *
 * The subscription carries the scope: `subscribe` stamps the **resolved request channel** and the
 * scope language it resolved from `Accept-Language` (Constitution XII). A row written before the
 * column existed has neither and keeps the Global name, which is what 174 sent to everyone.
 *
 * Both senders are held to it: the composed `AvailabilityWorker` (the one `inventory.adjusted.v1`
 * reaches) and `AvailabilityNotificationService.processRestockedFanOut`.
 *
 * Every write here is scoped to this file's own products and subscriber e-mail addresses.
 */

const VIP = 'pl_b2b_vip';

describe('#696 — the back-in-stock e-mail names the product at the subscription scope [integration]', () => {
  let h: BackendServerHandle;
  const mailer = new InMemoryMailer();
  const RUN = minimumFixtureRun();
  let vipId: string;
  /** Global, Channel and Channel × pl-PL names. */
  let drill: MinimumProductFixture;
  /** Global and Channel names only — no Channel × language override. */
  let sander: MinimumProductFixture;
  const DRILL_GLOBAL = `Drill X ${RUN}`;
  const DRILL_CL = `Wiertarka X Pro ${RUN}`;
  const SANDER_GLOBAL = `Sander Y ${RUN}`;
  const SANDER_C = `Sander Y Pro ${RUN}`;
  const sql = (query: string, params: unknown[] = []) => h.em().getConnection().execute(query, params);

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    const em = h.em();
    vipId = (await em.findOneOrFail(SalesChannel, { code: VIP })).id;
    drill = await createMinimumProduct(em, {
      sku: `S696-DR-${RUN}`,
      nameEn: DRILL_GLOBAL,
      namePl: DRILL_GLOBAL,
      channelIds: [vipId],
    });
    sander = await createMinimumProduct(em, {
      sku: `S696-SA-${RUN}`,
      nameEn: SANDER_GLOBAL,
      namePl: SANDER_GLOBAL,
      channelIds: [vipId],
    });
    await seedScopedValues(em, drill.id, [
      { field: 'name', scope: { level: 'channel', channelId: vipId }, value: `Drill X Pro ${RUN}` },
      { field: 'name', scope: { level: 'channel_language', channelId: vipId, languageCode: 'pl-PL' }, value: DRILL_CL },
    ]);
    await seedScopedValues(em, sander.id, [
      { field: 'name', scope: { level: 'channel', channelId: vipId }, value: SANDER_C },
    ]);
    // Tracked and out of stock, so the storefront accepts a subscription.
    await sql(`update products set manage_stock = true where id in (?, ?)`, [drill.id, sander.id]);
  });

  afterAll(async () => {
    if (!h) return;
    await sql(`delete from availability_notifications where product_id in (?, ?)`, [drill.id, sander.id]);
    await clearValueOverrides(h.em(), [drill.id, sander.id]);
    await teardownBackendServer(h);
  });

  function ports(): {
    catalogProducts: CatalogProductReadPort;
    customerAccounts: CustomerAccountReadPort;
    catalogAvailability: CatalogProductAvailabilityPort;
  } {
    const cradle = h.container.cradle as never as {
      catalogProductReadPort: CatalogProductReadPort;
      customerAccountReadPort: CustomerAccountReadPort;
      catalogProductAvailabilityPort: CatalogProductAvailabilityPort;
    };
    return {
      catalogProducts: cradle.catalogProductReadPort,
      customerAccounts: cradle.customerAccountReadPort,
      catalogAvailability: cradle.catalogProductAvailabilityPort,
    };
  }

  /** The worker the composed module subscribed to `inventory.adjusted.v1`. */
  function composedWorker(): AvailabilityWorker {
    const cradle = h.container.cradle as never as Record<string, { handle: { availabilityWorker: AvailabilityWorker } }>;
    return cradle['inventory']!.handle.availabilityWorker;
  }

  type Sender = (productId: string, mail: InMemoryMailer) => Promise<{ notified: number }>;
  const senders: Array<[string, Sender]> = [
    ['the composed stock worker', (productId) => composedWorker().dispatchForStockIncrease({ productId })],
    [
      'the restock fan-out',
      (productId, mail) => {
        const { catalogProducts, customerAccounts, catalogAvailability } = ports();
        return new AvailabilityNotificationService(h.em, catalogProducts, customerAccounts, catalogAvailability, mail).processRestockedFanOut({
          productId,
        });
      },
    ],
  ];

  async function subscribeOnStorefront(productId: string, email: string, language: string) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/inventory/notify-when-available',
      headers: { 'x-sales-channel': VIP, 'accept-language': language },
      payload: { productId, email },
    });
  }

  async function reset(productId: string): Promise<void> {
    await sql(`delete from availability_notifications where product_id = ?`, [productId]);
    mailer.sent.length = 0;
  }

  /** A subscription row as a pre-#696 database holds it: no channel, no language. */
  async function seedUnscoped(productId: string): Promise<void> {
    const em = h.em();
    const customer = await em.findOneOrFail(CustomerAccount, { id: TEST_CUSTOMER_ID });
    em.create(AvailabilityNotification, {
      customerAccountId: customer.id,
      organizationId: customer.organizationId,
      productId,
      variantId: null,
    });
    await em.flush();
  }

  it('stamps the resolved request channel and scope language on the subscription', async () => {
    await reset(drill.id);
    const res = await subscribeOnStorefront(drill.id, `s696-a-${RUN}@example.test`, 'pl-PL,pl;q=0.9');
    expect(res.statusCode, res.body).toBe(202);
    const rows = (await sql(
      `select sales_channel_id, language_code from availability_notifications where product_id = ?`,
      [drill.id],
    )) as Array<{ sales_channel_id: string | null; language_code: string | null }>;
    expect(rows).toEqual([{ sales_channel_id: vipId, language_code: 'pl-PL' }]);
  });

  it('stamps the channel default language when the request asks in one the channel does not serve', async () => {
    await reset(drill.id);
    const res = await subscribeOnStorefront(drill.id, `s696-b-${RUN}@example.test`, 'de-DE');
    expect(res.statusCode, res.body).toBe(202);
    const rows = (await sql(`select language_code from availability_notifications where product_id = ?`, [
      drill.id,
    ])) as Array<{ language_code: string | null }>;
    expect(rows).toEqual([{ language_code: 'pl-PL' }]);
  });

  describe.each(senders)('%s', (_label, send) => {
    it('names the product at Channel × language', async () => {
      await reset(drill.id);
      expect((await subscribeOnStorefront(drill.id, `s696-cl-${RUN}@example.test`, 'pl-PL')).statusCode).toBe(202);
      expect((await send(drill.id, mailer)).notified).toBe(1);
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]?.subject).toBe(`Back in stock: ${DRILL_CL}`);
      expect(mailer.sent[0]?.text).toContain(`"${DRILL_CL}"`);
    });

    it('names the product at Channel when no Channel × language override exists', async () => {
      await reset(sander.id);
      expect((await subscribeOnStorefront(sander.id, `s696-c-${RUN}@example.test`, 'pl-PL')).statusCode).toBe(202);
      expect((await send(sander.id, mailer)).notified).toBe(1);
      expect(mailer.sent[0]?.subject).toBe(`Back in stock: ${SANDER_C}`);
    });

    it('falls back to the Global name for a subscription without a scope (pre-#696 rows)', async () => {
      await reset(drill.id);
      await seedUnscoped(drill.id);
      expect((await send(drill.id, mailer)).notified).toBe(1);
      expect(mailer.sent[0]?.subject).toBe(`Back in stock: ${DRILL_GLOBAL}`);
    });

    it('names each subscriber at their own scope in one fan-out', async () => {
      await reset(drill.id);
      await seedUnscoped(drill.id);
      expect((await subscribeOnStorefront(drill.id, `s696-mix-${RUN}@example.test`, 'pl-PL')).statusCode).toBe(202);
      expect((await send(drill.id, mailer)).notified).toBe(2);
      const subjects = mailer.sent.map((m) => m.subject).sort();
      expect(subjects).toEqual([`Back in stock: ${DRILL_GLOBAL}`, `Back in stock: ${DRILL_CL}`].sort());
    });
  });

  it.each(['deactivated', 'platform-unavailable'] as const)(
    'while inventory is %s it takes no subscription, and a kept one keeps its scope for after',
    async (axis) => {
      await reset(drill.id);
      expect((await subscribeOnStorefront(drill.id, `s696-off-${RUN}@example.test`, 'pl-PL')).statusCode).toBe(202);

      await withModuleOff('inventory', axis, async () => {
        const refused = await subscribeOnStorefront(drill.id, `s696-off2-${RUN}@example.test`, 'pl-PL');
        expect(refused.statusCode, refused.body).toBe(503);
        expect((refused.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
      });

      // Off is non-destructive: the one subscription taken while on is there, scoped, and queued.
      const rows = (await sql(
        `select email, status, sales_channel_id, language_code from availability_notifications where product_id = ?`,
        [drill.id],
      )) as Array<Record<string, unknown>>;
      expect(rows).toEqual([
        { email: `s696-off-${RUN}@example.test`, status: 'queued', sales_channel_id: vipId, language_code: 'pl-PL' },
      ]);

      // Restored, the composed worker names the product at that scope.
      expect((await composedWorker().dispatchForStockIncrease({ productId: drill.id })).notified).toBe(1);
      expect(mailer.sent[0]?.subject).toBe(`Back in stock: ${DRILL_CL}`);
    },
  );
});
