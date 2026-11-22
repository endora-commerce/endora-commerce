import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { Bundle } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #1749 (UX audit 2026-11-17, follow-up of DS-05 #1439): the list
 * screens that drew their own header, cards and states are the kit `ListPage`.
 *
 * Every screen here is held to the same three states, the ones a hand-rolled
 * list most often left out:
 *
 * - **loading** — the kit skeleton in a results region marked `aria-busy`, and
 *   *Loading…* through the count's live region;
 * - **error** — the server's message beside a *Retry* that asks again;
 * - **ready** — the result count, announced in the live region at the end of
 *   the toolbar row (WCAG 4.1.3), and one page heading.
 *
 * What a screen does with its rows — filters, empty states, row actions — is
 * held by that screen's own tests, which this change leaves passing.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...args: unknown[]) => getSpy(...args), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    usePageSizePreference: () => ({ pageSize: 25 as const, setPageSize: vi.fn() }),
  };
});

// The channel picker reads the app language context the shell provides; these
// tests are about the page around it.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, SalesChannelPicker: ({ id }: { id?: string }) => <input id={id} readOnly /> };
});

const { ApiError } = await import('@endora-commerce/admin-kit/lib');

const REPO_ROOT = resolve(process.cwd(), '..');
const readBundle = (module: string): Record<string, string> =>
  JSON.parse(readFileSync(join(REPO_ROOT, `packages/modules/${module}/i18n/en.json`), 'utf8')) as Record<string, string>;
const core = readBundle('_i18n');

interface Subject {
  /** The screen, as its route loads it. */
  load: () => Promise<ComponentType>;
  /** The module whose bundle the screen reads. */
  module: string;
  /** The modules present beyond it — a screen gated on another module's presence. */
  present?: string[];
  /** The page title's key in that bundle. */
  titleKey: string;
  /** Answers for a ready list, by URL prefix — the first match wins. */
  ready: Record<string, (url: string) => unknown>;
  /** The URL prefix whose failure is the list's load failure. */
  listUrl: string;
  /** A cell of the ready list's one row, as rendered. */
  row: string;
  /**
   * The count the ready list announces, as rendered — absent for a cursor-paged
   * list, whose endpoint answers no total.
   */
  count?: (bundle: Record<string, string>) => string;
}

const fill = (template: string, values: Record<string, string | number>): string =>
  Object.entries(values).reduce<string>((text, [k, v]) => text.replace(`{${k}}`, String(v)), template);

