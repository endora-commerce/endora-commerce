import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Integration — registration returns honest emailVerificationSent with default test mailer.
 */

describe('POST /api/v1/organizations/register — integration', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 201 with emailVerificationSent true when ConsoleMailer succeeds', async () => {
    const payload = {
      organization: {
        name: 'Integration Reg Co',
        taxId: 'PL1122334455',
        registeredAddress: {
          street: 'ul. Integracyjna 3',
          city: 'Gdańsk',
          postalCode: '80-001',
          country: 'PL',
        },
      },
      firstUser: {
        email: 'integration-reg@example.com',
        password: 'a-very-strong-password-123!',
        firstName: 'Jan',
        lastName: 'Integration',
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
  });
});
