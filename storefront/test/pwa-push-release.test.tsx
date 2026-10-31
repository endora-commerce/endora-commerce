import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  PUSH_DISMISS_KEY,
  pushToggleState,
  releasePushSubscription,
  turnOffPush,
  unsubscribeFromPush,
} from '../lib/api/pwa';
import { signOutReleasingPush } from '../components/account/SignOutButton';

/**
 * Issue #258 — signing out of the storefront releases the browser's push
 * subscription, and a customer has a visible way to turn notifications off.
 *
 * `unsubscribeFromPush()` existed and nothing called it, so a browser a
 * customer had signed out of stayed registered as their device and kept
 * receiving the notifications addressed to their account. The backend has
 * accepted the release from a signed-out browser since #254: the request
 * carries the subscription's own keys, which only the subscribing browser
 * holds.
 *
 * The storefront's tests are SSR-only (no DOM environment), so the browser
 * APIs below are stubbed at the global seam the helpers read — `navigator`,
 * `window` and `fetch` — and the components are asserted through the functions
 * they call and `renderToString`.
 */

interface FakeSubscription {
  endpoint: string;
  toJSON: () => { keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function fakeSubscription(): FakeSubscription {
  return {
    endpoint: 'https://push.example.test/send/abc',
    toJSON: () => ({ keys: { p256dh: 'p256dh-key', auth: 'auth-secret' } }),
    unsubscribe: vi.fn(async () => true),
  };
}

/**
 * A browser with push support. `registration` is what `getRegistration()`
 * answers — `undefined` is a page no service worker was registered for, which
 * is every development build (`PwaRegister` skips registration there).
 */
function stubBrowser(options: {
  registration?: { pushManager: { getSubscription: () => Promise<FakeSubscription | null> } } | undefined;
  fetchImpl?: (...args: unknown[]) => Promise<Response>;
}): { fetchSpy: ReturnType<typeof vi.fn>; storage: Map<string, string> } {
  const storage = new Map<string, string>();
  vi.stubGlobal('window', {
    PushManager: function PushManager() {},
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  vi.stubGlobal('navigator', {
    userAgent: 'test',
    serviceWorker: {
      getRegistration: vi.fn(async () => options.registration),
      // A promise that never settles: a helper still waiting on it hangs the
      // sign-out, and the test times out instead of passing.
      ready: new Promise(() => {}),
    },
  });
  const fetchSpy = vi.fn(options.fetchImpl ?? (async () => new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchSpy);
  return { fetchSpy, storage };
}

function registrationWith(subscription: FakeSubscription | null) {
  return { pushManager: { getSubscription: async () => subscription } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unsubscribeFromPush', () => {
  it('returns at once on a page no service worker was registered for', async () => {
    const { fetchSpy } = stubBrowser({ registration: undefined });

    await expect(unsubscribeFromPush()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('asks the server to forget the subscription with its own keys, then unsubscribes the browser', async () => {
    const subscription = fakeSubscription();
    const { fetchSpy } = stubBrowser({ registration: registrationWith(subscription) });

    await unsubscribeFromPush();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/pwa/subscriptions');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(String(init.body))).toEqual({
      endpoint: 'https://push.example.test/send/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    });
    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes the browser even when the server cannot be reached', async () => {
    const subscription = fakeSubscription();
    stubBrowser({
      registration: registrationWith(subscription),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(unsubscribeFromPush()).rejects.toThrow('Failed to fetch');
    expect(
      subscription.unsubscribe,
      'a browser that stays subscribed keeps receiving the account\'s notifications',
    ).toHaveBeenCalledTimes(1);
  });
});

describe('releasePushSubscription — the sign-out half', () => {
  it('never throws, so a failure cannot stand between a customer and signing out', async () => {
    stubBrowser({
      registration: registrationWith(fakeSubscription()),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    await expect(releasePushSubscription()).resolves.toBeUndefined();
  });

  it('is a no-op in a browser without push support', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', { userAgent: 'test' });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await expect(releasePushSubscription()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('signing out', () => {
  it('releases the push subscription before the session ends', async () => {
    const subscription = fakeSubscription();
    const { fetchSpy } = stubBrowser({ registration: registrationWith(subscription) });
    const order: string[] = [];
    fetchSpy.mockImplementation(async () => {
      order.push('release');
      return new Response(null, { status: 204 });
    });
    const signOut = vi.fn(async () => {
      order.push('sign-out');
    });

    await signOutReleasingPush(signOut)();

    expect(order).toEqual(['release', 'sign-out']);
  });

  it('still signs out when the release fails', async () => {
    stubBrowser({
      registration: registrationWith(fakeSubscription()),
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const signOut = vi.fn(async () => {});

    await signOutReleasingPush(signOut)();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('renders the same Sign out button the account sidebar always had', async () => {
    const { SignOutButton } = await import('../components/account/SignOutButton');
    const html = renderToString(<SignOutButton signOut={async () => {}} locale="en-US" />);

    expect(html).toContain('b2b-account__logout');
    expect(html).toContain('Sign out');
  });

  it('captions the button in the page language it is given (issue #85)', async () => {
    const { SignOutButton } = await import('../components/account/SignOutButton');
    expect(renderToString(<SignOutButton signOut={async () => {}} locale="en-US" />)).toContain('Sign out');
    expect(renderToString(<SignOutButton signOut={async () => {}} locale="pl-PL" />)).toContain('Wyloguj się');
    expect(
      renderToString(<SignOutButton signOut={async () => {}} locale="pl-PL" label="Log out" />),
    ).toContain('Log out');
  });
});

describe('turning notifications off by hand', () => {
  it('releases the subscription and stops the opt-in prompt from asking again', async () => {
    const subscription = fakeSubscription();
    const { storage } = stubBrowser({ registration: registrationWith(subscription) });

    await turnOffPush();

    expect(subscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(storage.get(PUSH_DISMISS_KEY)).toBe('1');
  });
});

describe('pushToggleState — what the control offers', () => {
  it.each([
    [{ supported: false, pushEnabled: true, subscribed: false, permission: 'default' }, 'hidden'],
    [{ supported: true, pushEnabled: false, subscribed: false, permission: 'default' }, 'hidden'],
    // A subscription left over from before the channel switched push off can
    // still be turned off — that is the point of the control.
    [{ supported: true, pushEnabled: false, subscribed: true, permission: 'granted' }, 'on'],
    [{ supported: true, pushEnabled: true, subscribed: true, permission: 'granted' }, 'on'],
    [{ supported: true, pushEnabled: true, subscribed: false, permission: 'default' }, 'off'],
    [{ supported: true, pushEnabled: true, subscribed: false, permission: 'granted' }, 'off'],
    [{ supported: true, pushEnabled: true, subscribed: false, permission: 'denied' }, 'blocked'],
  ] as const)('%o → %s', (input, expected) => {
    expect(pushToggleState(input)).toBe(expected);
  });
});

describe('PushNotificationsToggle', () => {
  it('renders nothing on the server, where the device state is unknown', async () => {
    const { PushNotificationsToggle } = await import('../components/pwa/PushNotificationsToggle');

    // Its copy arrives from the page since `specs/149-pwa-order-status-push/`.
    const messages = {
      heading: 'h',
      on: 'on',
      off: 'off',
      blocked: 'blocked',
      turnOn: 'turn on',
      turnOff: 'turn off',
    };
    expect(renderToString(<PushNotificationsToggle messages={messages} />)).toBe('');
  });
});
