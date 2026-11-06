import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Issue #790 (architect ruling on PR #805) — the quick-order preview is the buyer's uploaded
 * data in a cookie, so it ends with the session: signing out and an expired session both clear
 * it, not only the session cookie beside it.
 */

const cookieStore = vi.hoisted(() => new Map<string, string>());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}));
vi.mock('../../lib/api/auth', () => ({ logoutCustomer: async () => undefined }));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
  localizedPath: async (path: string) => path,
}));

const { signOutAction } = await import('../../lib/actions/sign-out');
const { GET: sessionExpired } = await import('../../app/(auth)/session-expired/route');

beforeEach(() => {
  cookieStore.clear();
  cookieStore.set('b2b_session', 'session-cookie');
  cookieStore.set('b2b_quick_order_preview', 'a-preview');
});

describe('the quick-order preview ends with the session (issue #790)', () => {
  it('sign-out clears it', async () => {
    await expect(signOutAction()).rejects.toThrow('redirect /login');
    expect(cookieStore.has('b2b_session')).toBe(false);
    expect(cookieStore.has('b2b_quick_order_preview')).toBe(false);
  });

  it('an expired session clears it', async () => {
    const response = await sessionExpired(new NextRequest('http://shop.test/session-expired?next=/quick-order'));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(cookieStore.has('b2b_session')).toBe(false);
    expect(cookieStore.has('b2b_quick_order_preview')).toBe(false);
  });
});