const SUBJECTS: Record<string, Subject> = {
  SalesChannelsListPage: {
    load: async () =>
      (await import('../../../packages/modules/sales_channels/src/admin/pages/SalesChannelsListPage')).SalesChannelsListPage,
    module: 'sales_channels',
    titleKey: 'list.page.title',
    listUrl: '/api/v1/admin/sales-channels',
    ready: {
      '/api/v1/admin/sales-channels': () => ({
        items: [
          {
            id: '00000000-0000-4000-8000-0000000000c1',
            code: 'b2b',
            name: { en: 'Wholesale' },
            defaultLanguage: 'en',
            defaultCurrency: 'EUR',
            active: true,
            anonymousAccess: true,
            systemDefault: true,
            version: 1,
          },
        ],
      }),
    },
    row: 'Wholesale',
    count: (b) => fill(b['list.count']!, { count: 1 }),
  },
  CredentialsPage: {
    load: async () => (await import('../../../packages/modules/credentials/src/admin/pages/CredentialsPage')).CredentialsPage,
    module: 'credentials',
    titleKey: 'page.title',
    listUrl: '/api/v1/admin/credentials',
    ready: {
      '/api/v1/admin/credentials/types': () => ({ types: [{ type: 'api_key', label: 'API key', fields: [] }] }),
      '/api/v1/admin/credentials': () => ({
        configurations: [
          {
            id: '00000000-0000-4000-8000-0000000000d1',
            code: 'erp',
            name: 'ERP key',
            typeCode: 'api_key',
            typeLabel: 'API key',
            providerCode: 'erp',
            providerLabel: 'ERP',
            inert: false,
            values: {},
          },
        ],
      }),
    },
    row: 'ERP key',
    count: (b) => fill(b['page.count']!, { count: 1 }),
  },
  OnlineCustomers: {
    load: async () => (await import('../../../packages/modules/customers/src/admin/pages/OnlineCustomers')).OnlineCustomers,
    module: 'customers',
    titleKey: 'online.title',
    listUrl: '/api/v1/admin/customers/online',
    ready: {
      '/api/v1/admin/customers/online': () => ({
        data: [
          { id: 'c1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', lastSeenAt: '2026-11-21T10:00:00.000Z' },
        ],
      }),
    },
    row: 'Ada Lovelace',
    count: (b) => fill(b['online.count']!, { count: 1 }),
  },
  LedgerDeliveriesPage: {
    load: async () =>
      (await import('../../../packages/modules/invoice_ledger/src/admin/pages/LedgerDeliveriesPage')).LedgerDeliveriesPage,
    module: 'invoice_ledger',
    titleKey: 'deliveries.page.title',
    listUrl: '/api/v1/admin/invoice-ledger/deliveries',
    ready: {
      '/api/v1/admin/invoice-ledger/deliveries': () => ({
        data: [
          {
            id: '00000000-0000-4000-8000-0000000000e1',
            invoiceId: '00000000-0000-4000-8000-0000000000e2',
            invoiceNumber: 'INV/2026/11/0001',
            adapterId: 'ksef',
            status: 'failed',
            lastError: null,
            environment: 'test',
            updatedAt: '2026-11-21T10:00:00.000Z',
          },
        ],
        pagination: { cursor: null, hasMore: false, limit: 25 },
      }),
    },
    row: 'INV/2026/11/0001',
  },
  DictionaryAuditPage: {
    load: async () => (await import('../../../packages/modules/dictionaries/src/admin/pages/AuditPage')).DictionaryAuditPage,
    module: 'dictionaries',
    titleKey: 'audit.page.title',
    listUrl: '/api/v1/admin/dictionary/audit/orphans',
    ready: {
      '/api/v1/admin/dictionary/audit/orphans': () => ({
        data: [{ dictionary: 'country', consumer: 'orders', tableName: 'orders', columnName: 'country', code: 'XX', count: 3 }],
        meta: { generatedAt: '2026-11-21T10:00:00.000Z' },
      }),
    },
    row: 'XX',
    count: (b) => fill(b['audit.groupCount']!, { count: 1 }),
  },
  ComparisonsListPage: {
    load: async () => (await import('../../../packages/modules/comparisons/src/admin/pages/ComparisonsListPage')).default,
    module: 'comparisons',
    titleKey: 'list.page.title',
    listUrl: '/api/v1/admin/comparisons',
    ready: {
      '/api/v1/admin/comparisons': () => ({
        data: [
          {
            id: '00000000-0000-4000-8000-0000000000f1',
            owner: { kind: 'customer', email: 'buyer@example.com' },
            salesChannel: { id: '00000000-0000-4000-8000-0000000000f2', code: 'b2b' },
            displayMode: 'net',
            productCount: 3,
            createdAt: '2026-11-21T10:00:00.000Z',
          },
        ],
        meta: { limit: 25, nextCursor: null },
      }),
    },
    row: 'buyer@example.com',
  },
  LowStockPage: {
    load: async () => (await import('../../../packages/modules/inventory/src/admin/pages/LowStockPage')).LowStockPage,
    module: '_i18n',
    present: ['inventory'],
    titleKey: 'inventory.lowStock.title',
    listUrl: '/api/v1/admin/inventory/low-stock',
    ready: {
      '/api/v1/admin/inventory/low-stock': () => ({
        items: [{ productId: 'p1', productSku: 'SKU-1', productName: 'Oak chair', cumulativeOnHand: 1, lowStockThreshold: 2 }],
      }),
    },
    row: 'Oak chair',
    count: (b) => fill(b['inventory.lowStock.count']!, { count: 1 }),
  },
  CampaignsPage: {
    load: async () => (await import('../../../packages/modules/newsletter/src/admin/pages/CampaignsPage')).CampaignsPage,
    module: 'newsletter',
    titleKey: 'campaigns.title',
    listUrl: '/api/v1/admin/newsletter/campaigns',
    ready: {
      '/api/v1/admin/newsletter/campaigns': () => ({
        data: { items: [{ id: 'cmp1', name: 'November', subject: 'Autumn offer', targetType: 'all', status: 'draft' }] },
      }),
    },
    row: 'November',
    count: (b) => fill(b['campaigns.count']!, { count: 1 }),
  },
  SubscribersPage: {
    load: async () => (await import('../../../packages/modules/newsletter/src/admin/pages/SubscribersPage')).SubscribersPage,
    module: 'newsletter',
    titleKey: 'subscribers.title',
    listUrl: '/api/v1/admin/newsletter/subscribers',
    ready: {
      '/api/v1/admin/newsletter/subscribers': () => ({
        data: {
          items: [{ id: 's1', email: 'ann@example.test', status: 'active', tags: [], source: null }],
          total: 1,
          page: 1,
          pageSize: 25,
        },
      }),
    },
    row: 'ann@example.test',
    count: (b) => fill(b['subscribers.count.one']!, { count: 1 }),
  },
  EmailTemplatesPage: {
    load: async () =>
      (await import('../../../packages/modules/transactional_emails/src/admin/pages/EmailTemplatesPage')).EmailTemplatesPage,
    module: 'transactional_emails',
    titleKey: 'templates.title',
    listUrl: '/api/v1/admin/transactional-emails/templates',
    ready: {
      '/api/v1/admin/transactional-emails/templates': () => ({
        data: { items: [{ id: 't1', code: 'layout', name: 'Layout', scope: 'global', isSystem: false }] },
      }),
    },
    row: 'Layout',
    count: (b) => fill(b['templates.count']!, { count: 1 }),
  },
};

