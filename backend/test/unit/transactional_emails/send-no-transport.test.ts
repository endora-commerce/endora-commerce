// Feature 072 (issue 67) — sending with no transport wired.
//
// A composition without a `Mailer` cannot deliver anything. `send` says so in
// its outcome instead of resolving as if the mail had gone out, and warns
// **once per process**, not once per send, so a misconfigured deployment does
// not drown its own log.
//
// This is deliberately the only test file that builds a mailer-less
// `TransactionalEmailService`: the warning guard is per process, so a second
// file exercising the same path would observe zero warnings and could not
// assert the "once" part.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { TransactionalEmailService } from '../../../src/modules/transactional_emails/services/transactional-email.service.js';
import { ContentResolver } from '../../../src/modules/transactional_emails/services/content-resolver.js';
import { BrandingService } from '../../../src/modules/transactional_emails/services/branding.service.js';
import { EmbedResolver } from '../../../src/modules/transactional_emails/services/embed-resolver.js';
import { EmailDefaultsRegistry } from '../../../src/modules/transactional_emails/services/email-defaults-registry.js';
import type { SettingsService } from '../../../src/kernel/settings/settings.service.js';

const fakeSettings = {
  get: async () => {
    throw new Error('no settings in this test');
  },
} as unknown as SettingsService;

/** No transport means no database round-trip either. */
const forbiddenEm = (): EntityManager => {
  throw new Error('the entity manager must not be reached without a transport');
};

function serviceWithoutMailer(): TransactionalEmailService {
  return new TransactionalEmailService({
    emFactory: forbiddenEm,
    contentResolver: new ContentResolver(),
    branding: new BrandingService(fakeSettings),
    embeds: new EmbedResolver(),
    defaults: new EmailDefaultsRegistry(),
  });
}

const message = {
  code: 'order_confirmation',
  salesChannelId: '00000000-0000-0000-0000-0000000000aa',
  language: 'en-US',
  to: 'buyer@example.com',
  messageId: 'order_confirmation:no-transport',
  variables: {},
};

describe('transactional email send — no transport configured', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports no_transport and warns once per process, not once per send', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const first = await serviceWithoutMailer().send({ ...message, messageId: 'first' });
    const second = await serviceWithoutMailer().send({ ...message, messageId: 'second' });

    expect(first).toEqual({ status: 'no_transport' });
    expect(second).toEqual({ status: 'no_transport' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('transactional_emails');
  });
});
