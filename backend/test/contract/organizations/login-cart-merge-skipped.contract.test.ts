import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * The sign-in merge skipped for permission (`specs/170-organization-roles/`
 * WP-03, T128; owner ruling PR-12; research R-35; FR-030a).
 *
 * When the member's role lacks `carts.create`, `carts` does not merge the guest
 * basket and answers the internal outcome `skipped_permission` (WP-01 declares
 * the value, WP-04 raises it). The login route answers it as `noop` — nothing
 * changed in the member's own basket, so no merge toast — and **keeps** the
 * `b2b_cart_anon` cookie, as it does for `noop_no_anon`: the guest basket is
 * still there, unmerged and unchanged. The login itself succeeds.
 *
 * The hook's answer is stubbed here so this file does not depend on WP-04.
 */

function setCookies(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function clearsAnonCookie(raw: string | string[] | undefined): boolean {
  return setCookies(raw).some((h) => /b2b_cart_anon=;/.test(h) && /(Max-Age=0|Expires=Thu, 01 Jan 1970)/i.test(h));
}

describe('POST /api/v1/auth/customer/login — merge skipped for permission (PR-12)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers 200 with cartMerge.outcome = "noop" and keeps the b2b_cart_anon cookie', async () => {
    const cartService = h.cartService();
    expect(cartService).not.toBeNull();
    const destinationCartId = randomUUID();
    const spy = vi.spyOn(cartService!, 'mergeAnonymousIntoCustomer').mockResolvedValueOnce({
      outcome: 'skipped_permission',
      movedLineCount: 0,
      summedLineCount: 0,
      destinationCartId,
    });
    try {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/login',
        payload: { email: 'stub-customer-empty@example.com', password: STUB_CUSTOMER_PASSWORD },
        cookies: { b2b_cart_anon: `anon-skipped-${Date.now()}` },
      });
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as { data: { cartMerge?: { outcome: string; destinationCartId: string } | null } };
      expect(body.data.cartMerge).toEqual({ outcome: 'noop', destinationCartId });
      expect(clearsAnonCookie(res.headers['set-cookie']), 'the guest basket is still there; its cookie stays').toBe(false);
      expect(spy).toHaveBeenCalledOnce();
    } finally {
      spy.mockRestore();
    }
  });
});
