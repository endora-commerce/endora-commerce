import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import { ERROR_CODES, type AdminUserReadPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * An operator created with a mixed-case e-mail must be able to sign in with the
 * address they were handed.
 *
 * `AdminUserService.create` folded the address to lower case and every read
 * compared it verbatim. Postgres' `=` on `text` is case-sensitive, so an
 * operator created as `Anna.Nowak@endora.pl` had `anna.nowak@endora.pl` on
 * record and no login attempt with the string on their handover note ever
 * matched a row. The same split one module over from the buyer-side defect
 * !765 repaired, and the admin surface has no self-service reset to work
 * around it with: the only way out was another operator noticing.
 *
 * The assertions are about **the address as the operator was given it**, not
 * about the row: what is stored is this module's business, what has to work is
 * "create an operator, hand them the address, they sign in".
 */
describe('admin_users — a mixed-case e-mail can sign in', () => {
  let h: BackendServerHandle;

  const PASSWORD = 'super-strong-pass-123!';
  const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

  const readPort = (): AdminUserReadPort =>
    (h.container.cradle as unknown as { adminUserReadPort: AdminUserReadPort }).adminUserReadPort;

  function createOperator(email: string, password = PASSWORD) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: ADMIN_COOKIE,
      payload: { email, password, firstName: 'Anna', lastName: 'Nowak' },
    });
  }

  const login = (email: string, password = PASSWORD) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('signs in with the address the operator was created with', async () => {
    const typed = `Anna.Nowak-${Date.now()}@Endora.PL`;
    const created = await createOperator(typed);
    expect(created.statusCode, created.body).toBe(201);

    const signedIn = await login(typed);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect((signedIn.json() as { data: { status: string } }).data.status).toBe('authenticated');
    expect(signedIn.cookies.find((c) => c.name === 'b2b_admin_session')?.value).toBeTruthy();
  });

  it('signs in with a casing the operator was not created with', async () => {
    const stamp = Date.now();
    const created = await createOperator(`case-shift-${stamp}@endora.pl`);
    expect(created.statusCode, created.body).toBe(201);

    const signedIn = await login(`Case-Shift-${stamp}@Endora.PL`);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
  });

  it('stores the folded address, so one spelling is on record', async () => {
    const stamp = Date.now();
    const typed = `Stored.Folded-${stamp}@Endora.PL`;
    const created = await createOperator(typed);
    expect(created.statusCode, created.body).toBe(201);

    h.em().clear();
    const row = await h.em().findOne(AdminUser, { email: typed.toLowerCase() });
    expect(row, 'the row is keyed by the folded address').not.toBeNull();
  });

  it('answers findByEmail for an address asked in another casing, or padded', async () => {
    const stamp = Date.now();
    const created = await createOperator(`port-lookup-${stamp}@endora.pl`);
    expect(created.statusCode, created.body).toBe(201);

    const shifted = await readPort().findByEmail(`Port-Lookup-${stamp}@Endora.PL`);
    expect(shifted?.email).toBe(`port-lookup-${stamp}@endora.pl`);

    // Padding reaches this seam from the entrances that go through no request
    // schema — an identity provider's claim, the bootstrap CLI, an importer.
    // Zod's `.email()` refuses it at every HTTP boundary, so it is only
    // testable here.
    const padded = await readPort().findByEmail(`  port-lookup-${stamp}@endora.pl  `);
    expect(padded?.id).toBe(shifted?.id);
  });

  it('refuses a second operator whose address differs only in case', async () => {
    const stamp = Date.now();
    const first = await createOperator(`dupe-case-${stamp}@endora.pl`);
    expect(first.statusCode, first.body).toBe(201);

    const second = await createOperator(`Dupe-Case-${stamp}@Endora.PL`);
    expect(second.statusCode, second.body).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.EMAIL_ALREADY_REGISTERED,
    );
  });

  it('resolves a federated sign-in whose claim carries another casing', async () => {
    const stamp = Date.now();
    const created = await createOperator(`federated-${stamp}@endora.pl`);
    expect(created.statusCode, created.body).toBe(201);

    await h.settings.adminService.setValueForAllChannels(
      'mfa.admin.microsoft_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );

    const start = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/admin/oauth/microsoft/start',
    });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;

    // The fake provider derives the identity from the `code`, which is how the
    // casing of the identity provider's claim is chosen here.
    const claimed = `Federated-${stamp}@Endora.PL`;
    const callback = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/admin/oauth/microsoft/callback?code=${encodeURIComponent(claimed)}&state=${encodeURIComponent(state)}`,
    });
    expect(callback.statusCode).toBe(302);
    expect(
      callback.cookies.find((c) => c.name === 'b2b_admin_session')?.value,
      `location=${callback.headers['location']}`,
    ).toBeTruthy();
  });
});
