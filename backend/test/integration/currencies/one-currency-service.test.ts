import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Two admin surfaces write the `currencies` table; only one invalidated the
 * caches (feature 072, wave 1).
 *
 * This is the "two live instances of one service" defect the module census
 * predicted, caught in the wild with a consequence:
 *
 *  - `dictionaries` builds `new CurrencyService(emFactory, invalidateDictionaryState, auditLog)`
 *    and serves `/api/v1/admin/dictionary/currencies/*`.
 *  - `languages` builds `new CurrencyService(emFactory, undefined, auditLog)`
 *    and serves `/api/v1/admin/currencies/*`.
 *
 * Same table, same service class, different constructor arguments — so a write
 * through the second surface skips `validator.invalidate()` and the dictionary
 * cache drop that the identical write through the first surface performs. The
 * validator then keeps accepting a currency code whose row is gone, which is
 * the failure that matters: it is a **stale accept**, not a stale read, so the
 * next write referencing that code succeeds validation and lands a dangling
 * reference.
 *
 * The property pinned here is behavioural rather than structural on purpose. It
 * would also be true to assert "both surfaces resolve the same instance", but
 * that asserts the fix rather than the requirement — the requirement is that a
 * currency deleted anywhere stops validating everywhere.
 */

let h: BackendServerHandle;
const admin = { b2b_admin_session: 'stub-admin-session' };

const CODE = 'XTS';

beforeAll(async () => {
  h = await setupBackendServer({ seed: 'none' });
}, 120_000);

afterAll(async () => {
  await teardownBackendServer(h);
});

async function createCurrency(): Promise<void> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/dictionary/currencies',
    cookies: admin,
    payload: { code: CODE, label: 'Test currency', symbol: 'T', decimalPlaces: 2 },
  });
  expect([200, 201]).toContain(res.statusCode);
}

describe('a currency write through either admin surface invalidates the same caches', () => {
  it('stops validating a code deleted through /api/v1/admin/currencies', async () => {
    await createCurrency();

    // Warm the validator's cache through the path production warms it: a
    // successful validation of the live code.
    await expect(
      h.dictionaries.validator.validateCurrencyCode(CODE, 'create-or-change'),
    ).resolves.toBeUndefined();

    // Delete through the OTHER surface — the one whose service was built
    // without the invalidator.
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/currencies/${CODE}`,
      cookies: admin,
    });
    expect(del.statusCode).toBe(204);

    // The row is gone, so validation must fail. Before the conversion this
    // resolved: the validator was still answering from a cache nothing had
    // told it to drop.
    await expect(
      h.dictionaries.validator.validateCurrencyCode(CODE, 'create-or-change'),
    ).rejects.toThrow();
  });

  it('stops validating a code deleted through /api/v1/admin/dictionary/currencies', async () => {
    // The control case: the surface that always invalidated. It must keep
    // working, so the fix is not "make both wrong in the same way".
    await createCurrency();
    await expect(
      h.dictionaries.validator.validateCurrencyCode(CODE, 'create-or-change'),
    ).resolves.toBeUndefined();

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/dictionary/currencies/${CODE}`,
      cookies: admin,
    });
    expect(del.statusCode).toBe(204);

    await expect(
      h.dictionaries.validator.validateCurrencyCode(CODE, 'create-or-change'),
    ).rejects.toThrow();
  });
});
