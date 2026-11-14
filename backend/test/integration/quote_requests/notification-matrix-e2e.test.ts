import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PWA_SETTING_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Order } from '../../helpers/package-entities.js';
import { ageQuoteRequest } from '../../helpers/quote-request-age.js';
import {
  RecordingMailer,
  retireNotificationOrganization,
  seedNotificationOrganization,
  type NotificationOrganization,
} from '../../helpers/rfq-notification-organization.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';

const DAY_MS = 86_400_000;
const EXPIRY_DAYS = 14;

type Channel = 'customer_email' | 'customer_in_app' | 'customer_push' | 'admin_in_app' | 'admin_email';
const CHANNELS: readonly Channel[] = ['customer_email', 'customer_in_app', 'customer_push', 'admin_in_app', 'admin_email'];
type Change =
  | 'submitted'
  | 'resubmitted'
  | 'offer_accepted'
  | 'offer_rejected'
  | 'expired'
  | 'prepared'
  | 'revised'
  | 'approved'
  | 'canceled';
/** `C` customer side, `C-actor` the customer side without the actor (FR-007), `O` the operator side. */
type Audience = 'C' | 'C-actor' | 'O';

/**
 * `contracts/notification-matrix.md` §1, copied by hand rather than imported:
 * the unit test holds `notification-matrix.ts` equal to the contract, and this
 * file holds what the composed platform actually delivers equal to it.
 */
const MATRIX: Record<Change, Partial<Record<Channel, Audience>>> = {
  submitted: { customer_email: 'C', customer_in_app: 'C-actor', customer_push: 'C-actor', admin_in_app: 'O', admin_email: 'O' },
  resubmitted: { customer_email: 'C', customer_in_app: 'C-actor', customer_push: 'C-actor', admin_in_app: 'O', admin_email: 'O' },
  offer_accepted: { customer_email: 'C', customer_in_app: 'C-actor', customer_push: 'C-actor', admin_in_app: 'O' },
  offer_rejected: { customer_email: 'C', customer_in_app: 'C-actor', customer_push: 'C-actor', admin_in_app: 'O' },
  expired: { customer_email: 'C', customer_in_app: 'C', customer_push: 'C', admin_in_app: 'O' },
  prepared: { customer_email: 'C', customer_in_app: 'C', customer_push: 'C' },
  revised: { customer_email: 'C', customer_in_app: 'C', customer_push: 'C' },
  approved: { customer_email: 'C', customer_in_app: 'C', customer_push: 'C' },
  canceled: { customer_email: 'C', customer_in_app: 'C', customer_push: 'C' },
};

/**
 * `specs/179-rfq-and-customer-notifications/` WP-12, T110 — the whole matrix,
 * end to end, against one Organization holding every kind of person the
 * recipient rule tells apart (`helpers/rfq-notification-organization.ts`):
 * the requester, an *Administrator* member, a plain *Member*, an assigned
 * representative holding `rfqs:handle` and an assigned administrator who lacks
 * it.
 *
 * Each change is produced the way it happens — through the buyer's and the
 * operator's routes, the expiry sweep and the order completion reactor — and
 * one delivery pass later every record the change wrote is asserted per
 * channel: exactly the recipients the contract names (the customer side is the
 * requester and the *Administrator*, never the *Member*; the operator side is
 * the representative, never the administrator without `rfqs:handle`), the
 * actor of a customer-side change told by e-mail and not in the centre or by
 * push (FR-007), every record `sent` on its first attempt, and what each
 * channel left behind: one bell entry, centre entry, push message or e-mail
 * per record. Push is on and both customer-side people have a device, so
 * `customer_push` is a delivered channel here rather than a skipped one.
 */