function mount(Page: ComponentType, module: string, present: string[] = []): ReturnType<typeof userEvent.setup> {
  const user = userEvent.setup();
  const bundle: Bundle = { core, [module]: readBundle(module) };
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: [module, ...present] }) },
    ),
    bundle,
  );
  return user;
}

/** Answers `url` by the first matching prefix; anything else is a test bug. */
function answer(routes: Record<string, (url: string) => unknown>): void {
  getSpy.mockImplementation(async (url: string) => {
    const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!match) throw new Error(`unexpected url ${url}`);
    return routes[match]!(url);
  });
}

/** The polite live regions' texts — the ListPage count is one of them. */
const liveTexts = (): string[] =>
  [...document.querySelectorAll('[role="status"][aria-live="polite"]')].map((region) => region.textContent ?? '');

/** The ready list: its row on screen and, where it has one, its count announced. */
async function expectReady(subject: Subject, bundle: Record<string, string>): Promise<void> {
  expect(await screen.findByText(subject.row)).toBeInTheDocument();
  if (subject.count) {
    const count = subject.count(bundle);
    await waitFor(() => expect(liveTexts()).toContain(count));
  }
}

beforeEach(() => {
  getSpy.mockReset();
});

describe.each(Object.entries(SUBJECTS))('%s is the kit ListPage (#1749)', (_name, subject) => {
  const bundle = readBundle(subject.module);

  it('draws the kit skeleton in a busy results region while the list loads', async () => {
    getSpy.mockImplementation(() => new Promise(() => {}));
    mount(await subject.load(), subject.module, subject.present);
    const skeleton = await screen.findByTestId('list-page-skeleton');
    expect(skeleton.closest('[aria-busy="true"]')).not.toBeNull();
    expect(liveTexts()).toContain(core['common.state.loading']!);
  });

  it('says why the list did not load, and Retry asks again', async () => {
    const routes = subject.ready;
    let failing = true;
    getSpy.mockImplementation(async (url: string) => {
      if (failing && url.startsWith(subject.listUrl)) {
        throw new ApiError(500, { error: { code: 'INTERNAL', message: 'The list is unavailable.' } });
      }
      const match = Object.keys(routes).find((prefix) => url.startsWith(prefix));
      if (!match) throw new Error(`unexpected url ${url}`);
      return routes[match]!(url);
    });
    const user = mount(await subject.load(), subject.module, subject.present);
    const alert = await screen.findByRole('alert');
    expect(screen.queryByText(subject.row)).toBeNull();
    expect(alert).toHaveTextContent('The list is unavailable.');
    failing = false;
    await user.click(within(alert).getByRole('button', { name: core['common.action.retry']! }));
    await expectReady(subject, bundle);
  });

  it('shows the rows, announces the count, under one page heading', async () => {
    answer(subject.ready);
    mount(await subject.load(), subject.module, subject.present);
    await expectReady(subject, bundle);
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent(bundle[subject.titleKey]!);
  });
});
