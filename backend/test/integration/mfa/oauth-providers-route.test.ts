import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #193 — the pre-auth route that tells a login screen which federated
 * providers it may actually offer.
 *
 * The screens are pre-auth, so the admin settings API is unreachable to them
 * and there was no other way to learn this. Until this route existed both
 * frontends rendered both buttons unconditionally — and since both provider
 * settings ship `false`, a default deployment advertised two sign-in routes
 * that could not work.
 *
 * What the route answers is the same conjunction `/oauth/:provider/start`
 * already applies before it will redirect anywhere: the operator's setting for
 * this surface, AND the provider being configured. These cases pin that the two
 * halves agree, because a screen that offers a button `/start` then refuses is
 * the defect in a new costume.
 */
async function setProviderEnabled(
  h: BackendServerHandle,
  code: string,
  enabled: boolean,
): Promise<void> {
  await h.settings.adminService.setValueForAllChannels(code, enabled, null, {
    actorAdminUserId: null,
  });
}

function providers(h: BackendServerHandle, surface: 'customer' | 'admin') {
  return h.app.inject({ method: 'GET', url: `/api/v1/auth/${surface}/oauth/providers` });
}

describe('GET /api/v1/auth/:surface/oauth/providers (#193)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lists nothing while both settings are off — the default deployment', async () => {
    await setProviderEnabled(h, 'mfa.storefront.google_enabled', false);
    await setProviderEnabled(h, 'mfa.storefront.microsoft_enabled', false);

    const res = await providers(h, 'customer');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ providers: [] });
  });

  it('lists a provider once its setting is on, and drops it again when it is off', async () => {
    await setProviderEnabled(h, 'mfa.storefront.google_enabled', true);
    expect((await providers(h, 'customer')).json()).toEqual({ providers: ['google'] });

    await setProviderEnabled(h, 'mfa.storefront.google_enabled', false);
    expect((await providers(h, 'customer')).json()).toEqual({ providers: [] });
  });

  it('agrees with /start: a listed provider redirects, an unlisted one refuses', async () => {
    await setProviderEnabled(h, 'mfa.storefront.google_enabled', true);
    const listed = (await providers(h, 'customer')).json() as { providers: string[] };
    expect(listed.providers).toContain('google');

    const start = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    expect(start.statusCode).toBe(302);
    // The refusal path redirects to the login screen with an error rather than
    // to the provider, so the discriminator is the host, not the status.
    expect(new URL(start.headers['location'] as string).pathname).not.toContain('/login');

    await setProviderEnabled(h, 'mfa.storefront.google_enabled', false);
    expect(((await providers(h, 'customer')).json() as { providers: string[] }).providers).not.toContain(
      'google',
    );
    const refused = await h.app.inject({
      method: 'GET',
      url: '/api/v1/auth/customer/oauth/google/start',
    });
    expect(refused.statusCode).toBe(302);
    expect(refused.headers['location']).toContain('/login?error=');
  });

  it('answers the admin surface separately from the customer surface', async () => {
    const res = await providers(h, 'admin');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray((res.json() as { providers: unknown }).providers)).toBe(true);
  });

  it('needs no session — it is the login screen that asks', async () => {
    const res = await providers(h, 'customer');
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).toBe(200);
  });

  it('reveals no client id, redirect URI or per-account state', async () => {
    await setProviderEnabled(h, 'mfa.storefront.google_enabled', true);
    const body = JSON.stringify((await providers(h, 'customer')).json());
    expect(Object.keys(JSON.parse(body))).toEqual(['providers']);
    expect(body).not.toMatch(/client|secret|redirect|http/i);
  });
});
