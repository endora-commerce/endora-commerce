import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T095 — Email-verification round-trip: register creates a pending
 * verification; hitting the verify endpoint with the token flips Organization
 * status to active and CustomerAccount.emailVerifiedAt to a timestamp.
 */

describe('email verification flow', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('register → verify → customer account shows emailVerifiedAt', async () => {
    const register = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: 'VerifyCo',
          taxId: 'PL9876543210',
          registeredAddress: {
            street: 'ul. Weryfikacyjna 5',
            city: 'Krakow',
            postalCode: '30-001',
            country: 'PL',
          },
        },
        firstUser: {
          email: 'verify@example.com',
          password: 'strong-password-1234!',
          firstName: 'Jan',
          lastName: 'Kowalski',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(register.statusCode).toBe(201);

    // Fixture path: the test fetches the token synthesised by the registration
    // service from Mailhog or from a `/test-hooks` probe endpoint exposed only
    // in test mode. Until that endpoint lands the call below is a red probe.
    const tokenProbe = await h.app.inject({
      method: 'GET',
      url: '/api/v1/_test/latest-verification-token',
    });
    expect(tokenProbe.statusCode).toBe(200);
    const { token } = tokenProbe.json() as { token: string };

    const verify = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/email-verification/verify',
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as {
      data: { organizationId: string; customerAccountId: string; verifiedAt: string };
    };
    expect(body.data.verifiedAt).toMatch(/T.*Z/);
  });
});
