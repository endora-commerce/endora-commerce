import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorefrontApiError } from '../../lib/api/client';

/**
 * `specs/179-rfq-and-customer-notifications/` T082 — the two server actions of
 * `/account/notifications` (FR-050a, FR-050b, FR-051a).
 *
 * Each revalidates the root layout, so the account entry's count re-renders in
 * the same response, and answers with a redirect back to the page: `?marked=all`
 * after *Mark all as read* (the status region's message), `?markError=1` on a
 * failure — the `pushSaved` / `pushError` pattern of the profile page.
 */

const revalidated: Array<[string, string | undefined]> = [];
vi.mock('next/cache', () => ({
  revalidatePath: (path: string, type?: string) => {
    revalidated.push([path, type]);
  },
}));
let session: string | null = 'session-cookie';
vi.mock('../../lib/session', () => ({
  getSessionCookie: async () => session,
  getAnonCartCookie: async () => undefined,
}));
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale: 'en-US', ctx: { locale: 'en-US' } }),
}));
vi.mock('../../lib/i18n/navigation', () => ({
  localeRedirect: async (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));

const calls: string[] = [];
let failure: unknown = null;
vi.mock('../../lib/api/customer-notifications', () => ({
  markCustomerNotificationRead: async (_s: string, _ctx: unknown, id: string) => {
    calls.push(`read ${id}`);
    if (failure) throw failure;
  },
  markAllCustomerNotificationsRead: async () => {
    calls.push('read-all');
    if (failure) throw failure;
    return 2;
  },
}));

const { markReadAction, markAllReadAction } = await import('../../app/(account)/account/notifications/actions');

const ID = '00000000-0000-4000-8000-000000000001';

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Error);
  const match = /^redirect (.*)$/.exec((err as Error).message);
  expect(match, (err as Error).message).not.toBeNull();
  return match![1]!;
}

beforeEach(() => {
  calls.length = 0;
  revalidated.length = 0;
  failure = null;
  session = 'session-cookie';
});

describe('markReadAction', () => {
  it('marks the entry, revalidates the layout and returns to the same page', async () => {
    const to = await redirectOf(markReadAction(form({ id: ID, cursor: 'abc' })));
    expect(calls).toEqual([`read ${ID}`]);
    expect(revalidated).toEqual([['/', 'layout']]);
    expect(to).toBe('/account/notifications?cursor=abc');
  });

  it('returns to the first page when it was there', async () => {
    expect(await redirectOf(markReadAction(form({ id: ID })))).toBe('/account/notifications');
  });

  it('redirects with markError=1 on a failure', async () => {
    failure = new StorefrontApiError(404, 'NOT_FOUND', 'Notification not found.');
    const to = await redirectOf(markReadAction(form({ id: ID })));
    expect(to).toBe('/account/notifications?markError=1');
  });

  it('sends a signed-out visitor to sign in', async () => {
    session = null;
    expect(await redirectOf(markReadAction(form({ id: ID })))).toBe('/login?next=/account/notifications');
    expect(calls).toEqual([]);
  });
});

describe('markAllReadAction', () => {
  it('marks everything, revalidates the layout and says so on the first page', async () => {
    const to = await redirectOf(markAllReadAction(form({ cursor: 'abc' })));
    expect(calls).toEqual(['read-all']);
    expect(revalidated).toEqual([['/', 'layout']]);
    expect(to).toBe('/account/notifications?marked=all');
  });

  it('redirects with markError=1 on a failure, still revalidating', async () => {
    failure = new Error('network');
    const to = await redirectOf(markAllReadAction(form({})));
    expect(to).toBe('/account/notifications?markError=1');
    expect(revalidated).toEqual([['/', 'layout']]);
  });
});
