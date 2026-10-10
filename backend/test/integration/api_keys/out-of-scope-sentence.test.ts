import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #86 — `API_KEY_OUT_OF_SCOPE` names the missing scope where a program
 * can read it, and in the caller's language.
 *
 * This code was the one deliberately left without a bundle sentence: the raise
 * writes "API key lacks the required scope: catalog:write.", it passed no
 * `details`, and a fixed sentence would have replaced the scope with something
 * vaguer. So an integration was answered in English only, and had to cut the
 * scope out of prose to learn it.
 *
 * The scope now travels in `details.requiredScope`, which is what lets a
 * sentence name it in both languages.
 *
 * **What `details` must not carry** is the last case: the scopes the key does
 * hold. The audit row records them for the operator; the refusal is answered to
 * whoever holds the token, and it says what is missing and nothing about what
 * is there.
 */

interface Refusal {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describe('API_KEY_OUT_OF_SCOPE names the missing scope (issue #86)', () => {
  let h: BackendServerHandle;
  let readOnlyToken = '';

  async function refusal(acceptLanguage: string): Promise<Refusal['error']> {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/catalog/products/by-sku/I86-SCOPE-001',
      payload: {
        sku: 'I86-SCOPE-001',
        type: 'simple',
        name: { 'en-US': 'Scope sentence' },
        description: { 'en-US': 'Scope sentence' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      headers: { authorization: `Bearer ${readOnlyToken}`, 'accept-language': acceptLanguage },
    });
    // The status the refusal has always had.
    expect(res.statusCode).toBe(403);
    const body = res.json() as Refusal;
    expect(body.error.code).toBe(ERROR_CODES.API_KEY_OUT_OF_SCOPE);
    return body.error;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/api-keys',
      payload: { name: 'Issue 86 read-only', scopes: ['catalog:read'] },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(created.statusCode).toBeLessThan(300);
    readOnlyToken = (created.json() as { data: { bearerToken: string } }).data.bearerToken;
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('details name the scope the route requires', async () => {
    const { details } = await refusal('en');
    expect(details).toEqual({ requiredScope: 'catalog:write' });
  });

  it('en — the sentence names the scope, as the message always did', async () => {
    expect((await refusal('en')).message).toBe(
      'API key lacks the required scope: catalog:write.',
    );
  });

  it('pl — the Polish sentence names it too, and is not the English one', async () => {
    const { message } = await refusal('pl');
    expect(message).toBe('Klucz API nie ma wymaganego zakresu: catalog:write.');
    expect(message).not.toMatch(/API key lacks|\{/);
  });

  it('says nothing about the scopes the key does hold', async () => {
    const error = await refusal('en');
    expect(JSON.stringify(error)).not.toMatch(/catalog:read/);
  });
});
