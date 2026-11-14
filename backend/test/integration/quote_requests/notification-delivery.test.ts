import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PWA_SETTING_CODES,
  type EmailMailerPort,
  type EmailMailerSendInput,
  type EmailMailerSendOutcome,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { CustomerAccount, TransactionalEmail } from '../../helpers/package-entities.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runRfqNotificationDeliveryTick } from '../../../../packages/modules/quote_requests/src/backend/workers/rfq-notification-delivery-worker.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const ADMIN = { b2b_session: 'stub-admin-session' };
const MINUTE = 60_000;

/**
 * A mail server that accepts each message id once and refuses a second one as
 * a duplicate — the transport's message-id check D-59 rests on.
 */
class OnceMailer implements EmailMailerPort {
  readonly handed: EmailMailerSendInput[] = [];
  readonly accepted: EmailMailerSendInput[] = [];
  async send(input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
    this.handed.push(input);
    if (this.accepted.some((message) => message.messageId === input.messageId)) {
      return { status: 'suppressed', reason: 'duplicate_message_id' };
    }
    this.accepted.push(input);
    return { status: 'sent' };
  }
}

/**
 * `specs/179-rfq-and-customer-notifications/` WP-05 (T044 integration case,
 * T045) — the composed delivery pass over real records: the worker's tick
 * delivers a submitted request's records through the bell and the two
 * e-mails; two passes at once deliver each record once; a template switched
 * off and a bell switched off close their records without failing the others;
 * and a crash after the transport accepted an e-mail but before the record
 * committed costs a retry, never a second message.
 *
 * WP-08 (T070) adds the customer notification centre: an operator's change
 * writes one centre entry per customer recipient, in the record's transaction,
 * which the buyer then reads on the storefront in their own language; with the
 * centre switched off the record closes `skipped_module_off` and no entry is
 * ever written, not even once the centre is back.
 *
 * WP-10 (T092) adds the push to the buyer's devices through `pwa`'s
 * `customerPushPort`: with push on, an operator's change writes one push
 * message per customer recipient who has a device and wants quote updates,
 * keyed by the record id; a recipient who turned quote updates off closes
 * `skipped_preference`; a crash after the push was enqueued costs a retry,
 * never a second push; `pwa` switched off closes `skipped_module_off`. With
 * push off — the shipped default, and this file's baseline — every push
 * record closes `skipped_deactivated`, which is what the other cases see.
 */
