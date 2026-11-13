import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMailerPort, EmailMailerSendInput, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TransactionalEmail } from '../../helpers/package-entities.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';
import { runRfqNotificationDeliveryTick } from '../../../../packages/modules/quote_requests/src/backend/workers/rfq-notification-delivery-worker.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
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
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('the worker’s tick delivers a submitted request: a bell entry per operator, the customer and operator e-mails', async () => {
    const id = await submitted();
    const before = await recordsOf(id);
    expect(new Set(before.map((record) => record.channel))).toEqual(
      new Set(['admin_in_app', 'admin_email', 'customer_email']),
    );
    expect(await delivery().hasDeliverable()).toBe(true);

    // The worker's own entry point: probe outside any scope, then the pass in the system scope.
    await runRfqNotificationDeliveryTick({
      delivery: delivery(),
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
    });

    const after = await recordsOf(id);
    for (const record of after) {
      expect(record, `${record.channel} → ${record.recipient_id}`).toMatchObject({ status: 'sent', attempts: 1 });
      expect(record.closed_at).not.toBeNull();
    }
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
    for (const record of records) expect(record).toMatchObject({ status: 'sent', attempts: 1 });
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
      for (const record of records.filter((record) => record.channel !== 'customer_email')) {
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
    for (const record of records.filter((record) => record.channel !== 'admin_in_app')) {
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
});
