import { randomUUID } from 'node:crypto';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import {
  RecordingMailer,
  retireNotificationOrganization,
  seedNotificationOrganization,
  type NotificationOrganization,
} from '../../helpers/rfq-notification-organization.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { RFQ_NOTIFICATION_DELIVERY_QUEUE } from '../../../../packages/modules/quote_requests/src/backend/services/notifications/kick.js';
import { startRfqNotificationDelivery } from '../../../../packages/modules/quote_requests/src/backend/workers/rfq-notification-delivery-worker.js';

const HOUR_MS = 3_600_000;

type Channel = 'customer_email' | 'customer_in_app' | 'customer_push' | 'admin_in_app' | 'admin_email';

/**
 * `specs/179-rfq-and-customer-notifications/` WP-12, T111 — the off states a
 * notification can meet, on the Organization T110 walks the matrix against.
 *
 * **Each receiving module off in turn** (SC-007, FR-012): with
 * `admin_notifications`, `customer_notifications` or `pwa` deactivated, a
 * buyer's submission and the representative's revision both still answer as
 * they do with every module on, the records of that module's channel close
 * `skipped_module_off` without an attempt and without leaving anything in its
 * table, and every other channel is `sent`. Push is on and every customer
 * recipient has a device, so `customer_push` is a channel that delivers when
 * `pwa` is not the one off.
 *
 * **`quote_requests` itself off**: the delivery consumer the module composes
 * (`startRfqNotificationDelivery`, through the platform's worker seam as
 * `ctx.worker` attaches it) runs on a real Redis under a key prefix of this
 * run's own. While the module is off its ticks do not run and every record
 * stays `pending`, untouched; once it is back the waiting tick delivers them —
 * except the ones whose change is now more than 24 hours old, which close
 * `skipped_stale` and are never sent (FR-011).
 */
