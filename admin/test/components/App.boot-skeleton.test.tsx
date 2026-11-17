import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { MODULE_ADMIN_CONTRIBUTIONS } from '../../src/modules.generated.js';

/**
 * Issues #1431 (DS-01) and #1485 (SHELL-24) — the admin's cold boot.
 *
 * On every full page load the shell used to render before the operator's i18n
 * bundle and the module-presence projection had arrived: the navigation and the
 * content showed raw keys (`core.appShell.nav…`, `core.organizations.page.title`)
 * and a module route such as `/settings` showed `core.app.notFound`, because the
 * presence gate fails closed while unresolved.
 *
 * The shell now holds its routes behind a neutral skeleton until both have
 * settled. The two requests are driven by hand here — the bundle and the
 * presence answers are deferred — so the frame between "signed in" and
 * "everything loaded" is the subject, not something a fast stub skips past.
 */

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/useAdminActions', () => ({
  useAdminActions: () => ({ actions: [], loading: false }),
}));

vi.mock('../../../packages/admin-shell/src/lib/admin-actions/AdminActionsProvider', () => ({
  AdminActionsProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('../../../packages/admin-shell/src/components/notifications', () => ({
  NotificationBell: () => <span data-testid="notifications" />,
}));

vi.mock('../../../packages/admin-shell/src/components/LanguagePicker.js', () => ({
  LanguagePicker: () => <span data-testid="language-picker" />,
}));

vi.mock('../../../packages/admin-shell/src/components/IdleLogout', () => ({
  IdleLogout: () => null,
}));

vi.mock('../../../packages/admin-shell/src/lib/prompt-actions/api', () => ({
  getPromptCapability: vi.fn(async () => ({ status: 'disabled', bulkLimit: 0 })),
  listUnseenPromptRequests: vi.fn(async () => []),
  submitPrompt: vi.fn(),
  clarifyPrompt: vi.fn(),
  confirmPrompt: vi.fn(),
  cancelPrompt: vi.fn(),
  getPromptRequest: vi.fn(),
  markPromptRequestSeen: vi.fn(),
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async () => ({ data: [] })),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const { App } = await import('../../../packages/admin-shell/src/App');

const BUNDLES_PATH = '/api/v1/admin/i18n/bundles';
const PRESENCE_PATH = '/api/v1/admin/module-presence';

interface Pending {
  readonly path: string;
  readonly url: string;
  resolve(response: Response): void;
  reject(error: Error): void;
}

/** Every request the shell makes is parked here until the test answers it. */
let pending: Pending[] = [];
const setupFetch = globalThis.fetch;

beforeEach(() => {
  pending = [];
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://localhost').pathname;
    return new Promise<Response>((resolve, reject) => {
      pending.push({ path, url, resolve, reject });
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = setupFetch;
});

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Answer every parked request to `path`, inside `act` so React commits the result. */
async function answer(path: string, respond: (entry: Pending) => void): Promise<void> {
  await waitFor(() => expect(pending.some((p) => p.path === path)).toBe(true));
  await act(async () => {
    for (const entry of pending.filter((p) => p.path === path)) respond(entry);
    pending = pending.filter((p) => p.path !== path);
    await Promise.resolve();
  });
}

const BUNDLE = {
  core: {
    'app.notFound': 'Page not found',
    'app.moduleScreenLoading': 'Loading screen',
  },
};

async function answerBundles(): Promise<void> {
  await answer(BUNDLES_PATH, (entry) => {
    const language = new URL(entry.url, 'http://localhost').searchParams.get('language') ?? 'en';
    entry.resolve(json({ data: { language, version: 1, bundles: BUNDLE } }));
  });
}

function renderAt(
  path: string,
  options: { presence?: 'fetched' | 'seeded'; language?: 'en' | 'pl' } = {},
): void {
  const seeded = options.presence === 'seeded';
  render(
    withSession(
      <MemoryRouter initialEntries={[path]}>
        <App
          contributions={MODULE_ADMIN_CONTRIBUTIONS}
          {...(seeded ? { modulePresence: modulePresence({ present: ['settings'] }) } : {})}
        />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'], preferredLanguage: options.language ?? 'en' }),
      },
    ),
  );
}

const bootSkeleton = (): HTMLElement | null => screen.queryByTestId('admin-boot-skeleton');
const rawCoreKeyIsRendered = (): boolean => /\bcore\.[a-zA-Z]/.test(document.body.textContent ?? '');
const notFoundIsRendered = (): boolean =>
  /Page not found|app\.notFound/.test(document.body.textContent ?? '');

describe('the admin cold boot (issues #1431, #1485)', () => {
  it('renders a neutral, busy skeleton — no raw key, no not-found — while the bundle is in flight', async () => {
    renderAt('/does-not-exist', { presence: 'seeded' });

    const skeleton = bootSkeleton();
    expect(skeleton).not.toBeNull();
    expect(skeleton?.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('status', { name: 'Loading the admin panel…' })).toBeTruthy();
    expect(rawCoreKeyIsRendered()).toBe(false);
    expect(notFoundIsRendered()).toBe(false);

    await answerBundles();

    await waitFor(() => expect(bootSkeleton()).toBeNull());
    expect(screen.getByText('Page not found')).toBeTruthy();
  });

  it('names the skeleton in the operator’s own language', () => {
    renderAt('/', { presence: 'seeded', language: 'pl' });

    expect(screen.getByRole('status', { name: 'Ładowanie panelu administracyjnego…' })).toBeTruthy();
  });

  it('does not show not-found for a module route until the module presence has arrived', async () => {
    renderAt('/settings', { presence: 'fetched' });

    await answerBundles();
    // The bundle is in; presence is not. A fail-closed gate would say "not found" here.
    expect(bootSkeleton()).not.toBeNull();
    expect(notFoundIsRendered()).toBe(false);

    await answer(PRESENCE_PATH, (entry) =>
      entry.resolve(json(modulePresence({ present: ['settings'] }))),
    );

    await waitFor(() => expect(bootSkeleton()).toBeNull());
    expect(notFoundIsRendered()).toBe(false);
  });

  it('opens the shell rather than spinning forever when the bundle request fails', async () => {
    renderAt('/does-not-exist', { presence: 'seeded' });

    await answer(BUNDLES_PATH, (entry) => entry.reject(new TypeError('network down')));

    await waitFor(() => expect(bootSkeleton()).toBeNull());
  });
});
