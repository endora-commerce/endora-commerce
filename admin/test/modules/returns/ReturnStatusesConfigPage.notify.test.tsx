import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * `specs/180-off-platform-complaints/` T028 (FR-A30, FR-A32, FR-A33, D-2, D-7;
 * design review R-6): the *e-mail the customer on entry* toggle on the status
 * configuration screen, and the "no recipient" alert above it.
 */

installOffsetParentShim();

// ECharts needs a real canvas, which jsdom has not (see `OrderStatusConfigPage.test.tsx`):
// the transition graph below the table is not this test's subject.
vi.mock('echarts', () => {
  const chart = { setOption: (): void => {}, resize: (): void => {}, dispose: (): void => {}, on: (): void => {}, off: (): void => {}, dispatchAction: (): void => {} };
  return { init: () => chart, default: { init: () => chart } };
});

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnStatusesConfigPage } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage'
);

const status = (code: string, over: Record<string, unknown> = {}) => ({
  code,
  // The screen names a status by `name[language]` first (#1472), so the fixture's English name is its label.
  name: { en: code[0]!.toUpperCase() + code.slice(1) },
  defaultName: code[0]!.toUpperCase() + code.slice(1),
  isInitial: false,
  isTerminal: false,
  isSystem: true,
  weight: 10,
  color: '#64748b',
  notifyCustomerOnEntry: false,
  inUseCount: 0,
  ...over,
});

const GRAPH = {
  statuses: [
    status('new', { isInitial: true }),
    status('authorized'),
    status('received', { notifyCustomerOnEntry: true }),
    status('rejected', { isTerminal: true }),
  ],
  transitions: [],
};

const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';

const BUNDLE = {
  returns: {
    'statusConfig.notifyColumn': 'E-mail customer on entry',
    'statusConfig.notifyLabel': 'E-mail customer on entry: {status}',
    'statusConfig.notifyDedicated': 'Has its own e-mail',
    'statusConfig.notifyInitialHint': 'Not sent when a case is filed; the confirmation e-mail covers that',
    'statusConfig.notifyExistingHint': "Turning this on doesn't e-mail cases already in that status",
    'statusConfig.recipientsMissing.channels': 'New-case e-mails go to nobody: no recipient is configured for {channels}.',
    'statusConfig.recipientsMissing.any': 'New-case e-mails go to nobody: no recipient is configured for any channel.',
    'statusConfig.recipientsMissing.link': 'Configure recipients',
  },
};

let health: { recipientsMissing: { global: boolean; salesChannelIds: string[] } };

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  health = { recipientsMissing: { global: false, salesChannelIds: [CHANNEL_ID] } };
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: GRAPH });
    if (path === '/api/v1/admin/returns/notification-health') return Promise.resolve({ data: health });
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: CHANNEL_ID, code: 'pl_retail', name: { en: 'Polish retail' } }], page: 1, pageSize: 100, total: 1 });
    }
    return Promise.resolve({ data: [] });
  });
  api.patch.mockResolvedValue({ data: GRAPH });
});

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter>
      <ReturnStatusesConfigPage />
    </MemoryRouter>,
    BUNDLE,
  );
}

const toggle = (name: string) => screen.findByRole('checkbox', { name: `E-mail customer on entry: ${name}` });

describe('ReturnStatusesConfigPage — notify the customer on entry (180 T028)', () => {
  it('offers the toggle per status, checked as stored, under its own column', async () => {
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'E-mail customer on entry' })).toBeInTheDocument();
    expect(await toggle('Received')).toBeChecked();
    expect(await toggle('New')).not.toBeChecked();
  });

  it('is disabled on Authorized and Rejected, with the reason beside it', async () => {
    renderPage();
    for (const name of ['Authorized', 'Rejected']) {
      const box = await toggle(name);
      expect(box).toBeDisabled();
      const row = box.closest('tr')!;
      expect(within(row).getByText('Has its own e-mail')).toBeInTheDocument();
    }
  });

  it('stays editable on the initial status, with the confirmation hint (D-2)', async () => {
    renderPage();
    const box = await toggle('New');
    expect(box).toBeEnabled();
    expect(within(box.closest('tr')!).getByText(/Not sent when a case is filed/)).toBeInTheDocument();
  });

  it('says turning it on does not e-mail the cases already in the status (FR-A33)', async () => {
    renderPage();
    expect(await screen.findByText(/doesn't e-mail cases already in that status/)).toBeInTheDocument();
  });

  it('saves a change through the status write', async () => {
    renderPage();
    await userEvent.click(await toggle('New'));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/returns/statuses/new', { notifyCustomerOnEntry: true }),
    );
  });

  it('warns when a channel has no recipient, naming it and linking to the setting (D-7)', async () => {
    renderPage();
    const alert = await screen.findByText(/no recipient is configured for Polish retail/);
    const link = within(alert.closest('[role="alert"]') ?? alert.parentElement!).getByRole('link', { name: 'Configure recipients' });
    expect(link).toHaveAttribute('href', '/settings?group=returns');
  });

  it('shows no alert when every channel has a recipient', async () => {
    health = { recipientsMissing: { global: false, salesChannelIds: [] } };
    renderPage();
    await toggle('New');
    expect(screen.queryByText(/go to nobody/)).not.toBeInTheDocument();
  });
});
