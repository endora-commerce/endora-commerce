import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PwaAdminConfig } from '@endora-commerce/contracts';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';
import { shippedCoreBundle, shippedModuleBundle } from '../helpers/core-bundle';
import { orphanLabels } from '../helpers/orphan-labels';

/**
 * Issue #1463 (UX audit CONTENT-05) — the PWA screen and its push audience
 * builder rendered every card title, field, option and status line in English
 * whatever language the operator chose, and listed the display modes by their
 * manifest codes (`minimal-ui`). The screen now reads `pwa`'s bundle, in both
 * shipped languages, and the rule builder's icon buttons carry a name rather
 * than a tooltip alone.
 */

const CONFIG: PwaAdminConfig = {
  salesChannelId: null,
  appName: 'Shop',
  shortName: 'Shop',
  themeColor: '#1d4ed8',
  backgroundColor: '#fafafa',
  displayMode: 'minimal-ui',
  iconAssetId: '',
  cachingEnabled: false,
  pushEnabled: true,
  vapidPublicKey: 'BPUB',
  vapidPrivateKeyIsSet: true,
  fcmServiceAccountIsSet: false,
  orderStatusPushEnabled: true,
  quoteStatusPushEnabled: true,
};

const get = vi.fn(async (url: string): Promise<unknown> => {
  if (url.startsWith('/api/v1/admin/pwa/config')) return CONFIG;
  if (url.startsWith('/api/v1/admin/pwa/subscriptions')) return { active: 3, invalid: 1 };
  if (url.startsWith('/api/v1/admin/pwa/rule-targets/sales-channels')) return { data: { items: [] } };
  if (url.startsWith('/api/v1/admin/sales-channels')) return { items: [], total: 0, page: 1, pageSize: 200 };
  throw new Error(`unexpected GET ${url}`);
});

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: { get: (url: string) => get(url), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { PwaPage } = await import('../../../packages/modules/pwa/src/admin/pages/PwaPage');

afterEach(() => cleanup());

describe.each(['en', 'pl'] as const)('PWA screen in %s (#1463)', (language) => {
  const own = shippedModuleBundle('pwa', language).pwa as Record<string, string>;
  const key = (k: string): string => {
    const value = own[k];
    if (!value) throw new Error(`pwa/i18n/${language}.json carries no "${k}"`);
    return value;
  };

  beforeEach(() => {
    get.mockClear();
  });

  async function mount(): Promise<void> {
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
      { ...shippedModuleBundle('pwa', language), ...shippedCoreBundle(language) },
      { language },
    );
    await screen.findByRole('textbox', { name: key('settings.field.appName') });
  }

  it('titles the screen and its cards, and labels every field', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1, name: key('settings.title') })).toBeInTheDocument();
    expect(screen.getByText(key('settings.section.identity'))).toBeInTheDocument();
    expect(screen.getByText(key('settings.section.capabilities'))).toBeInTheDocument();
    expect(screen.getByText(key('push.title'))).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('settings.field.shortName') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('push.field.title') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('push.field.body') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('push.field.url') })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: key('settings.field.cachingEnabled') })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: key('settings.field.pushEnabled') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('settings.vapid.generate') })).toBeInTheDocument();
    expect(screen.getByText(key('settings.vapid.set'))).toBeInTheDocument();
    expect(orphanLabels(document.body)).toEqual([]);
  });

  it('names the scope and the display modes instead of printing their codes', async () => {
    await mount();
    const scope = screen.getByRole('combobox', { name: key('settings.scope') });
    expect(within(scope).getByRole('option', { name: key('settings.channel.global') })).toBeInTheDocument();
    const display = screen.getByRole('combobox', { name: key('settings.field.displayMode') });
    expect(display).toHaveValue('minimal-ui');
    expect(within(display).getByRole('option', { name: key('settings.displayMode.minimal-ui') })).toBeInTheDocument();
    expect(within(display).queryByRole('option', { name: 'minimal-ui' })).toBeNull();
  });

  it('reads the audience builder in the operator’s language', async () => {
    await mount();
    const audience = screen.getByRole('radiogroup', { name: key('push.field.audience') });
    fireEvent.click(within(audience).getByRole('radio', { name: key('push.audience.rule') }));
    expect(screen.getByText(key('audience.empty'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: key('audience.addCriterion') }));
    const type = await screen.findByRole('combobox', { name: key('audience.criterionType') });
    expect(within(type).getByRole('option', { name: key('audience.criterion.salesChannel') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('audience.removeCriterion') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: key('audience.moveUp') })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/v1/admin/pwa/rule-targets/sales-channels'));
    expect(
      screen.getByRole('button', { name: key('push.sendTargeted') }),
    ).toBeInTheDocument();
  });
});
