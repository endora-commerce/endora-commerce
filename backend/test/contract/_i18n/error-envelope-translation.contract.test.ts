import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * The error envelope's translation path, exercised through a composed server
 * (issue #158).
 *
 * Until this file there was no such test, and there could not be: the harness
 * contributed `lifecycleManifestRegistry: () => undefined`, so `_i18n`'s
 * reconcile was a no-op, `translation_bundles` was **empty in every test**, and
 * the composition root's translator answered every key with the original
 * message. Every error assertion in the suite therefore measured the thrown
 * string and told you nothing about what an operator reads. Issue #65 shipped
 * through exactly that gap — the envelope replacing four transact gates' written
 * refusal with the generic `FORBIDDEN` sentence, on a green suite.
 *
 * The three cases below are chosen so none can pass without the bundles:
 *
 *   1. the message equals the **on-disk sentence** for `errors.NOT_FOUND`, read
 *      from the bundle here rather than pasted, so the assertion tracks the
 *      content instead of freezing a copy of it;
 *   2. it is not the message the route threw, which is what a composition with
 *      an empty bundle table returns;
 *   3. the same request under a `pl` admin comes back **different**. That one is
 *      content-independent: an untranslated path returns the identical original
 *      message whatever language the caller prefers, so a difference is proof
 *      that `resolvePreferredLanguage` → `translate` → the bundle all ran.
 *
 * `NOT_FOUND` routes to `core` in `ERROR_TRANSLATION_KEYS`, and `core` is the
 * namespace `_i18n`'s own bundle is exposed under — so this also covers the
 * `_i18n` → `core` rename that sits between the map and the row.
 */

const CORE_BUNDLES = fileURLToPath(new URL('../../../src/modules/_i18n/i18n/', import.meta.url));

function sentence(language: 'en' | 'pl', key: string): string {
  const bundle = JSON.parse(readFileSync(`${CORE_BUNDLES}${language}.json`, 'utf8')) as Record<
    string,
    string
  >;
  const value = bundle[key];
  if (value === undefined) {
    throw new Error(`the ${language} core bundle has no "${key}" — the fixture is stale.`);
  }
  return value;
}

describe('error envelope — an operator-visible message is the bundle sentence', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    // Leave the seeded admin on the platform default, so the language this file
    // set is not a thing the next file inherits.
    await setPreferredLanguage(null);
    await teardownBackendServer(h);
  });

  async function setPreferredLanguage(language: 'en' | 'pl' | null): Promise<void> {
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me/preferred-language',
      headers: { cookie: 'b2b_session=stub-admin-session' },
      payload: { preferredLanguage: language },
    });
    expect(res.statusCode).toBe(200);
  }

  async function missingProduct(): Promise<{ code: string; message: string }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/products/${randomUUID()}`,
      headers: { cookie: 'b2b_session=stub-admin-session' },
    });
    expect(res.statusCode).toBe(404);
    return (res.json() as { error: { code: string; message: string } }).error;
  }

  it('serves the English bundle sentence for the error code', async () => {
    await setPreferredLanguage('en');
    const error = await missingProduct();
    expect(error.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(error.message).toBe(sentence('en', 'errors.NOT_FOUND'));
  });

  it('does not serve the message the route threw', async () => {
    await setPreferredLanguage('en');
    const error = await missingProduct();
    // The route's own text names the entity; the bundle sentence is the generic
    // family one. They differ, and with no bundles installed the first is what
    // the client would get.
    expect(error.message).not.toMatch(/product/i);
  });

  it('serves a different sentence to an admin who reads Polish', async () => {
    await setPreferredLanguage('en');
    const english = await missingProduct();
    await setPreferredLanguage('pl');
    const polish = await missingProduct();

    expect(polish.code).toBe(ERROR_CODES.NOT_FOUND);
    expect(polish.message).toBe(sentence('pl', 'errors.NOT_FOUND'));
    // The load-bearing half: with an empty bundle table both requests return the
    // identical thrown string, and this is the assertion that says so.
    expect(polish.message).not.toBe(english.message);
  });
});
