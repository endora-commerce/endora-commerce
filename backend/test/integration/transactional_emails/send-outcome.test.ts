// Feature 072 (issue 67) — `send` reports why nothing was delivered.
//
// The regression pinned here: a deactivated email and an unknown code both used
// to resolve silently, so the caller could not tell them apart and suppressed
// its legacy in-code builder for both. Deactivated must stay silent (that is
// the operator's decision); an unknown code must let the caller fall back.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../src/modules/email/services/mailer.js';
import { TransactionalEmailService } from '../../../src/modules/transactional_emails/services/transactional-email.service.js';
import { ContentResolver } from '../../../src/modules/transactional_emails/services/content-resolver.js';
import { BrandingService } from '../../../src/modules/transactional_emails/services/branding.service.js';
import { EmbedResolver } from '../../../src/modules/transactional_emails/services/embed-resolver.js';
import { EmailDefaultsRegistry } from '../../../src/modules/transactional_emails/services/email-defaults-registry.js';
import { TransactionalEmail } from '../../../src/modules/transactional_emails/entities/transactional-email.entity.js';
import {
  SettingNotRegistered,
  type SettingsService,
} from '../../../src/kernel/settings/settings.service.js';
import type { EmailMailerPort, EmailMailerSendInput } from '@endora-commerce/contracts';

const CHANNEL = '00000000-0000-0000-0000-0000000000aa';

/**
 * A transport that refuses the message as a duplicate — `email`'s one
 * suppression reason (D-59, MR !575). Typed by the published contract, which
 * is what this module names since feature 075's Phase C.
 */
class SuppressingMailer implements EmailMailerPort {
  readonly handed: EmailMailerSendInput[] = [];

  async send(
    input: EmailMailerSendInput,
  ): Promise<{ status: 'suppressed'; reason: 'duplicate_message_id' }> {
    this.handed.push(input);
    return { status: 'suppressed', reason: 'duplicate_message_id' };
  }
}

const fakeSettings = {
  // D-48 — a *real* settings condition, not a bare `Error`. Branding used to
  // absorb anything a settings read threw, which is how it also absorbed the
  // `SettingOutOfScopeForChannel` its nil-uuid scope produced; it degrades on
  // the two conditions with a defined fallback and propagates the rest now
  // (composition rule 7), so a stub throwing a generic error is asserting a
  // behaviour the service no longer has.
  get: async (code: string) => {
    throw new SettingNotRegistered(code);
  },
} as unknown as SettingsService;

function service(mailer: EmailMailerPort, h: BackendServerHandle): TransactionalEmailService {
  return new TransactionalEmailService({
    emFactory: h.em,
    contentResolver: new ContentResolver(),
    branding: new BrandingService(fakeSettings),
    embeds: new EmbedResolver(),
    defaults: new EmailDefaultsRegistry(),
    mailer,
  });
}

async function setActive(h: BackendServerHandle, code: string, active: boolean): Promise<void> {
  const em = h.em();
  const email = await em.findOneOrFail(TransactionalEmail, { code });
  email.active = active;
  await em.flush();
}

describe('transactional emails — send outcome (issue 67)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports sent when the email reaches the transport', async () => {
    const mailer = new InMemoryMailer();
    const outcome = await service(mailer, h).send({
      code: 'order_confirmation',
      salesChannelId: CHANNEL,
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'outcome:sent',
      variables: { order: { businessId: 'ORD-1', items: [] } },
    });
    expect(outcome).toEqual({ status: 'sent' });
    expect(mailer.sent).toHaveLength(1);
  });

  it('still reports sent when the transport suppressed the message as a duplicate', async () => {
    // The transport's `suppressed` means this exact message id was already
    // accepted, so the mail did go out. What this outcome tells a caller is
    // whether it may fall back to its own in-code builder, and it may not —
    // collapsing the two transport answers here is the decision, not a dropped
    // return value. `email` records the suppressed delivery row itself.
    const mailer = new SuppressingMailer();
    const outcome = await service(mailer, h).send({
      code: 'order_confirmation',
      salesChannelId: CHANNEL,
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'outcome:duplicate',
      variables: { order: { businessId: 'ORD-3', items: [] } },
    });
    expect(outcome).toEqual({ status: 'sent' });
    expect(mailer.handed).toHaveLength(1);
  });

  it('reports deactivated and sends nothing when the operator switched the email off', async () => {
    const mailer = new InMemoryMailer();
    await setActive(h, 'order_confirmation', false);
    try {
      const outcome = await service(mailer, h).send({
        code: 'order_confirmation',
        salesChannelId: CHANNEL,
        language: 'en-US',
        to: 'buyer@example.com',
        messageId: 'outcome:deactivated',
        variables: { order: { businessId: 'ORD-2', items: [] } },
      });
      expect(outcome).toEqual({ status: 'deactivated' });
      expect(mailer.sent).toHaveLength(0);
    } finally {
      await setActive(h, 'order_confirmation', true);
    }
  });

  it('reports no_definition for a code no module declares', async () => {
    const mailer = new InMemoryMailer();
    const outcome = await service(mailer, h).send({
      code: 'no_such_email_code',
      salesChannelId: CHANNEL,
      language: 'en-US',
      to: 'buyer@example.com',
      messageId: 'outcome:unknown',
      variables: {},
    });
    expect(outcome).toEqual({ status: 'no_definition' });
    expect(mailer.sent).toHaveLength(0);
  });
});
