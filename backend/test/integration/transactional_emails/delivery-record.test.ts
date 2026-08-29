import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';
import { RecordingMailer } from '../../../../packages/modules/email/src/backend/services/recording-mailer.js';
import type {
  EmailDeliveryRecorder,
  EmailDeliveryRecordInput,
} from '../../../../packages/modules/email/src/backend/services/email-delivery-recorder.js';
import { TransactionalEmailService } from '../../../../packages/modules/transactional_emails/src/backend/services/transactional-email.service.js';
import { ContentResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/content-resolver.js';
import { BrandingService } from '../../../../packages/modules/transactional_emails/src/backend/services/branding.service.js';
import { EmbedResolver } from '../../../../packages/modules/transactional_emails/src/backend/services/embed-resolver.js';
import { EmailDefaultsRegistry } from '../../../../packages/modules/transactional_emails/src/backend/services/email-defaults-registry.js';
import {
  SettingNotRegistered,
  type SettingsService,
} from '../../../src/kernel/settings/settings.service.js';
import { TransactionalEmail } from '../../helpers/package-entities.js';

/**
 * D-59 — the distinction the record exists to carry.
 *
 * Per-email deactivation shipped with feature 074, so "not sent" stopped
 * meaning "broken": an operator who switched `invoice_issued` off and an SMTP
 * host that refused the message are two different answers to the same support
 * question, and only one of them is an outage. The three outcomes the sender
 * decides **before** the transport is reached would otherwise leave no row at
 * all, because the row the transport writes is never reached either.
 */

const CHANNEL = '00000000-0000-0000-0000-0000000000aa';
const ORDINARY = 'availability_back_in_stock';

const fakeSettings = {
  get: async (code: string) => {
    throw new SettingNotRegistered(code);
  },
} as unknown as SettingsService;

class StubRecorder implements EmailDeliveryRecorder {
  readonly rows: EmailDeliveryRecordInput[] = [];
  async record(input: EmailDeliveryRecordInput): Promise<string | null> {
    this.rows.push(input);
    return 'row-1';
  }
}

describe('transactional emails — a suppressed message is recorded as suppressed (D-59)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  afterEach(async () => {
    const em = h.em();
    await em.nativeUpdate(TransactionalEmail, {}, { active: true });
    em.clear();
  });

  function service(
    recorder: EmailDeliveryRecorder,
    mailer: InMemoryMailer | RecordingMailer | undefined,
  ): TransactionalEmailService {
    return new TransactionalEmailService({
      emFactory: h.em,
      contentResolver: new ContentResolver(),
      branding: new BrandingService(fakeSettings),
      embeds: new EmbedResolver(),
      defaults: new EmailDefaultsRegistry(),
      deliveryRecorder: recorder,
      ...(mailer ? { mailer } : {}),
    });
  }

  const send = (
    svc: TransactionalEmailService,
    code: string,
    messageId: string,
  ): Promise<unknown> =>
    svc.send({
      code,
      salesChannelId: CHANNEL,
      language: 'en-US',
      to: 'buyer@example.com',
      messageId,
      variables: { product: { name: 'Widget' } },
    });

  it('records the operator switching one e-mail off as suppressed', async () => {
    const em = h.em();
    await em.nativeUpdate(TransactionalEmail, { code: ORDINARY }, { active: false });
    em.clear();

    const recorder = new StubRecorder();
    const outcome = await send(service(recorder, new InMemoryMailer()), ORDINARY, 'rec:off');

    expect(outcome).toEqual({ status: 'deactivated' });
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({
      messageId: 'rec:off',
      recipient: 'buyer@example.com',
      kind: ORDINARY,
      status: 'suppressed',
      reason: 'deactivated',
      salesChannelId: CHANNEL,
    });
  });

  it('records a composition with no transport as failed, not as suppressed', async () => {
    const recorder = new StubRecorder();
    const outcome = await send(service(recorder, undefined), ORDINARY, 'rec:no-transport');

    expect(outcome).toEqual({ status: 'no_transport' });
    expect(recorder.rows[0]).toMatchObject({ status: 'failed', reason: 'no_transport' });
  });

  it('records a code with no definition as failed', async () => {
    const recorder = new StubRecorder();
    const outcome = await send(
      service(recorder, new InMemoryMailer()),
      'no_such_email_code',
      'rec:undefined',
    );

    expect(outcome).toEqual({ status: 'no_definition' });
    expect(recorder.rows[0]).toMatchObject({ status: 'failed', reason: 'no_definition' });
  });

  it('leaves the delivered message to the transport, so one send is one row', async () => {
    const recorder = new StubRecorder();
    const mailer = new RecordingMailer(new InMemoryMailer(), recorder);
    const outcome = await send(service(recorder, mailer), ORDINARY, 'rec:sent');

    expect(outcome).toEqual({ status: 'sent' });
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0]).toMatchObject({ status: 'sent', kind: ORDINARY });
  });
});
