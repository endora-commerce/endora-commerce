import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The quick-order preview is the buyer's uploaded data, so it ends with the session (issue #790).
 * Since issue #809 the backend keeps it, bound to the session: signing out asks the backend to
 * drop it while the session can still name it, and only then ends the session. An expired session
 * can no longer name it, so the backend's TTL ends it; no storefront cookie holds it either way.
 */

const cookieStore = vi.hoisted(() => new Map<string, string>());
const events = vi.hoisted(() => [] as string[]);
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { name, value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieStore.set(name, value),
    delete: (name: string) => void cookieStore.delete(name),
  }),
}));
vi.mock('../../lib/api/auth', () => ({
  logoutCustomer: async (session: string | null) => void events.push(`logout ${session}`),
}));
let dropFails = false;
vi.mock('../../lib/api/quick-order-preview', () => ({
  clearQuickOrderPreview: async (session: string) => {
    events.push(`drop preview ${session}`);
    if (dropFails) throw new Error('fetch failed');
  },
}));
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
  events.length = 0;
  dropFails = false;
  cookieStore.set('b2b_session', 'session-cookie');
});

describe('the quick-order preview ends with the session (issues #790, #809)', () => {
  it('sign-out drops it on the backend before the session ends', async () => {
    await expect(signOutAction()).rejects.toThrow('redirect /login');
    expect(events).toEqual(['drop preview session-cookie', 'logout session-cookie']);
    expect(cookieStore.has('b2b_session')).toBe(false);
  });

  it('sign-out still signs out when the backend cannot drop it', async () => {
    dropFails = true;
    await expect(signOutAction()).rejects.toThrow('redirect /login');
    expect(events).toContain('logout session-cookie');
    expect(cookieStore.has('b2b_session')).toBe(false);
  });

  it('an expired session asks nothing of the backend — the preview expires there', async () => {
    const response = await sessionExpired(new NextRequest('http://shop.test/session-expired?next=/quick-order'));
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(events).toEqual([]);
    expect(cookieStore.has('b2b_session')).toBe(false);
  });
});
