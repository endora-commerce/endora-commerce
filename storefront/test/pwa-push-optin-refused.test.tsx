// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Issue #1027 — `no-misused-promises` found the opt-in's *Enable* handler
 * handing a Promise to `onClick`. When the browser refuses the subscription
 * (`pushManager.subscribe` rejects with `NotAllowedError` on a denied
 * permission), the rejection went unhandled and the prompt stayed up. A
 * refusal is the customer saying no, so it is remembered like *Not now*.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const subscribeToPush = vi.fn<(key: string) => Promise<boolean>>();
vi.mock('../lib/api/pwa', () => ({
  PUSH_DISMISS_KEY: 'b2b:pwa:push-dismissed',
  getPwaConfig: async () => ({ pushEnabled: true, vapidPublicKey: 'key' }),
  subscribeToPush: (key: string) => subscribeToPush(key),
}));

const { PushOptIn } = await import('../components/pwa/PushOptIn');

let host: HTMLElement | null = null;
let root: Root | null = null;
const storage = new Map<string, string>();

beforeEach(() => {
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  Object.defineProperty(window, 'PushManager', { value: function PushManager() {}, configurable: true });
  vi.stubGlobal('Notification', { permission: 'default' });
  storage.clear();
  // Node's own `localStorage` global shadows the DOM environment's, so the
  // component gets a plain one.
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
    configurable: true,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.unstubAllGlobals();
  subscribeToPush.mockReset();
});

async function renderPrompt(): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<PushOptIn locale="en-US" />));
  return host;
}

describe('PushOptIn — enabling', () => {
  it('treats a refused subscription as a dismissal instead of an unhandled rejection', async () => {
    subscribeToPush.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const view = await renderPrompt();
      const enable = view.querySelector<HTMLButtonElement>('[data-testid="pwa-push-optin"] button')!;
      await act(async () => enable.click());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(storage.get('b2b:pwa:push-dismissed') ?? null).toBe('1');
      expect(view.querySelector('[data-testid="pwa-push-optin"]')).toBeNull();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('hides the prompt once the subscription succeeds', async () => {
    subscribeToPush.mockResolvedValue(true);
    const view = await renderPrompt();
    const enable = view.querySelector<HTMLButtonElement>('[data-testid="pwa-push-optin"] button')!;
    await act(async () => enable.click());

    expect(view.querySelector('[data-testid="pwa-push-optin"]')).toBeNull();
    expect(storage.get('b2b:pwa:push-dismissed') ?? null).toBeNull();
  });
});
