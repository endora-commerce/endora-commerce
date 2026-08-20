import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  PwaPublicConfigSchema,
  PWA_SETTING_CODES,
  type PushProvider,
  type PushSendResult,
} from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { seedShippedOrder, RFQ_SHIPPED_ORDER_ID } from '../../helpers/seed-commerce.js';
import { makePushDeliveryProcessor } from '../../../src/modules/pwa/workers/push-delivery-worker.js';

/**
 * Settings writes invalidate the cache via a fire-and-forget EventBus handler
 * (`emit` does not await). Yield long enough for the async invalidation +
 * (in the order-trigger test) the push event subscriber to run.
 */
const settleEvents = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

/**
 * Contract + integration coverage for the PWA module (feature 046):
 *   - admin config GET/PUT + VAPID generate (T013)
 *   - storefront public config + push gating (T022)
 *   - subscription register/revoke (T032)
 *   - admin send → queued deliveries (T034)
 *   - delivery processor idempotency + dead-sub pruning (T035)
 *   - order-status auto-trigger creates a message (T036)
 */
describe('PWA module — admin + storefront', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const channelHeader = { 'x-sales-channel': 'default' };

  let originalSecretKey: string | undefined;

  beforeAll(async () => {
    // Writing the VAPID private key (a `secret` setting) needs the encryption
    // key set BEFORE the settings module is constructed (composition time).
    originalSecretKey = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      originalSecretKey ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
    if (originalSecretKey === undefined) delete process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
    else process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] = originalSecretKey;
  });

  // Reset PWA settings to defaults between tests (global scope).
  beforeEach(async () => {
    const actor = { actorAdminUserId: null };
    for (const code of [
      PWA_SETTING_CODES.PUSH_ENABLED,
      PWA_SETTING_CODES.CACHING_ENABLED,
    ]) {
      await h.settings.adminService.setValueForAllChannels(code, false, null, actor);
    }
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, '', null, actor);
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PRIVATE_KEY, '', null, actor);
    await settleEvents();
  });

  /** Enable push (+ a public VAPID key) globally and wait for cache invalidation. */
  async function enablePush(): Promise<void> {
    const actor = { actorAdminUserId: null };
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_ENABLED, true, null, actor);
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, 'BPUB', null, actor);
    await settleEvents();
  }

  // ---- T013 admin config ----
  it('admin reads config, generates VAPID, and writes values', async () => {
    const get1 = await h.app.inject({ method: 'GET', url: '/api/v1/admin/pwa/config', cookies: adminCookie });
    expect(get1.statusCode).toBe(200);
    expect(get1.json()).toMatchObject({ appName: expect.any(String), vapidPrivateKeyIsSet: false });

    const gen = await h.app.inject({ method: 'POST', url: '/api/v1/admin/pwa/vapid/generate', cookies: adminCookie });
    expect(gen.statusCode).toBe(200);
    expect(gen.json().publicKey).toBeTruthy();

    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/pwa/config',
      cookies: adminCookie,
      payload: { appName: 'Acme Store', pushEnabled: true },
    });
    expect(put.statusCode).toBe(200);

    const get2 = await h.app.inject({ method: 'GET', url: '/api/v1/admin/pwa/config', cookies: adminCookie });
    expect(get2.json()).toMatchObject({
      appName: 'Acme Store',
      pushEnabled: true,
      vapidPrivateKeyIsSet: true,
    });
  });

  it('writes a per-channel override and resets it back to global', async () => {
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;

    // Establish a distinct global value first.
    const putGlobal = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/pwa/config',
      cookies: adminCookie,
      payload: { appName: 'Global Store' },
    });
    expect(putGlobal.statusCode).toBe(200);

    // A per-channel override wins for that channel's scope.
    const putChannel = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/pwa/config',
      cookies: adminCookie,
      payload: { salesChannelId: channelId, appName: 'Channel Store' },
    });
    expect(putChannel.statusCode).toBe(200);
    await settleEvents();

    const getOverride = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/pwa/config?salesChannelId=${channelId}`,
      cookies: adminCookie,
    });
    expect(getOverride.json().appName).toBe('Channel Store');

    // Reset clears the override; the channel inherits the global value again.
    const reset = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/config/reset',
      cookies: adminCookie,
      payload: { salesChannelId: channelId },
    });
    expect(reset.statusCode).toBe(200);
    await settleEvents();

    const getAfter = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/pwa/config?salesChannelId=${channelId}`,
      cookies: adminCookie,
    });
    expect(getAfter.json().appName).toBe('Global Store');
  });

  it('rejects an unauthenticated admin config read', async () => {
    const r = await h.app.inject({ method: 'GET', url: '/api/v1/admin/pwa/config' });
    expect(r.statusCode).toBe(401);
  });

  // ---- T022 storefront config ----
  it('serves storefront config; pushEnabled gated on a public VAPID key', async () => {
    // push enabled but no key → pushEnabled false to the client.
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_ENABLED, true, null, { actorAdminUserId: null });
    await settleEvents();
    const r1 = await h.app.inject({ method: 'GET', url: '/api/v1/storefront/pwa/config', headers: channelHeader });
    expect(r1.statusCode).toBe(200);
    const cfg1 = PwaPublicConfigSchema.parse(r1.json());
    expect(cfg1.pushEnabled).toBe(false);
    expect(cfg1.vapidPublicKey).toBe('');

    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.VAPID_PUBLIC_KEY, 'BPUB', null, { actorAdminUserId: null });
    await settleEvents();
    const r2 = await h.app.inject({ method: 'GET', url: '/api/v1/storefront/pwa/config', headers: channelHeader });
    const cfg2 = PwaPublicConfigSchema.parse(r2.json());
    expect(cfg2.pushEnabled).toBe(true);
    expect(cfg2.vapidPublicKey).toBe('BPUB');
  });

  // ---- T032 subscriptions ----
  it('subscribe is 403 when push disabled, 201 when enabled, and revoke is 204', async () => {
    const sub = {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    };

    const denied = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/pwa/subscriptions',
      headers: channelHeader,
      payload: sub,
    });
    expect(denied.statusCode).toBe(403);

    await enablePush();

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/pwa/subscriptions',
      headers: channelHeader,
      payload: sub,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().status).toBe('active');

    // Re-subscribe is idempotent → 200.
    const again = await h.app.inject({
      method: 'POST',
      url: '/api/v1/storefront/pwa/subscriptions',
      headers: channelHeader,
      payload: sub,
    });
    expect(again.statusCode).toBe(200);

    const revoked = await h.app.inject({
      method: 'DELETE',
      url: '/api/v1/storefront/pwa/subscriptions',
      headers: channelHeader,
      payload: { endpoint: sub.endpoint },
    });
    expect(revoked.statusCode).toBe(204);
  });

  // ---- T034 admin send ----
  it('admin send queues one delivery per active subscriber (202)', async () => {
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await enablePush();

    await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: channelId,
      customerAccountId: null,
    });

    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/messages',
      cookies: adminCookie,
      payload: {
        salesChannelId: channelId,
        title: 'Sale',
        body: 'Big discounts today',
        audience: { kind: 'all' },
      },
    });
    expect(sent.statusCode).toBe(202);
    expect(sent.json().queuedDeliveries).toBeGreaterThanOrEqual(1);
  });

  // ---- T035 delivery processor (idempotent + prune) ----
  it('delivery processor sends once and prunes a gone subscription', async () => {
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await enablePush();

    // A live sub (provider returns ok) and a dead sub (provider returns gone).
    const live = await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/live-${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: channelId,
      customerAccountId: null,
    });
    const dead = await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/dead-${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: channelId,
      customerAccountId: null,
    });

    // Register a fake provider so no real network call happens.
    const fake: PushProvider = {
      key: 'web_push',
      async isConfigured() {
        return true;
      },
      async send(sub): Promise<PushSendResult> {
        return sub.endpoint.includes('dead-') ? { ok: false, gone: true } : { ok: true };
      },
    };
    h.pwa.providerRegistry.register(fake);

    const { messageId } = await h.pwa.messageService.createAndEnqueue({
      salesChannelId: channelId,
      title: 'T',
      body: 'B',
      audience: { kind: 'all' },
      trigger: 'admin',
    });

    const process = makePushDeliveryProcessor({ emFactory: h.em, registry: h.pwa.providerRegistry });
    const em = h.em();
    const deliveries = await em.getConnection().execute(
      `select id, subscription_id from push_message_deliveries where message_id = ?`,
      [messageId],
    );
    for (const d of deliveries as Array<{ id: string }>) {
      await process({ data: { deliveryId: d.id } } as never);
      // Second run must be a no-op (idempotent) — should not throw.
      await process({ data: { deliveryId: d.id } } as never);
    }

    // Dead subscription pruned; live one survives.
    const liveStill = await h.em().getConnection().execute(
      `select count(*)::int as n from push_subscriptions where id = ?`,
      [live.id],
    );
    const deadGone = await h.em().getConnection().execute(
      `select count(*)::int as n from push_subscriptions where id = ?`,
      [dead.id],
    );
    expect((liveStill as Array<{ n: number }>)[0]!.n).toBe(1);
    expect((deadGone as Array<{ n: number }>)[0]!.n).toBe(0);
  });

  // ---- T036 order-status auto-trigger ----
  it('an order-status event creates exactly one push message (idempotent)', async () => {
    await enablePush();

    // Use the shared shipped-order fixture (placed by TEST_CUSTOMER_ID on channel c1).
    await seedShippedOrder(h.em());
    const orderChannelId = '00000000-0000-4000-8000-0000000000c1';
    const eventId = `evt-${randomUUID()}`;

    await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: orderChannelId,
      customerAccountId: TEST_CUSTOMER_ID,
    });

    const payload = {
      eventId,
      occurredAt: new Date().toISOString(),
      orderId: RFQ_SHIPPED_ORDER_ID,
      organizationId: '00000000-0000-4000-8000-0000000000aa',
      salesChannelId: orderChannelId,
      from: 'pending',
      to: 'shipped',
      actor: { kind: 'admin' as const },
    };
    h.eventBus.emit('order.status_changed.v1' as never, payload as never);
    h.eventBus.emit('order.status_changed.v1' as never, payload as never); // duplicate → idempotent

    // The handler is async fire-and-forget; poll briefly.
    let count = 0;
    for (let i = 0; i < 20; i += 1) {
      const rows = await h.em().getConnection().execute(
        `select count(*)::int as n from push_messages where trigger = 'order_status' and source_event_id = ?`,
        [eventId],
      );
      count = (rows as Array<{ n: number }>)[0]!.n;
      if (count >= 1) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(count).toBe(1);
  });
});