describe('Quote request notification matrix, end to end (WP-12, T110)', () => {
  let h: BackendServerHandle;
  let org: NotificationOrganization;
  const mailer = new RecordingMailer();
  const subscribedEndpoints: string[] = [];

  interface DeliveryService {
    deliverInScope(now?: Date): Promise<{ claimed: number }>;
  }
  interface Handle {
    deliveryService: DeliveryService;
    expiryWorker: { sweep(now?: Date): Promise<{ expiredCount: number; failedCount: number }> };
    orderCompletionReactor: { onOrderCreated(payload: unknown): Promise<void> };
  }
  const handle = (): Handle => (h.container.resolve('quoteRequests') as { handle(): Handle }).handle();
  const pass = () => withSystemScope('notification matrix e2e', () => handle().deliveryService.deliverInScope());

  interface RecordRow {
    id: string;
    change: string;
    channel: Channel;
    recipient_kind: string;
    recipient_id: string;
    status: string;
    attempts: number;
    last_error: string | null;
  }
  const recordsOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .execute<RecordRow[]>(
        `select "id", "change", "channel", "recipient_kind", "recipient_id", "status", "attempts", "last_error"
           from "quote_request_notifications" where "quote_request_id" = ?`,
        [rfqId],
      );
  const inList = (ids: readonly string[]) => ids.map(() => '?').join(', ');
  const rows = async <T>(sql: string, params: unknown[]): Promise<T[]> =>
    params.length === 0 ? [] : h.em().fork().execute<T[]>(sql, params);

  const audienceOf = (audience: Audience | undefined, actor: string | null): string[] => {
    if (audience === undefined) return [];
    if (audience === 'O') return [org.rep.id];
    const side = [org.requester.id, org.administrator.id];
    return audience === 'C-actor' ? side.filter((id) => id !== actor) : side;
  };

  /**
   * One delivery pass, then the change's records against the matrix row and
   * against what each channel left behind.
   */
  const expectDelivered = async (rfqId: string, change: Change, actor: string | null): Promise<void> => {
    await pass();
    const records = (await recordsOf(rfqId)).filter((record) => record.change === change);
    expect(records.length, `${change}: records`).toBeGreaterThan(0);
    for (const channel of CHANNELS) {
      const cell = records.filter((record) => record.channel === channel);
      expect(cell.map((record) => record.recipient_id).sort(), `${change} × ${channel}`).toEqual(
        audienceOf(MATRIX[change][channel], actor).sort(),
      );
      for (const record of cell) {
        expect(record.recipient_kind, `${change} × ${channel}`).toBe(channel.startsWith('admin_') ? 'admin' : 'customer');
        expect(record, `${change} × ${channel} → ${record.recipient_id}`).toMatchObject({ status: 'sent', attempts: 1 });
      }
    }
    // Nobody outside the two sides is ever named.
    for (const outsider of [org.member.id, org.noHandle.id]) {
      expect(records.map((record) => record.recipient_id), `${change}: ${outsider}`).not.toContain(outsider);
    }

    const byChannel = (channel: Channel) => records.filter((record) => record.channel === channel);
    const bells = await rows<{ target_admin_user_id: string; link_path: string }>(
      `select "target_admin_user_id", "link_path" from "admin_notifications"
        where "subject_type" = 'quote_request' and "subject_id" = ? and "kind" = ?`,
      [rfqId, `quote_requests.${change}`],
    );
    expect(bells.map((bell) => bell.target_admin_user_id).sort(), `${change}: bell entries`).toEqual(
      byChannel('admin_in_app').map((record) => record.recipient_id).sort(),
    );
    const centreIds = byChannel('customer_in_app').map((record) => record.id);
    const centre = await rows<{ customer_account_id: string; source_key: string; kind: string; link_path: string }>(
      `select "customer_account_id", "source_key", "kind", "link_path" from "customer_notifications"
        where "source_module" = 'quote_requests' and "source_key" in (${inList(centreIds)})`,
      centreIds,
    );
    expect(centre.map((entry) => entry.source_key).sort(), `${change}: centre entries`).toEqual([...centreIds].sort());
    for (const entry of centre) {
      expect(entry).toMatchObject({ kind: `quote_requests.${change}`, link_path: `/quote-requests/${rfqId}` });
    }
    const pushIds = byChannel('customer_push').map((record) => record.id);
    const pushes = await rows<{ source_event_id: string; url: string; audience: { customerAccountIds?: string[] } }>(
      `select "source_event_id", "url", "audience" from "push_messages"
        where "trigger" = 'quote_request' and "source_event_id" in (${inList(pushIds)})`,
      pushIds,
    );
    expect(pushes.map((push) => push.source_event_id).sort(), `${change}: push messages`).toEqual([...pushIds].sort());
    for (const push of pushes) {
      const record = records.find((candidate) => candidate.id === push.source_event_id)!;
      expect(push.url).toBe(`/quote-requests/${rfqId}`);
      expect(push.audience.customerAccountIds).toEqual([record.recipient_id]);
    }
    for (const channel of ['customer_email', 'admin_email'] as const) {
      const code = `quote_request_${channel === 'customer_email' ? 'customer' : 'operator'}_${change}`;
      const expected = byChannel(channel).map((record) => `quote_request_notification:${record.id}`).sort();
      const sent = mailer.accepted.filter((message) => expected.includes(message.messageId ?? ''));
      expect(sent.map((message) => message.messageId).sort(), `${change}: ${channel}`).toEqual(expected);
      for (const message of sent) expect((message.meta as Record<string, unknown>)['kind']).toBe(code);
    }
  };

  // --- the changes, through the routes ------------------------------------------

  const submitted = async (cookies = org.requester.cookies): Promise<{ id: string; version: number }> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 9 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  };
  const versionOf = async (id: string): Promise<number> =>
    Number(
      (await h.em().fork().execute<Array<{ version: number }>>(`select "version" from "quote_requests" where "id" = ?`, [id]))[0]!
        .version,
    );
  /** The representative prices the request: the `revised` change. Answers the revision number. */
  const revised = async (id: string): Promise<number> => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: org.rep.cookies,
      headers: { 'if-match': `"${await versionOf(id)}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 8.5 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { currentRevisionNumber: number } }).data.currentRevisionNumber;
  };
  const respond = async (id: string, revision: number, decision: 'accept' | 'reject', cookies: Record<string, string>) => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${id}/${decision}-revision`,
      cookies,
      payload: { expectedRevisionNumber: revision, ...(decision === 'reject' ? { reason: 'Too dear' } : {}) },
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  const operatorAction = async (id: string, action: 'approve' | 'cancel') => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/quote-requests/${id}/${action}`,
      cookies: org.rep.cookies,
      headers: { 'if-match': `"${await versionOf(id)}"` },
      payload: action === 'approve' ? { note: 'Approved after the call.' } : { reason: 'Out of stock' },
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  /** Push on for every channel, and a device for both customer-side people on the system default channel. */
  const pushOnWithDevices = async (): Promise<void> => {
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_ENABLED, true, null, { actorAdminUserId: null });
    await h.settings.adminService.setValueForAllChannels(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, true, null, {
      actorAdminUserId: null,
    });
    const channelId = (await h.salesChannels.resolver.getSystemDefault()).id;
    for (const customerAccountId of [org.requester.id, org.administrator.id, org.member.id]) {
      const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
      subscribedEndpoints.push(endpoint);
      await h.pwa.subscriptionService.register({ endpoint, keys: { p256dh: 'p', auth: 'a' }, salesChannelId: channelId, customerAccountId });
    }
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    org = await seedNotificationOrganization(h, 'matrix');
    await pushOnWithDevices();
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

  // --- customer-side changes -------------------------------------------------------

  it('submitted: requester e-mailed, the Administrator told everywhere, the representative by bell and e-mail', async () => {
    const rfq = await submitted();
    await expectDelivered(rfq.id, 'submitted', org.requester.id);
  });

  it('resubmitted: the new request tells both sides as a submission does', async () => {
    const source = await submitted();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/quote-requests/${source.id}/resubmit`,
      cookies: org.requester.cookies,
      payload: {},
    });
    expect(res.statusCode, res.body).toBe(201);
    await expectDelivered((res.json() as { data: { id: string } }).data.id, 'resubmitted', org.requester.id);
  });

  it('offer_accepted by the requester: the bell only on the operator side, no e-mail to it (FR-006)', async () => {
    const rfq = await submitted();
    const revision = await revised(rfq.id);
    await respond(rfq.id, revision, 'accept', org.requester.cookies);
    await expectDelivered(rfq.id, 'offer_accepted', org.requester.id);
  });

  it('offer_rejected by the Administrator member: they are the actor, so the requester is the one told in the centre (FR-007)', async () => {
    const rfq = await submitted();
    const revision = await revised(rfq.id);
    await respond(rfq.id, revision, 'reject', org.administrator.cookies);
    await expectDelivered(rfq.id, 'offer_rejected', org.administrator.id);
  });

  it('expired: the sweep has no actor, so the whole customer side is told on every channel', async () => {
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, EXPIRY_DAYS, null, {
      actorAdminUserId: null,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const rfq = await submitted();
      await pass();
      await ageQuoteRequest(h.em(), rfq.id, new Date(Date.now() - EXPIRY_DAYS * DAY_MS - 60_000));
      const swept = await handle().expiryWorker.sweep();
      expect(swept.expiredCount).toBeGreaterThan(0);
      await expectDelivered(rfq.id, 'expired', null);
    } finally {
      await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
        actorAdminUserId: null,
      });
    }
  });

  // --- operator-side changes ---------------------------------------------------------

  it('prepared: a request the representative raises on the buyer’s behalf tells the customer side only', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/quote-requests',
      cookies: org.rep.cookies,
      payload: {
        organizationId: org.organizationId,
        customerAccountId: org.requester.id,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 10 }],
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    await expectDelivered((res.json() as { data: { id: string } }).data.id, 'prepared', null);
  });

  it('revised: the customer side, requester included, on every customer channel', async () => {
    const rfq = await submitted();
    await revised(rfq.id);
    await expectDelivered(rfq.id, 'revised', null);
  });

  it('approved: the customer side only', async () => {
    const rfq = await submitted();
    await revised(rfq.id);
    await operatorAction(rfq.id, 'approve');
    await expectDelivered(rfq.id, 'approved', null);
  });

  it('canceled: the customer side only', async () => {
    const rfq = await submitted();
    await operatorAction(rfq.id, 'cancel');
    await expectDelivered(rfq.id, 'canceled', null);
  });

  // --- the change that tells nobody ------------------------------------------------------

  it('completed: an order placed from the accepted quote writes no record (FR-003)', async () => {
    const rfq = await submitted();
    const revision = await revised(rfq.id);
    await respond(rfq.id, revision, 'accept', org.requester.cookies);
    await pass();
    const before = await recordsOf(rfq.id);
    const em = h.em().fork();
    const order = em.create(Order, {
      id: randomUUID(),
      organizationId: org.organizationId,
      placedByCustomerAccountId: org.requester.id,
      salesChannelId: randomUUID(),
      deliveryAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      billingAddress: { recipientName: 'A', street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
      deliveryMethodId: randomUUID(),
      deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '0.00',
      deliveryTotal: '0.00',
      total: '10.00',
      currency: 'PLN',
      placedAt: new Date(),
      sourceQuoteRequestId: rfq.id,
    });
    await em.persistAndFlush(order);
    await handle().orderCompletionReactor.onOrderCreated({ orderId: order.id });
    const status = await h.em().fork().execute<Array<{ status: string }>>(`select "status" from "quote_requests" where "id" = ?`, [rfq.id]);
    expect(status[0]!.status).toBe('Completed');
    expect((await recordsOf(rfq.id)).map((record) => record.id).sort()).toEqual(before.map((record) => record.id).sort());
  });
});
