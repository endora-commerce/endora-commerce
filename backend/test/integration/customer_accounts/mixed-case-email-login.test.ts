import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CustomerPasswordResetPort } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../src/modules/customers/manifest.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * A buyer who registers with a mixed-case address must be able to log in with
 * the string they typed.
 *
 * The writes folded the address to lower case and the login read compared it
 * verbatim, so Postgres' case-sensitive `=` never matched: every account
 * registered as `Jan.Kowalski@…` was refused with the generic
 * anti-enumeration `INVALID_CREDENTIALS`, which tells neither the buyer nor
 * support what went wrong. Both public entrances are covered — standalone
 * registration and organisation registration — because the two write through
 * different services and only one of them folded before this fix.
 *
 * The assertions are about **the address as the holder typed it**, not about
 * the row: what is stored is this module's business, what has to work is
 * "register, then sign in with the same string".
 */
describe('customer_accounts — a mixed-case e-mail can log in', () => {
  let h: BackendServerHandle;

  const PASSWORD = 'a-very-strong-pass-12!';

  const passwordReset = (): CustomerPasswordResetPort =>
    (h.container.cradle as unknown as { passwordResetService: CustomerPasswordResetPort })
      .passwordResetService;

  const login = (email: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email, password: PASSWORD },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    // Standalone registration is gated by this setting and is one of the two
    // entrances under test.
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    const enabled = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { scope: 'all', value: true },
    });
    if (enabled.statusCode !== 200) {
      throw new Error(`enable registration failed: ${enabled.statusCode} ${enabled.body}`);
    }
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('signs in after standalone registration with the address as typed', async () => {
    const typed = `Jan.Kowalski-${Date.now()}@Example.PL`;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: typed,
        password: PASSWORD,
        firstName: 'Jan',
        lastName: 'Kowalski',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);

    const signedIn = await login(typed);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect((signedIn.json() as { data: { status: string } }).data.status).toBe('authenticated');
  });

  it('signs in after organisation registration with the address as typed', async () => {
    const stamp = Date.now();
    const typed = `Anna.Nowak-${stamp}@Example.PL`;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/organizations/register',
      payload: {
        organization: {
          name: `Mixed Case Co ${stamp}`,
          taxId: `PL${String(stamp).slice(-10)}`,
          registeredAddress: {
            street: 'ul. Mieszana 1',
            city: 'Gdańsk',
            postalCode: '80-001',
            country: 'PL',
          },
        },
        firstUser: {
          email: typed,
          password: PASSWORD,
          firstName: 'Anna',
          lastName: 'Nowak',
        },
        acceptedTermsVersion: '1.0.0',
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);

    const signedIn = await login(typed);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect((signedIn.json() as { data: { status: string } }).data.status).toBe('authenticated');
  });

  it('signs in with a casing the holder did not register with', async () => {
    const stamp = Date.now();
    const registeredAs = `case-shift-${stamp}@example.pl`;
    const registration = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: registeredAs,
        password: PASSWORD,
        firstName: 'Case',
        lastName: 'Shift',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);

    const signedIn = await login(`Case-Shift-${stamp}@Example.pl`);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
  });

  it('refuses a second registration that differs only in case', async () => {
    const stamp = Date.now();
    const first = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: `dupe-case-${stamp}@example.pl`,
        password: PASSWORD,
        firstName: 'First',
        lastName: 'Comer',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: `Dupe-Case-${stamp}@Example.PL`,
        password: PASSWORD,
        firstName: 'Second',
        lastName: 'Comer',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(second.statusCode, second.body).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      'EMAIL_ALREADY_REGISTERED',
    );
  });

  it('mints a reset token for an address requested in another casing', async () => {
    const stamp = Date.now();
    const registeredAs = `reset-case-${stamp}@example.pl`;
    const registration = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: registeredAs,
        password: PASSWORD,
        firstName: 'Reset',
        lastName: 'Case',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(registration.statusCode, registration.body).toBe(201);

    // The route e-mails the token and returns 202 either way (account-
    // enumeration defence), so the port is the only place the outcome is
    // visible — the same seam `password-set-at.test.ts` reads it through.
    const { rawToken } = await passwordReset().requestReset(`Reset-Case-${stamp}@Example.PL`);
    expect(rawToken, 'the request matched the registered account').toBeTruthy();
  });

  it('stores the folded address, so one spelling is on record', async () => {
    const stamp = Date.now();
    const typed = `Stored.Folded-${stamp}@Example.PL`;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: {
        email: typed,
        password: PASSWORD,
        firstName: 'Stored',
        lastName: 'Folded',
        acceptedTermsVersion: 'v1',
      },
    });
    expect(registered.statusCode, registered.body).toBe(201);

    h.em().clear();
    const row = await h.em().findOne(CustomerAccount, { email: typed.toLowerCase() });
    expect(row, 'the row is keyed by the folded address').not.toBeNull();
  });
});
