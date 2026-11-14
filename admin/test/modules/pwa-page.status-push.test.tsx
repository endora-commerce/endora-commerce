import { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PwaAdminConfig } from '@endora-commerce/contracts';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * `specs/149-pwa-order-status-push/` T019 — the two status push category
 * switches on the PWA screen (contract `admin-pwa-config.md`).
 *
 * A file of its own rather than a block in `pwa.module-owned-surface.test.tsx`:
 * that file mounts the whole `App`, and this one replaces `apiClient` for the
 * whole file — a mock that would otherwise reach every screen the App mounts.
 */

const BASE_CONFIG: PwaAdminConfig = {
  salesChannelId: null,
  appName: 'Shop',
  shortName: 'Shop',
  themeColor: '#1d4ed8',
  backgroundColor: '#fafafa',
  displayMode: 'standalone',
  iconAssetId: '',
  cachingEnabled: false,
  pushEnabled: true,
  vapidPublicKey: 'BPUB',
  vapidPrivateKeyIsSet: true,
  fcmServiceAccountIsSet: false,
  orderStatusPushEnabled: true,
  quoteStatusPushEnabled: true,
};

let config: PwaAdminConfig = BASE_CONFIG;
const put = vi.fn(async (_url: string, _body: unknown) => ({ updated: 1 }));
const get = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/api/v1/admin/pwa/config')) return config;
  if (url.startsWith('/api/v1/admin/pwa/subscriptions')) return { active: 0, invalid: 0 };
  if (url.startsWith('/api/v1/admin/sales-channels')) return { items: [], total: 0, page: 1, pageSize: 200 };
  throw new Error(`unexpected GET ${url}`);
});

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (url: string) => get(url),
      put: (url: string, body: unknown) => put(url, body),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const raw = readFileSync(
    resolve(process.cwd(), `../packages/modules/pwa/i18n/${language}.json`),
    'utf8',
  );
  return { pwa: JSON.parse(raw) as Record<string, string> };
}

async function mount(options: { present: string[]; language?: 'en' | 'pl' }): Promise<void> {
  const { PwaPage } = await import('../../../packages/modules/pwa/src/admin/pages/PwaPage');
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/settings/pwa']}>
          <PwaPage />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['pwa:read', 'pwa:write'] }),
          presence: modulePresence({ present: options.present }),
        },
      )}
    </StrictMode>,
    bundle(options.language ?? 'en'),
  );
  await waitFor(() => expect(screen.getByText('Capabilities')).toBeInTheDocument());
}

const ORDER = /Notify on order status changes/;
const QUOTE = /Notify on quote status changes/;

describe('PWA screen — status push category switches', () => {
  beforeEach(() => {
    config = BASE_CONFIG;
    get.mockClear();
    put.mockClear();
  });

  it('renders both switches under push, reflecting the scope’s values', async () => {
    config = { ...BASE_CONFIG, quoteStatusPushEnabled: false };
    await mount({ present: ['pwa', 'quote_requests'] });

    const order = await screen.findByRole('checkbox', { name: ORDER });
    const quote = screen.getByRole('checkbox', { name: QUOTE });
    expect(order).toBeChecked();
    expect(quote).not.toBeChecked();
    expect(order).toBeEnabled();
    expect(quote).toBeEnabled();
    expect(
      screen.getByText(/Sent automatically to subscribed devices: order updates to the customer who placed the order/),
    ).toBeInTheDocument();
  });

  it('disables both while push is off for the scope', async () => {
    config = { ...BASE_CONFIG, pushEnabled: false };
    await mount({ present: ['pwa', 'quote_requests'] });

    expect(await screen.findByRole('checkbox', { name: ORDER })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: QUOTE })).toBeDisabled();
  });

  it('does not offer the quote switch while quote_requests is absent', async () => {
    await mount({ present: ['pwa'] });

    expect(await screen.findByRole('checkbox', { name: ORDER })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: QUOTE })).not.toBeInTheDocument();
  });

  it('saves the switches with the card’s Save', async () => {
    await mount({ present: ['pwa', 'quote_requests'] });

    fireEvent.click(await screen.findByRole('checkbox', { name: ORDER }));
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![0]).toBe('/api/v1/admin/pwa/config');
    expect(put.mock.calls[0]![1]).toMatchObject({
      orderStatusPushEnabled: false,
      quoteStatusPushEnabled: true,
    });
  });

  it('does not send the quote switch it did not offer', async () => {
    await mount({ present: ['pwa'] });

    await screen.findByRole('checkbox', { name: ORDER });
    fireEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).not.toHaveProperty('quoteStatusPushEnabled');
  });

  it('labels the switches in Polish', async () => {
    await mount({ present: ['pwa', 'quote_requests'], language: 'pl' });

    expect(
      await screen.findByRole('checkbox', { name: /Powiadamiaj o zmianach statusu zamówienia/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: /Powiadamiaj o zmianach statusu zapytań ofertowych/ }),
    ).toBeInTheDocument();
  });
});