describe('Quote request notifications with a module off (WP-12, T111)', () => {
  let h: BackendServerHandle;
  let org: NotificationOrganization;
  const mailer = new RecordingMailer();
  const subscribedEndpoints: string[] = [];

  interface RecordRow {
    id: string;
    change: string;
    channel: Channel;
    recipient_id: string;
    status: string;
    attempts: number;
  }
  const recordsOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .execute<RecordRow[]>(
        `select "id", "change", "channel", "recipient_id", "status", "attempts"
           from "quote_request_notifications" where "quote_request_id" = ?`,
        [rfqId],
      );
  const scalar = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await h.em().fork().execute<Array<{ n: string }>>(sql, params))[0]!.n);
  const inList = (ids: readonly string[]) => ids.map(() => '?').join(', ');

  interface DeliveryService {
    hasDeliverable(now?: Date): Promise<boolean>;
    deliverInScope(now?: Date): Promise<{ claimed: number }>;
  }
  const delivery = (): DeliveryService =>
    (h.container.resolve('quoteRequests') as { handle(): { deliveryService: DeliveryService } }).handle().deliveryService;
  const pass = () => withSystemScope('notification off-state test', () => delivery().deliverInScope());

  const submitted = async (): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: org.requester.cookies,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 9 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };
  const revised = async (id: string): Promise<void> => {
    const [row] = await h
      .em()
      .fork()
      .execute<Array<{ version: number }>>(`select "version" from "quote_requests" where "id" = ?`, [id]);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: org.rep.cookies,
      headers: { 'if-match': `"${row!.version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 8.5 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  /** What a channel's receiving module holds about these records — zero is what "skipped" must leave. */
  const artefactsOf = async (channel: Channel, rfqId: string, records: RecordRow[]): Promise<number> => {
    const ids = records.map((record) => record.id);
    if (channel === 'admin_in_app') {
      return scalar(
        `select count(*) as "n" from "admin_notifications" where "subject_type" = 'quote_request' and "subject_id" = ?`,
        [rfqId],
      );
    }
    if (ids.length === 0) return 0;
    if (channel === 'customer_in_app') {
      return scalar(
        `select count(*) as "n" from "customer_notifications" where "source_module" = 'quote_requests' and "source_key" in (${inList(ids)})`,
        ids,
      );
    }
    return scalar(
      `select count(*) as "n" from "push_messages" where "trigger" = 'quote_request' and "source_event_id" in (${inList(ids)})`,
      ids,
    );
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    org = await seedNotificationOrganization(h, 'off-state');
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_ENABLED, true, null, { actorAdminUserId: null });
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, true, null, {
      actorAdminUserId: null,
    });
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    for (const customerAccountId of [org.requester.id, org.administrator.id]) {
      const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
      subscribedEndpoints.push(endpoint);
      await h.pwa.subscriptionService.register({ endpoint, keys: { p256dh: 'p', auth: 'a' }, salesChannelId: channelId, customerAccountId });
    }
  }, 120_000);

  afterAll(async () => {
    const sql = h.em().getConnection();
    if (subscribedEndpoints.length > 0) {
      await sql.execute(`delete from "push_subscriptions" where "endpoint" in (${inList(subscribedEndpoints)})`, subscribedEndpoints);
    }
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_ENABLED, false, null, { actorAdminUserId: null });
    await retireNotificationOrganization(h, org);
    await teardownBackendServer(h);
  });

  // The module each in-app or push channel is delivered through; the e-mails are `quote_requests`' own.
  it.each<{ moduleId: string; channel: Channel }>([
    { moduleId: 'admin_notifications', channel: 'admin_in_app' },
    { moduleId: 'customer_notifications', channel: 'customer_in_app' },
    { moduleId: 'pwa', channel: 'customer_push' },
  ])(
    '$moduleId off: no transition fails, $channel closes skipped_module_off, every other channel is sent (SC-007)',
    async (row) => {
      const { channel } = row;
      const id = await withModuleOff(row.moduleId, 'deactivated', async () => {
        const rfqId = await submitted();
        await revised(rfqId);
        await pass();
        return rfqId;
      });
      const records = await recordsOf(id);
      // Both sides of both changes were recorded, whatever was off.
      expect(new Set(records.map((record) => record.change))).toEqual(new Set(['submitted', 'revised']));
      expect(new Set(records.map((record) => record.channel))).toEqual(
        new Set(['customer_email', 'customer_in_app', 'customer_push', 'admin_in_app', 'admin_email']),
      );
      const off = records.filter((record) => record.channel === channel);
      expect(off.length).toBeGreaterThan(0);
      for (const record of off) {
        expect(record, `${record.change} × ${channel} → ${record.recipient_id}`).toMatchObject({
          status: 'skipped_module_off',
          attempts: 0,
        });
      }
      for (const record of records.filter((record) => record.channel !== channel)) {
        expect(record, `${record.change} × ${record.channel} → ${record.recipient_id}`).toMatchObject({
          status: 'sent',
          attempts: 1,
        });
      }
      expect(await artefactsOf(channel, id, off)).toBe(0);

      // Closed is closed: with the module back, nothing is delivered late.
      await pass();
      expect(await artefactsOf(channel, id, off)).toBe(0);
      expect((await recordsOf(id)).filter((record) => record.channel === channel).map((record) => record.status)).toEqual(
        off.map(() => 'skipped_module_off'),
      );
    },
  );

  describe('quote_requests off: the delivery worker idles and the records wait', () => {
    let redis: Redis;
    let queue: Queue;
    let worker: Worker | undefined;
    const closers: Array<() => Promise<void>> = [];
    const prefix = `rfq-notify-test-${randomUUID().slice(0, 8)}`;
    const completed: string[] = [];

    const until = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await condition()) return true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return condition();
    };

    beforeAll(() => {
      redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
      queue = new Queue(RFQ_NOTIFICATION_DELIVERY_QUEUE, { connection: redis, prefix });
    });

    afterAll(async () => {
      for (const close of closers) await close();
      await worker?.close();
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      redis.disconnect();
    });

    it('no tick runs while off; back on, the waiting tick delivers — and a change over 24 h old closes skipped_stale (FR-011)', async () => {
      // Two requests recorded while everything is on, before any consumer exists.
      const resumed = await submitted();
      const stale = await submitted();
      const pending = async (id: string) => (await recordsOf(id)).filter((record) => record.status === 'pending').length;
      const resumedCount = (await recordsOf(resumed)).length;
      const staleCount = (await recordsOf(stale)).length;
      expect(resumedCount).toBeGreaterThan(0);
      expect(await pending(resumed)).toBe(resumedCount);
      expect(await pending(stale)).toBe(staleCount);

      await withModuleOff('quote_requests', 'deactivated', async () => {
        // The consumer as the module composes it, attached through the worker seam — while the module is off.
        const started = await startRfqNotificationDelivery({
          processRunsWorkers: true,
          moduleQueueRedis: redis,
          queuePrefix: prefix,
          delivery: delivery() as never,
          log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
          attach: (built) => {
            worker = defineModuleWorker('quote_requests', built);
            built.on('completed', (job) => {
              completed.push(job.id ?? '');
            });
          },
          onClose: (close) => closers.push(close),
        });
        expect(started).toBe(true);
        // The schedule's own first job, and a kick on top of it.
        const kick = await queue.add('deliver', {});
        // Long enough for a running consumer to have taken both many times over.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(completed).not.toContain(kick.id);
        expect(completed).toHaveLength(0);
        expect(await pending(resumed)).toBe(resumedCount);
        expect(await pending(stale)).toBe(staleCount);
        for (const record of [...(await recordsOf(resumed)), ...(await recordsOf(stale))]) expect(record.attempts).toBe(0);

        // The module stays off for longer than a day for one of them.
        await h
          .em()
          .getConnection()
          .execute(`update "quote_request_notifications" set "source_occurred_at" = ? where "quote_request_id" = ?`, [
            new Date(Date.now() - 25 * HOUR_MS),
            stale,
          ]);
      });

      // Back on: the tick that waited runs.
      expect(await until(async () => (await pending(resumed)) === 0 && (await pending(stale)) === 0, 60_000)).toBe(true);
      for (const record of await recordsOf(resumed)) {
        expect(record, `${record.channel} → ${record.recipient_id}`).toMatchObject({ status: 'sent', attempts: 1 });
      }
      for (const record of await recordsOf(stale)) {
        expect(record, `${record.channel} → ${record.recipient_id}`).toMatchObject({ status: 'skipped_stale', attempts: 0 });
      }
      const staleIds = (await recordsOf(stale)).map((record) => record.id);
      expect(mailer.accepted.filter((message) => staleIds.some((id) => message.messageId === `quote_request_notification:${id}`))).toHaveLength(0);
      expect(
        await scalar(
          `select count(*) as "n" from "admin_notifications" where "subject_type" = 'quote_request' and "subject_id" = ?`,
          [stale],
        ),
      ).toBe(0);
    }, 120_000);
  });
});