describe('Quote request notification delivery (WP-05)', () => {
  let h: BackendServerHandle;
  const mailer = new OnceMailer();

  interface Adapter {
    owner: string;
    deliver: (context: never) => Promise<unknown>;
  }
  interface DeliveryService {
    hasDeliverable(now?: Date): Promise<boolean>;
    deliverInScope(now?: Date): Promise<{ claimed: number; closed: number; retried: number; reachedBatchLimit: boolean }>;
    deps: { adapters: Record<string, Adapter> };
  }
  const delivery = (): DeliveryService =>
    (h.container.resolve('quoteRequests') as { handle(): { deliveryService: DeliveryService } }).handle()
      .deliveryService;
  const pass = (now?: Date) => withSystemScope('notification-delivery test', () => delivery().deliverInScope(now));

  interface RecordRow {
    id: string;
    channel: string;
    recipient_id: string;
    status: string;
    attempts: number;
    last_error: string | null;
    closed_at: Date | null;
  }
  const recordsOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .execute<RecordRow[]>(
        `select "id", "channel", "recipient_id", "status", "attempts", "last_error", "closed_at"
           from "quote_request_notifications" where "quote_request_id" = ? order by "channel", "recipient_id"`,
        [rfqId],
      );
  const bellEntriesOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .execute<Array<{ target_admin_user_id: string; kind: string; link_path: string; title: string }>>(
        `select "target_admin_user_id", "kind", "link_path", "title" from "admin_notifications"
          where "subject_type" = 'quote_request' and "subject_id" = ?`,
        [rfqId],
      );
  interface CentreRow {
    organization_id: string;
    customer_account_id: string;
    sales_channel_id: string | null;
    source_key: string;
    kind: string;
    title: string;
    title_message: { scope: string; key: string; params: Record<string, string | number> };
    link_path: string | null;
  }
  const centreEntriesOf = (rfqId: string) =>
    h
      .em()
      .fork()
      .execute<CentreRow[]>(
        `select "organization_id", "customer_account_id", "sales_channel_id", "source_key", "kind", "title",
                "title_message", "link_path"
           from "customer_notifications"
          where "source_module" = 'quote_requests' and "subject_type" = 'quote_request' and "subject_id" = ?`,
        [rfqId],
      );
  const requestRow = async (rfqId: string) =>
    (
      await h
        .em()
        .fork()
        .execute<Array<{ organization_id: string; sales_channel_id: string | null; version: number }>>(
          `select "organization_id", "sales_channel_id", "version" from "quote_requests" where "id" = ?`,
          [rfqId],
        )
    )[0]!;
  /** An operator's revision of a submitted request: the `revised` change, which tells the whole customer side. */
  const revised = async (rfqId: string): Promise<void> => {
    const { version } = await requestRow(rfqId);
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${rfqId}`,
      cookies: ADMIN,
      headers: { 'if-match': `"${version}"` },
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 8.5 }] },
    });
    expect(res.statusCode, res.body).toBe(200);
  };
  /** A push record's closing is the push cases' business; the other cases only see it closed. */
  const notPush = (record: RecordRow): boolean => record.channel !== 'customer_push';
  const expectPushClosedOff = (records: RecordRow[]): void => {
    for (const record of records.filter((record) => !notPush(record))) {
      expect(record, `customer_push → ${record.recipient_id}`).toMatchObject({ status: 'skipped_deactivated', attempts: 1 });
    }
  };
  interface PushRow {
    source_event_id: string;
    title: string;
    body: string;
    url: string | null;
    sales_channel_id: string;
    audience: { kind: string; customerAccountIds?: string[] };
  }
  const pushMessagesFor = (records: RecordRow[]) =>
    records.length === 0
      ? Promise.resolve([] as PushRow[])
      : h
          .em()
          .fork()
          .execute<PushRow[]>(
            `select "source_event_id", "title", "body", "url", "sales_channel_id", "audience" from "push_messages"
              where "trigger" = 'quote_request' and "source_event_id" in (${records.map(() => '?').join(', ')})`,
            records.map((record) => record.id),
          );
  const setPushSetting = (code: string, value: boolean) =>
    h.settings.adminService.setValueForAllChannels(code, value, null, { actorAdminUserId: null });
  const subscribedEndpoints: string[] = [];
  const subscribe = async (customerAccountId: string, salesChannelId: string): Promise<void> => {
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
    subscribedEndpoints.push(endpoint);
    await h.pwa.subscriptionService.register({
      endpoint,
      keys: { p256dh: 'p', auth: 'a' },
      salesChannelId,
      customerAccountId,
    });
  };
  /** The channel a request's push goes out on: its own, or the system default. */
  const pushChannelOf = async (rfqId: string): Promise<string> =>
    (await requestRow(rfqId)).sales_channel_id ?? (await h.salesChannels.resolver.getSystemDefault()).id;
  /**
   * An *Administrator* member of the stub buyer's Organization — one who may
   * open every request there (`specs/170-organization-roles/` R-30), so the
   * customer side of a change names them beside the requester.
   */
  const colleagues: string[] = [];
  const administratorColleague = (): Promise<string> =>
    withSystemScope('notification-delivery test: an Administrator beside the stub buyer', async () => {
      const em = h.orm.em.fork();
      const account = em.create(CustomerAccount, {
        organizationId: TEST_ORGANIZATION_ID,
        email: `179-push-colleague-${randomUUID()}@h.local`,
        passwordHash: 'x'.repeat(60),
        firstName: 'Paula',
        lastName: 'Colleague',
        organizationRoleId: await predefinedRoleIdOf(em, TEST_ORGANIZATION_ID, 'administrator'),
      });
      await em.persistAndFlush(account);
      colleagues.push(account.id);
      return account.id;
    });
  /** Push on for every channel, for the length of `run`. */
  const withPushOn = async (run: () => Promise<void>): Promise<void> => {
    await setPushSetting(PWA_SETTING_CODES.PUSH_ENABLED, true);
    try {
      await run();
    } finally {
      await setPushSetting(PWA_SETTING_CODES.PUSH_ENABLED, false);
    }
  };
  const mailFor = (rfqId: string) =>
    mailer.accepted.filter((message) => (message.meta as Record<string, unknown> | undefined)?.['quoteRequestId'] === rfqId);

  const submitted = async (): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2 }] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const setActive = async (code: string, active: boolean): Promise<void> => {
    const em = h.em().fork();
    const email = await em.findOneOrFail(TransactionalEmail, { code });
    email.active = active;
    await em.flush();
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    // The baseline the other cases assert against: push off, quote pushes on (the shipped defaults).
    await setPushSetting(PWA_SETTING_CODES.PUSH_ENABLED, false);
    await setPushSetting(PWA_SETTING_CODES.PUSH_QUOTE_STATUS_ENABLED, true);
  });

  afterAll(async () => {
    const sql = h.em().getConnection();
    if (subscribedEndpoints.length > 0) {
      await sql.execute(
        `delete from "push_subscriptions" where "endpoint" in (${subscribedEndpoints.map(() => '?').join(', ')})`,
        subscribedEndpoints,
      );
    }
    await sql.execute(`delete from "push_notification_preferences" where "organization_id" = ?`, [TEST_ORGANIZATION_ID]);
    // The colleague stays a row (other tables name it) but stops being anybody's recipient.
    if (colleagues.length > 0) {
      await sql.execute(
        `update "customer_accounts" set "deleted_at" = now() where "id" in (${colleagues.map(() => '?').join(', ')})`,
        colleagues,
      );
    }
    await teardownBackendServer(h);
  });

  it('the worker’s tick delivers a submitted request: a bell entry per operator, the customer and operator e-mails', async () => {
    const id = await submitted();
    const before = await recordsOf(id);
    // The buyer submitted it: they get the e-mail and no centre entry about their own act (FR-007).
    expect(new Set(before.filter((record) => record.recipient_id === TEST_CUSTOMER_ID).map((record) => record.channel))).toEqual(
      new Set(['customer_email']),
    );
    expect(new Set(before.map((record) => record.channel))).toEqual(
      new Set([
        'admin_in_app',
        'admin_email',
        'customer_email',
        ...(before.some((record) => record.channel === 'customer_in_app') ? ['customer_in_app'] : []),
        ...(before.some((record) => record.channel === 'customer_push') ? ['customer_push'] : []),
      ]),
    );
    // The colleagues it tells in the centre are the ones it pushes to (WP-10).
    expect(before.filter((record) => record.channel === 'customer_push').map((record) => record.recipient_id).sort()).toEqual(
      before.filter((record) => record.channel === 'customer_in_app').map((record) => record.recipient_id).sort(),
    );
    expect(await delivery().hasDeliverable()).toBe(true);

    // The worker's own entry point: probe outside any scope, then the pass in the system scope.
    await runRfqNotificationDeliveryTick({
      delivery: delivery(),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
    });

    const after = await recordsOf(id);
    for (const record of after) expect(record.closed_at).not.toBeNull();
    for (const record of after.filter(notPush)) {
      expect(record, `${record.channel} → ${record.recipient_id}`).toMatchObject({ status: 'sent', attempts: 1 });
    }
    expectPushClosedOff(after);
    const bells = await bellEntriesOf(id);
    const operators = after.filter((record) => record.channel === 'admin_in_app').map((record) => record.recipient_id);
    expect(bells.map((bell) => bell.target_admin_user_id).sort()).toEqual([...operators].sort());
    for (const bell of bells) {
      expect(bell.kind).toBe('quote_requests.submitted');
      expect(bell.link_path).toBe(`/quote-requests/${id}`);
      expect(bell.title).toMatch(/^Quote request \S+ was submitted$/);
    }
    const mail = mailFor(id);
    const emailRecords = after.filter((record) => record.channel.endsWith('_email'));
    expect(mail.map((message) => message.messageId).sort()).toEqual(
      emailRecords.map((record) => `quote_request_notification:${record.id}`).sort(),
    );
    expect(new Set(mail.map((message) => (message.meta as Record<string, unknown>)['kind']))).toEqual(
      new Set(['quote_request_customer_submitted', 'quote_request_operator_submitted']),
    );
  });

  it('two passes at once claim each record once: one bell entry per operator, one e-mail per record', async () => {
    const id = await submitted();
    await Promise.all([pass(), pass()]);
    const records = await recordsOf(id);
    for (const record of records.filter(notPush)) expect(record).toMatchObject({ status: 'sent', attempts: 1 });
    expectPushClosedOff(records);
    const operators = records.filter((record) => record.channel === 'admin_in_app');
    expect(await bellEntriesOf(id)).toHaveLength(operators.length);
    const handedForRequest = mailer.handed.filter(
      (message) => (message.meta as Record<string, unknown> | undefined)?.['quoteRequestId'] === id,
    );
    expect(handedForRequest).toHaveLength(records.filter((record) => record.channel.endsWith('_email')).length);
  });

  it('a template the operator switched off closes skipped_deactivated; the other channels deliver (FR-024)', async () => {
    await setActive('quote_request_customer_submitted', false);
    try {
      const id = await submitted();
      await pass();
      const records = await recordsOf(id);
      expect(records.filter((record) => record.channel === 'customer_email').map((record) => record.status)).toEqual([
        'skipped_deactivated',
      ]);
      for (const record of records.filter((record) => record.channel !== 'customer_email').filter(notPush)) {
        expect(record.status).toBe('sent');
      }
    } finally {
      await setActive('quote_request_customer_submitted', true);
    }
  });

  it('the bell switched off closes skipped_module_off without a bell entry; the e-mails deliver (FR-012)', async () => {
    const id = await submitted();
    await withModuleOff('admin_notifications', 'deactivated', async () => {
      await pass();
    });
    const records = await recordsOf(id);
    for (const record of records.filter((record) => record.channel === 'admin_in_app')) {
      expect(record).toMatchObject({ status: 'skipped_module_off', attempts: 0 });
    }
    for (const record of records.filter((record) => record.channel !== 'admin_in_app').filter(notPush)) {
      expect(record.status).toBe('sent');
    }
    expect(await bellEntriesOf(id)).toHaveLength(0);
  });

  it('a crash after the transport accepted the e-mail and before the commit: the retry is suppressed, one e-mail in total (T045)', async () => {
    const id = await submitted();
    const adapters = delivery().deps.adapters;
    const original = adapters['customer_email']!;
    adapters['customer_email'] = {
      owner: original.owner,
      deliver: async (context: never) => {
        await original.deliver(context);
        throw new Error('the process died before the commit');
      },
    };
    const now = new Date();
    try {
      await pass(now);
    } finally {
      adapters['customer_email'] = original;
    }
    const [crashed] = (await recordsOf(id)).filter((record) => record.channel === 'customer_email');
    expect(crashed).toMatchObject({ status: 'pending', attempts: 1, last_error: 'the process died before the commit' });
    expect(mailFor(id).filter((message) => message.messageId === `quote_request_notification:${crashed!.id}`)).toHaveLength(1);

    // Its backoff over, the retry hands the same message id again — and the transport refuses the duplicate.
    await pass(new Date(now.getTime() + 2 * MINUTE));
    const [retried] = (await recordsOf(id)).filter((record) => record.channel === 'customer_email');
    expect(retried).toMatchObject({ status: 'sent', attempts: 2 });
    const messageId = `quote_request_notification:${crashed!.id}`;
    expect(mailer.handed.filter((message) => message.messageId === messageId)).toHaveLength(2);
    expect(mailer.accepted.filter((message) => message.messageId === messageId)).toHaveLength(1);
  });

  it('an operator’s revision writes one centre entry per customer recipient, read on the storefront in the buyer’s language (T070)', async () => {
    const id = await submitted();
    await revised(id);
    await pass();
    const rfq = await requestRow(id);
    const centreRecords = (await recordsOf(id)).filter((record) => record.channel === 'customer_in_app');
    const forRevision = centreRecords.filter((record) => record.recipient_id === TEST_CUSTOMER_ID);
    expect(forRevision).toHaveLength(1);
    for (const record of centreRecords) expect(record).toMatchObject({ status: 'sent', attempts: 1 });

    const entries = await centreEntriesOf(id);
    expect(entries.map((entry) => entry.source_key).sort()).toEqual(centreRecords.map((record) => record.id).sort());
    const own = entries.find((entry) => entry.source_key === forRevision[0]!.id)!;
    expect(own).toMatchObject({
      organization_id: rfq.organization_id,
      customer_account_id: TEST_CUSTOMER_ID,
      sales_channel_id: rfq.sales_channel_id,
      kind: 'quote_requests.revised',
      link_path: `/quote-requests/${id}`,
    });
    expect(own.title).toMatch(/^Your offer for quote request \S+ is ready$/);
    expect(own.title_message).toMatchObject({ scope: 'quote_requests', key: 'customerNotifications.revised.title' });

    // The buyer's centre, on the request's channel, in Polish.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/storefront/notifications',
      cookies: CUSTOMER,
      headers: { 'x-sales-channel': 'default', 'accept-language': 'pl-PL' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const items = (res.json() as { data: { items: Array<{ kind: string; title: string; linkPath: string | null }> } })
      .data.items;
    const shown = items.find((item) => item.linkPath === `/quote-requests/${id}` && item.kind === 'quote_requests.revised');
    expect(shown, JSON.stringify(items)).toBeDefined();
    expect(shown!.title).toMatch(/^Oferta do zapytania \S+ jest gotowa$/);
  });

  it('the centre switched off: skipped_module_off, no entry — and none once it is back (FR-012, FR-048)', async () => {
    const id = await submitted();
    await revised(id);
    await withModuleOff('customer_notifications', 'deactivated', async () => {
      await pass();
    });
    const records = await recordsOf(id);
    const centre = records.filter((record) => record.channel === 'customer_in_app');
    expect(centre.length).toBeGreaterThan(0);
    for (const record of centre) expect(record).toMatchObject({ status: 'skipped_module_off', attempts: 0 });
    for (const record of records.filter((record) => record.channel !== 'customer_in_app').filter(notPush)) {
      expect(record.status).toBe('sent');
    }
    expect(await centreEntriesOf(id)).toHaveLength(0);

    // Closed is closed: switching the centre back on delivers nothing late.
    await pass();
    expect(await centreEntriesOf(id)).toHaveLength(0);
  });

  it('push on: a revision pushes to each recipient who has a device and wants quote updates, once, in the channel’s language (T092, US4)', async () => {
    const colleague = await administratorColleague();
    const id = await submitted();
    const channelId = await pushChannelOf(id);
    // The buyer submitted it: the colleague has a push record about it, the buyer none (FR-007).
    const submission = (await recordsOf(id)).filter((record) => record.channel === 'customer_push');
    expect(submission.map((record) => record.recipient_id)).toContain(colleague);
    expect(submission.map((record) => record.recipient_id)).not.toContain(TEST_CUSTOMER_ID);
    await subscribe(TEST_CUSTOMER_ID, channelId);
    await subscribe(colleague, channelId);
    await withSystemScope('notification-delivery test: a colleague turns quote updates off', () =>
      h.pwa.preferenceService.update(colleague, { quoteStatus: false }),
    );
    // The submission's own records close first, so the revision's are the only ones left.
    await pass();

    await withPushOn(async () => {
      await revised(id);
      await pass();
    });
    const revisionPushes = (await recordsOf(id)).filter(
      (record) => record.channel === 'customer_push' && record.status !== 'skipped_deactivated',
    );
    const own = revisionPushes.find((record) => record.recipient_id === TEST_CUSTOMER_ID)!;
    const theirs = revisionPushes.find((record) => record.recipient_id === colleague)!;
    expect(own).toMatchObject({ status: 'sent', attempts: 1 });
    expect(theirs).toMatchObject({ status: 'skipped_preference', attempts: 1 });
    for (const record of revisionPushes.filter((record) => record !== own && record !== theirs)) {
      expect(record.status, `${record.recipient_id} has no device`).toBe('skipped_no_subscription');
    }

    const messages = await pushMessagesFor(revisionPushes);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      source_event_id: own.id,
      title: 'Quote request update',
      url: `/quote-requests/${id}`,
      sales_channel_id: channelId,
      audience: { kind: 'customers', customerAccountIds: [TEST_CUSTOMER_ID] },
    });
    expect(messages[0]!.body).toMatch(/^Your offer for quote request \S+ is ready$/);
  });

  it('a crash after the push was enqueued and before the commit: the retry writes nothing, one push in total (FR-014)', async () => {
    const id = await submitted();
    await subscribe(TEST_CUSTOMER_ID, await pushChannelOf(id));
    await pass();
    const adapters = delivery().deps.adapters;
    const original = adapters['customer_push']!;
    adapters['customer_push'] = {
      owner: original.owner,
      deliver: async (context: never) => {
        await original.deliver(context);
        throw new Error('the process died before the commit');
      },
    };
    await withPushOn(async () => {
      await revised(id);
      const now = new Date();
      try {
        await pass(now);
      } finally {
        adapters['customer_push'] = original;
      }
      const [crashed] = (await recordsOf(id)).filter(
        (record) => record.channel === 'customer_push' && record.recipient_id === TEST_CUSTOMER_ID && record.status === 'pending',
      );
      expect(crashed).toMatchObject({ attempts: 1, last_error: 'the process died before the commit' });
      expect(await pushMessagesFor([crashed!])).toHaveLength(1);

      await pass(new Date(now.getTime() + 2 * MINUTE));
      const retried = (await recordsOf(id)).find((record) => record.id === crashed!.id)!;
      expect(retried).toMatchObject({ status: 'sent', attempts: 2 });
      expect(await pushMessagesFor([retried])).toHaveLength(1);
    });
  });

  it('pwa switched off: skipped_module_off, no push message; the other channels deliver (FR-012)', async () => {
    const id = await submitted();
    await subscribe(TEST_CUSTOMER_ID, await pushChannelOf(id));
    await pass();
    await withPushOn(async () => {
      await revised(id);
      await withModuleOff('pwa', 'deactivated', async () => {
        await pass();
      });
    });
    const records = await recordsOf(id);
    const pushes = records.filter((record) => record.channel === 'customer_push' && record.status !== 'skipped_deactivated');
    expect(pushes.length).toBeGreaterThan(0);
    for (const record of pushes) expect(record).toMatchObject({ status: 'skipped_module_off', attempts: 0 });
    for (const record of records.filter(notPush)) expect(record.status).toBe('sent');
    expect(await pushMessagesFor(pushes)).toHaveLength(0);
  });
});
