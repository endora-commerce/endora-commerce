import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { InMemoryMailer } from '../../../../packages/modules/email/src/backend/services/mailer.js';

/**
 * 003 — Registration dispatches verification email through the configured Mailer (FR-001).
 */

describe('POST /api/v1/organizations/register — verification email', () => {
  let h: BackendServerHandle;
  let mailer: InMemoryMailer;

  beforeAll(async () => {
    mailer = new InMemoryMailer();
    h = await setupBackendServer({ organizationsMailer: mailer });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('sends exactly one verification Mailer.send with expected recipient and subject', async () => {
    const payload = {
      organization: {
        name: 'VerifyMail Org AS',
        taxId: 'PL9988776655',
        registeredAddress: {
          street: 'ul. Pocztowa 2',
          city: 'Kraków',
          postalCode: '30-001',
          country: 'PL',
        },
      },
      firstUser: {
        email: 'verify-flow@example.com',
        password: 'a-very-strong-password-123!',
        firstName: 'Zoe',
        lastName: 'Verifier',
      },
      acceptedTermsVersion: '1.0.0',
    };

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { data: { emailVerificationSent: boolean } };
    expect(body.data.emailVerificationSent).toBe(true);

    expect(mailer.sent).toHaveLength(1);
    const msg = mailer.sent[0]!;
    expect(msg.to).toBe('verify-flow@example.com');
    expect(msg.subject).toContain('VerifyMail Org AS');
    expect(msg.text).toContain('/verify?token=');
    expect(msg.meta?.kind).toBe('email_verification');
  });
});
