import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { PwaAdminConfig } from '@endora-commerce/contracts';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { answerConfirm } from '../helpers/confirm-dialog';
import { installOffsetParentShim } from '../helpers/layout-shim';

/**
 * Issue #1462 (UX audit CONTENT-04) — "Send to all subscribers" pushed to
 * every device on one click. It now asks first, naming the notification and
 * the number of subscribed devices, and keeps a failed send's error in the
 * dialog. Real `pwa` bundles, so the copy and its plural forms are what ships.
 */

installOffsetParentShim();

const CHANNEL = '22222222-2222-4222-8222-222222222222';
const CONFIG: PwaAdminConfig = {
  salesChannelId: CHANNEL,
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

let active = 1240;
const post = vi.fn();
const get = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/api/v1/admin/pwa/config')) return CONFIG;
  if (url.startsWith('/api/v1/admin/pwa/subscriptions')) return { active, invalid: 0 };
  if (url.startsWith('/api/v1/admin/sales-channels')) {
    return { items: [{ id: CHANNEL, code: 'b2b', name: { en: 'B2B' } }], total: 1, page: 1, pageSize: 200 };
  }
  throw new Error(`unexpected GET ${url}`);
});

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (url: string) => get(url),
      put: vi.fn(),
      post: (url: string, body: unknown) => post(url, body),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

function bundle(language: 'en' | 'pl'): Record<string, Record<string, string>> {
  const read = (path: string): Record<string, string> =>
    JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as Record<string, string>;
  return {
    pwa: read(`../packages/modules/pwa/i18n/${language}.json`),
    core: read(`../packages/modules/_i18n/i18n/${language}.json`),
  };
}

async function mountAndCompose(language: 'en' | 'pl' = 'en'): Promise<void> {
  const { PwaPage } = await import('../../../packages/modules/pwa/src/admin/pages/PwaPage');
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/settings/pwa']}>
        <PwaPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['pwa:read', 'pwa:write', 'pwa:send_push'] }),
        presence: modulePresence({ present: ['pwa'] }),
      },
    ),
    bundle(language),
    { language },
  );
  const copy = bundle(language).pwa!;
  const scope = await screen.findByRole('combobox', { name: copy['settings.scope']! });
  await screen.findByRole('option', { name: /B2B/ });
  fireEvent.change(scope, { target: { value: CHANNEL } });
  await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringContaining(`subscriptions?salesChannelId=${CHANNEL}`)));
  fireEvent.change(await screen.findByRole('textbox', { name: copy['push.field.title']! }), { target: { value: 'Winter sale' } });
  fireEvent.change(screen.getByRole('textbox', { name: copy['push.field.body']! }), { target: { value: 'Prices drop tonight' } });
}

function sendButton(): HTMLElement {
  return screen.getByRole('button', { name: /Send to all subscribers|Wyślij do wszystkich subskrybentów/ });
}

describe('PWA screen — a push send asks first (#1462)', () => {
  beforeEach(() => {
    active = 1240;
    post.mockReset();
    get.mockClear();
  });

  it('names the notification and the device count, opens on Cancel, and Cancel sends nothing', async () => {
    await mountAndCompose();
    await userEvent.click(sendButton());

    const dialog = await screen.findByRole('dialog', { name: 'Send this push notification?' });
    expect(dialog).toHaveTextContent('“Winter sale” will be pushed to 1,240 subscribed devices on this sales channel.');
    expect(within(dialog).getByRole('button', { name: 'Send to 1,240 devices' })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button')[0]).toHaveFocus();

    await answerConfirm(false);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(post).not.toHaveBeenCalled();
  });

  it('sends on confirm and closes', async () => {
    post.mockResolvedValue({ queuedDeliveries: 1240 });
    await mountAndCompose();
    await userEvent.click(sendButton());
    await answerConfirm(true);

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/admin/pwa/messages', expect.objectContaining({ title: 'Winter sale', audience: { kind: 'all' } })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  // Issue #1499 (UX audit SALES-17, DEC-12 a): the queued count is said beside
  // Send, in a region mounted before it has text, and not as a success banner
  // at the top of the page; Save says "Settings saved" beside Save the same way.
  it('says the queued count beside Send and "saved" beside Save, with no success banner', async () => {
    post.mockResolvedValue({ queuedDeliveries: 1240 });
    await mountAndCompose();
    const sendRegion = within(sendButton().parentElement!).getByRole('status');
    expect(sendRegion.textContent).toBe('');
    await userEvent.click(sendButton());
    await answerConfirm(true);
    await waitFor(() => expect(sendRegion).toHaveTextContent('Queued 1,240 notifications.'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();

    const save = screen.getByRole('button', { name: 'Save' });
    const saveRegion = within(save.parentElement!).getByRole('status');
    fireEvent.click(save);
    await waitFor(() => expect(saveRegion).toHaveTextContent('Settings saved.'));
    // The earlier result is not left standing beside Send.
    expect(sendRegion.textContent).toBe('');
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('keeps a failed send in the dialog', async () => {
    post.mockRejectedValue(new Error('offline'));
    await mountAndCompose();
    await userEvent.click(sendButton());
    await answerConfirm(true);

    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The notification could not be sent');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('uses the Polish plural forms', async () => {
    active = 3;
    await mountAndCompose('pl');
    await userEvent.click(sendButton());

    const dialog = await screen.findByRole('dialog', { name: 'Wysłać to powiadomienie push?' });
    expect(dialog).toHaveTextContent('trafi do 3 subskrybowanych urządzeń');
    expect(within(dialog).getByRole('button', { name: 'Wyślij na 3 urządzenia' })).toBeInTheDocument();
  });
});
