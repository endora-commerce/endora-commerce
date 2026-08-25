import { EmailDelivery } from '../../helpers/package-entities.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import type { EmailCradle } from '../../../../packages/modules/email/src/backend/index.js';
import { PersistentEmailDeliveryRecorder } from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';


/**
 * D-59 — the durable half of "best-effort send, full visibility".
 *
 * `Mailer.send()` answered `void` and `email` owned no entity, so the answer to
 * "did the customer get the invoice" survived exactly as long as the log did.
 * These cases pin the row, the containment of a failed *record* write, and the
 * wiring: the mailer the container hands every sending module is the recording
 * one, so no call site can forget.
 */
describe('email — the delivery record is written and never costs a send (D-59)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    const em = h.em();
    await em.nativeDelete(EmailDelivery, {});
    em.clear();
  });

  it('persists one row per delivery decision', async () => {
    const recorder = new PersistentEmailDeliveryRecorder(h.em);
    const id = await recorder.record({
      messageId: 'invoice_issued:row-1',
      recipient: 'buyer@example.com',
      kind: 'invoice_issued',
      status: 'sent',
      subject: 'Invoice FV 1/2026',
      documentType: 'invoice',
      documentId: 'ffffffff-0000-4000-8000-000000000001',
      context: { orderId: 'ffffffff-0000-4000-8000-000000000002' },
    });
    expect(id).not.toBeNull();

    const em = h.em();
    em.clear();
    const rows = await em.find(EmailDelivery, { messageId: 'invoice_issued:row-1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient: 'buyer@example.com',
      kind: 'invoice_issued',
      status: 'sent',
      documentType: 'invoice',
      documentId: 'ffffffff-0000-4000-8000-000000000001',
    });
    expect(rows[0]!.attemptedAt).toBeInstanceOf(Date);
    // A delivered message carries no reason — MikroORM leaves an absent
    // nullable column undefined on the hydrated entity rather than null.
    expect(rows[0]!.reason ?? null).toBeNull();
  });

  it('distinguishes a message suppressed by policy from one that failed', async () => {
    const recorder = new PersistentEmailDeliveryRecorder(h.em);
    await recorder.record({
      messageId: 'invoice_issued:off',
      recipient: 'buyer@example.com',
      kind: 'invoice_issued',
      status: 'suppressed',
      reason: 'deactivated',
    });
    await recorder.record({
      messageId: 'invoice_issued:broken',
      recipient: 'buyer@example.com',
      kind: 'invoice_issued',
      status: 'failed',
      reason: 'transport_error',
      detail: 'smtp down',
    });

    const em = h.em();
    em.clear();
    const rows = await em.find(EmailDelivery, {}, { orderBy: { messageId: 'asc' } });
    expect(rows.map((r) => [r.status, r.reason])).toEqual([
      ['failed', 'transport_error'],
      ['suppressed', 'deactivated'],
    ]);
  });

  it('answers null rather than throwing when the row cannot be written', async () => {
    const broken = (): EntityManager =>
      ({
        create: () => ({}),
        persistAndFlush: async () => {
          throw new Error('deadlock detected');
        },
      }) as unknown as EntityManager;
    const logged: Array<Record<string, unknown>> = [];
    const recorder = new PersistentEmailDeliveryRecorder(broken, (_m, context) =>
      logged.push(context),
    );

    await expect(
      recorder.record({
        messageId: 'invoice_issued:unwritable',
        recipient: 'buyer@example.com',
        kind: 'invoice_issued',
        status: 'sent',
      }),
    ).resolves.toBeNull();
    expect(logged).toHaveLength(1);
    expect(String(logged[0]!['error'])).toContain('deadlock detected');
  });

  it('records through the mailer the container hands every sending module', async () => {
    const { emailMailer } = h.container.cradle as unknown as EmailCradle;
    await emailMailer.send({
      messageId: 'wired:1',
      to: 'buyer@example.com',
      subject: 'Wired',
      text: 'body',
      kind: 'invoice_issued',
    });

    const em = h.em();
    em.clear();
    const rows = await em.find(EmailDelivery, { messageId: 'wired:1' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('sent');
  });
});
