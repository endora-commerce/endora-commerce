import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { NewsletterProviderRegistry } from '../../../src/modules/newsletter/services/provider/provider-registry.js';
import { SmtpProvider } from '../../../src/modules/newsletter/services/provider/smtp-provider.js';
import { ConsoleNewsletterProvider } from '../../../src/modules/newsletter/services/provider/console-provider.js';

/**
 * Feature 058 US1 adoption (T061) — the newsletter sending provider is built
 * SOLELY from a `credential_ref` (`newsletter.email_credentials`, an
 * `email_adapter` configuration). When it is unset or unresolvable, dispatch
 * fails closed to the console (dev) sink. [real DB]
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

async function setSetting(h: BackendServerHandle, code: string, value: unknown): Promise<void> {
  const r = await h.app.inject({
    method: 'PUT',
    url: `/api/v1/admin/settings/${code}/value`,
    payload: { scope: 'all', value },
    ...ADMIN,
  });
  if (r.statusCode !== 200) throw new Error(`set ${code} failed: ${r.statusCode} ${r.body}`);
}

describe('Newsletter email adapter — credential_ref adoption [real DB]', () => {
  let h: BackendServerHandle;
  let registry: NewsletterProviderRegistry;

  beforeAll(async () => {
    process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] =
      process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] ?? randomBytes(32).toString('base64');
    h = await setupBackendServer();
    const channelId = (await h.salesChannels.resolver.getSystemDefault())!.id;
    registry = new NewsletterProviderRegistry(
      h.settings.settingsService,
      channelId,
      h.credentials.service,
    );
  });
  afterAll(async () => {
    await setSetting(h, 'newsletter.email_credentials', '');
    await teardownBackendServer(h);
  });

  it('builds the SMTP transport from the credential_ref', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/credentials',
      payload: {
        code: 'newsletter-smtp',
        name: 'Newsletter SMTP',
        typeCode: 'email_adapter',
        providerCode: 'smtp',
        values: {
          host: 'smtp.cred.example.test',
          port: 587,
          secure: false,
          username: 'cred-user',
          password: 'cred-pass',
        },
      },
      ...ADMIN,
    });
    expect(created.statusCode).toBe(201);

    await setSetting(h, 'newsletter.email_credentials', 'newsletter-smtp');

    expect(await registry.isConfigured()).toBe(true);
    const provider = await registry.resolveProvider();
    expect(provider).toBeInstanceOf(SmtpProvider);
  });

  it('fails closed to the console dev sink when no reference is set', async () => {
    await setSetting(h, 'newsletter.email_credentials', '');
    const provider = await registry.resolveProvider();
    expect(provider).toBeInstanceOf(ConsoleNewsletterProvider);
  });

  it('fails closed to the console dev sink when the reference is missing/inert', async () => {
    await setSetting(h, 'newsletter.email_credentials', 'does-not-exist');
    const provider = await registry.resolveProvider();
    expect(provider).toBeInstanceOf(ConsoleNewsletterProvider);
  });
});
