import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import { Setting, SettingValue, SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { seedShippedOrder, RFQ_SHIPPED_ORDER_ID } from '../../helpers/seed-commerce.js';
import { resolvePublicApiBaseUrl } from '../../../src/kernel/index.js';

/**
 * `pwa` reaches four other modules, and this is the half that can see the
 * wiring (`specs/110-instance-repository/` T118c).
 *
 * The mapping half is co-located and composes nothing
 * (`packages/modules/pwa/src/backend/services/cross-module-context.test.ts`,
 * `.../request-actor.test.ts`). Neither half can do the other's job: a stub
 * cannot tell you that `assetsLibraryPort` is the name this composition
 * registers, and a composed harness cannot tell you what the mapping does with
 * an owner that refuses.
 *
 * **Three of the eight members `pwaBridge` carried were asserted by nothing at
 * all**, which is why this file exists rather than an edit to the contract
 * suite:
 *
 *  - `assetUpload` and `resolveAssetUrl` are the icon pipeline, and
 *    `/api/v1/storefront/pwa/icons/:spec` was fetched by **no test in the tree**
 *    — the only other mention of that path is the OpenAPI baseline. So the
 *    route both roots supplied a URL resolver for had never been exercised, and
 *    the D-223 repair that made one root stop rebasing was landed against no
 *    assertion. The first case below is also what found the admin icon-upload
 *    route answering 500 for the only body it accepts.
 *  - `resolveOrderTarget` is exercised by the T036 contract case, which counts
 *    `push_messages` rows and reads none of their columns. The title, the body
 *    and the deep link a customer's device actually shows were asserted
 *    nowhere.
 *  - `resolveAuditContext` decides `push_messages.created_by_admin_user_id`,
 *    which no test read either — and it is the member whose two root copies
 *    disagreed, the harness answering `TEST_ADMIN_ID` for a non-admin caller
 *    where production answered `null`.
 */
describe('pwa — the cross-module ports, composed', () => {
  let h: BackendServerHandle;
  let assetsBaseDir: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const channelHeader = { 'x-sales-channel': 'default' };

  /** Settings writes drop the cache through a fire-and-forget EventBus handler. */
  const settleEvents = (): Promise<void> => new Promise((r) => setTimeout(r, 50));

  beforeAll(async () => {
    h = await setupBackendServer();

    // The local storage adapter writes real bytes; give it somewhere of its
    // own, exactly as `assets_library`' own contract suite does.
    assetsBaseDir = await mkdtemp(join(tmpdir(), 'pwa-cross-module-'));
    const em = h.em();
    const setting = await em.findOneOrFail(Setting, { code: 'assets.local.base_dir' });
    const channel = await em.findOneOrFail(SalesChannel, { code: 'default' });
    const existing = await em.findOne(SettingValue, { setting });
    if (existing) existing.value = assetsBaseDir;
    else em.create(SettingValue, { setting, salesChannel: channel, value: assetsBaseDir });
    await em.flush();
    h.assetsLibrary.adapters.invalidate();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
    await rm(assetsBaseDir, { recursive: true, force: true });
  });

  it('uploads an icon through assetsLibraryPort and redirects to the absolute URL it answers', async () => {
    // One case for two members, because the second cannot be reached without
    // the first: `assetUpload` stores the source and the four renditions, and
    // `resolveAssetUrl` is what turns a rendition's asset id into the
    // `Location` a browser follows.
    //
    // **The ingest is driven through the composed handle rather than through
    // `POST /api/v1/admin/pwa/icon`, and that is a finding rather than a
    // convenience**: that route answers 500 for the only body it accepts,
    // because `pwa` registers `@fastify/multipart` nowhere — `assets_library`
    // and `ksef` each register it inside their own encapsulated context, on
    // purpose, so neither reaches here. It is a live defect on every deployment
    // and it is not this drain's to repair; it is in `specs/deferred-defects.md`.
    // `h.pwa.iconService` is the container's own instance, built with the real
    // `lazyPort` proxy, so this still asserts the wiring and not a stub.
    const source = await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4,
        background: { r: 29, g: 78, b: 216, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const ingested = await h.pwa.iconService.ingest({
      salesChannelId: null,
      declaredMime: 'image/png',
      buffer: source,
    });
    const rendition = ingested.renditions.find((r) => r.size === 512 && r.purpose === 'any');
    expect(rendition, 'the 512 "any" rendition was not derived').toBeTruthy();

    const redirect = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/pwa/icons/512-any.png',
      headers: channelHeader,
    });

    expect(redirect.statusCode).toBe(302);
    // **Absolute** (D-223), and asserted as the whole string rather than by
    // `startsWith`: the defect this replaces was a URL that was host-relative
    // under one composition and absolute under the other, and only an equality
    // can see that. `assets_library` decides the origin; `pwa` passes the
    // answer through untouched, which is why nothing here reads an environment
    // variable of its own.
    expect(redirect.headers['location']).toBe(
      `${resolvePublicApiBaseUrl()}/assets/file/${rendition!.assetId}`,
    );
  });

  it('answers 404 for an icon whose asset is gone, rather than 500', async () => {
    // The narrow tolerance `createAssetUrlResolver` keeps, end to end. It is a
    // `catch` whose first line is `rethrowIfModuleDisabled`, so this case is
    // what says the tolerance still tolerates.
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await h.em().getConnection().execute(
      `insert into pwa_icon_renditions (id, sales_channel_id, source_asset_id, size, purpose, asset_id, content_hash, created_at)
       values (?, ?, ?, 180, 'any', ?, 'deadbeef', now())`,
      [randomUUID(), channelId, randomUUID(), randomUUID()],
    );

    const redirect = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/pwa/icons/180-any.png',
      headers: channelHeader,
    });

    expect(redirect.statusCode).toBe(404);
  });

  it('composes the order-status push from the order orderReadPort answers', async () => {
    await h.settings.adminService.setValueForAllChannels(
      PWA_SETTING_CODES.PUSH_ENABLED,
      true,
      null,
      { actorAdminUserId: null },
    );
    await settleEvents();

    await seedShippedOrder(h.em());
    const orderChannelId = '00000000-0000-4000-8000-0000000000c1';
    const eventId = `evt-${randomUUID()}`;
    // Read rather than hard-coded: `businessId` is the owner's to generate, and
    // an expectation that spelled it would be asserting the seed instead of the
    // port.
    const businessId = (
      (await h.em().getConnection().execute(
        `select business_id from orders where id = ?`,
        [RFQ_SHIPPED_ORDER_ID],
      )) as Array<{ business_id: string }>
    )[0]!.business_id;

    await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: orderChannelId,
      customerAccountId: TEST_CUSTOMER_ID,
    });

    h.eventBus.emit('order.status_changed.v1' as never, {
      eventId,
      occurredAt: new Date().toISOString(),
      orderId: RFQ_SHIPPED_ORDER_ID,
      organizationId: '00000000-0000-4000-8000-0000000000aa',
      salesChannelId: orderChannelId,
      from: 'pending',
      to: 'ready_for_pickup',
      actor: { kind: 'admin' as const },
    } as never);

    let row: { title: string; body: string; url: string | null } | undefined;
    for (let i = 0; i < 40; i += 1) {
      const rows = (await h.em().getConnection().execute(
        `select title, body, url from push_messages where source_event_id = ?`,
        [eventId],
      )) as Array<{ title: string; body: string; url: string | null }>;
      row = rows[0];
      if (row) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(row, 'the auto-trigger wrote no push message').toBeTruthy();
    // The order's *business* id, not its UUID — the port answers a record and
    // the sentence names the thing a customer recognises. A drain that had
    // wired the wrong field would still have produced a row, which is all the
    // existing T036 case asserts.
    expect(row!.title).toBe('Order update');
    expect(row!.body).toBe(`Order ${businessId} is now ready for pickup.`);
    expect(row!.url).toBe(`/account/orders/${businessId}`);
  });

  it('attributes an admin send to the acting admin over adminAuditActorResolver', async () => {
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    await h.settings.adminService.setValueForAllChannels(
      PWA_SETTING_CODES.PUSH_ENABLED,
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.adminService.setValueForAllChannels(
      PWA_SETTING_CODES.VAPID_PUBLIC_KEY,
      'BPUB',
      null,
      { actorAdminUserId: null },
    );
    await settleEvents();

    const title = `Attribution ${randomUUID()}`;
    const sent = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/messages',
      cookies: adminCookie,
      payload: {
        salesChannelId: channelId,
        title,
        body: 'Attribution probe.',
        audience: { kind: 'all' },
      },
    });
    expect(sent.statusCode).toBe(202);

    const rows = (await h.em().getConnection().execute(
      `select created_by_admin_user_id from push_messages where title = ?`,
      [title],
    )) as Array<{ created_by_admin_user_id: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.created_by_admin_user_id).toBe(TEST_ADMIN_ID);
  });

  it('refuses a per-channel reset for a channel id salesChannelResolutionPort does not know', async () => {
    // `channelCodeForId`'s `null` branch, which is what turns an unknown id
    // into `PWA_CHANNEL_UNKNOWN` rather than a silent platform-wide reset. The
    // happy path is the contract suite's; this is the branch nothing drove.
    const reset = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/pwa/config/reset',
      cookies: adminCookie,
      payload: { salesChannelId: randomUUID() },
    });

    expect(reset.statusCode).toBe(400);
    expect(reset.json().error.code).toBe('PWA_CHANNEL_UNKNOWN');
  });

  it('scopes an unqualified subscriber read to the system-default channel', async () => {
    // `defaultChannelId`. The admin subscriptions screen sends no
    // `salesChannelId` until an operator picks one, so this is the read every
    // first page load performs.
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    const before = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pwa/subscriptions',
      cookies: adminCookie,
    });
    expect(before.statusCode).toBe(200);
    const active = (before.json() as { active: number }).active;

    await h.pwa.subscriptionService.register({
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomUUID()}`,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId: channelId,
      customerAccountId: null,
    });

    const after = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/pwa/subscriptions',
      cookies: adminCookie,
    });
    expect(after.statusCode).toBe(200);
    expect((after.json() as { active: number }).active).toBe(active + 1);
  });
});
