import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AdminRole, AdminUser } from '../../helpers/package-entities.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';

/**
 * Who may read the API description.
 *
 * `GET /api/v1/_openapi.json` and the interactive reference at
 * `GET /api/v1/_docs` answer an administrator holding
 * `platform.api_description.read` and an API key issued with that scope —
 * nobody else. The admin route `GET /api/v1/admin/api-description` serves the
 * same document to the Admin UI under the same code.
 *
 * The refusals are the admin guard's: 401 `UNAUTHORIZED` with no credentials or
 * with a customer session, 403 `FORBIDDEN` for an administrator without the
 * code, and 403 for an API key without the scope.
 */

const CODE = 'platform.api_description.read';
const DOCUMENT = '/api/v1/_openapi.json';
const REFERENCE = '/api/v1/_docs';
const ADMIN_DOCUMENT = '/api/v1/admin/api-description';

const PLATFORM_ADMIN = { b2b_session: 'stub-admin-session' };
/** Holds `orders:read` only. */
const RESTRICTED_ADMIN = { b2b_session: 'stub-restricted-admin-session' };
const CUSTOMER = { b2b_session: 'stub-customer-session' };

/** The swagger-ui-dist release the reference page loads, and its two files' digests. */
const SWAGGER_UI_VERSION = '5.33.3';
const CSS_INTEGRITY = 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW';
const JS_INTEGRITY = 'sha384-h00llMzD1afyNow1pDmnZKlHsUZgp9KE9HXLFXF2CvbwsBY0+WBO4f75SfGwvM4K';

function errorCode(body: string): string | undefined {
  return (JSON.parse(body) as { error?: { code?: string } }).error?.code;
}

describe('API description — access', () => {
  let h: BackendServerHandle;
  let describerCookie: string;
  let scopedToken: string;
  let unscopedToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    // An administrator whose role holds this one code and nothing else, so a
    // 200 cannot come from the platform administrator's wildcard.
    const em = h.em();
    const role = em.create(AdminRole, {
      code: `api-describer-${randomUUID().slice(0, 8)}`,
      name: 'API describer',
      permissions: [CODE],
    });
    await em.persist(role).flush();
    const admin = em.create(AdminUser, {
      email: `api-describer-${randomUUID().slice(0, 8)}@api-description.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'Api',
      lastName: 'Describer',
      status: 'active',
    });
    await em.persist(admin).flush();
    describerCookie = `stub-api-describer-${admin.id}`;
    ADMIN_COOKIES[describerCookie] = { adminUserId: admin.id };

    const mint = async (scopes: string[]): Promise<string> => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/api-keys',
        payload: { name: `API description ${scopes.join(',')}`, scopes },
        cookies: PLATFORM_ADMIN,
      });
      expect(created.statusCode, created.body).toBe(201);
      return (created.json() as { data: { bearerToken: string } }).data.bearerToken;
    };
    scopedToken = await mint([CODE]);
    unscopedToken = await mint(['catalog:read']);
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[describerCookie];
    await teardownBackendServer(h);
  });

  describe.each([DOCUMENT, REFERENCE, ADMIN_DOCUMENT])('%s', (url) => {
    it('refuses an anonymous caller with 401', async () => {
      const res = await h.app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      expect(errorCode(res.body)).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('refuses a customer session with 401', async () => {
      const res = await h.app.inject({ method: 'GET', url, cookies: CUSTOMER });
      expect(res.statusCode).toBe(401);
      expect(errorCode(res.body)).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('refuses an administrator without the permission with 403', async () => {
      const res = await h.app.inject({ method: 'GET', url, cookies: RESTRICTED_ADMIN });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res.body)).toBe(ERROR_CODES.FORBIDDEN);
    });

    it('answers an administrator whose role holds the permission', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url,
        cookies: { b2b_session: describerCookie },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('answers the platform administrator', async () => {
      const res = await h.app.inject({ method: 'GET', url, cookies: PLATFORM_ADMIN });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('refuses an unknown bearer token with 401', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url,
        headers: { authorization: 'Bearer sk_live_not-a-key' },
      });
      expect(res.statusCode).toBe(401);
      expect(errorCode(res.body)).toBe(ERROR_CODES.UNAUTHORIZED);
    });
  });

  describe.each([DOCUMENT, REFERENCE])('%s with an API key', (url) => {
    it('answers a key issued with the scope', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${scopedToken}` },
      });
      expect(res.statusCode, res.body).toBe(200);
    });

    it('refuses a key without the scope with 403', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${unscopedToken}` },
      });
      expect(res.statusCode).toBe(403);
      expect(errorCode(res.body)).toBe(ERROR_CODES.FORBIDDEN);
    });
  });

  it('the admin route is for administrators: an API key with the scope is refused', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: ADMIN_DOCUMENT,
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('the admin route and the public route serve the same document', async () => {
    const viaAdmin = await h.app.inject({
      method: 'GET',
      url: ADMIN_DOCUMENT,
      cookies: PLATFORM_ADMIN,
    });
    const viaKey = await h.app.inject({
      method: 'GET',
      url: DOCUMENT,
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    const document = viaKey.json() as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toMatch(/^3\.1/);
    expect(Object.keys(document.paths).length).toBeGreaterThan(0);
    expect(viaAdmin.json()).toEqual(document);
  });

  it('the reference page loads a pinned swagger-ui-dist with subresource integrity', async () => {
    const res = await h.app.inject({ method: 'GET', url: REFERENCE, cookies: PLATFORM_ADMIN });
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const html = res.body;

    const css = html.match(/<link[^>]*swagger-ui\.css[^>]*>/)?.[0];
    const js = html.match(/<script[^>]*swagger-ui-bundle\.js[^>]*>/)?.[0];
    expect(css, 'stylesheet tag').toBeDefined();
    expect(js, 'script tag').toBeDefined();

    expect(css).toContain(`swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css`);
    expect(js).toContain(`swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js`);
    expect(css).toContain(`integrity="${CSS_INTEGRITY}"`);
    expect(js).toContain(`integrity="${JS_INTEGRITY}"`);
    expect(css).toContain('crossorigin="anonymous"');
    expect(js).toContain('crossorigin="anonymous"');

    // No unpinned CDN reference anywhere on the page.
    expect(html).not.toMatch(/swagger-ui-dist\//);
  });
});
