import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { shippedCoreBundle, shippedModuleBundle } from '../../helpers/core-bundle';
import { orphanLabels } from '../../helpers/orphan-labels';

/**
 * Issue #1463 (UX audit CONTENT-05) — eight of the newsletter's nine screens
 * were written in English whatever language the operator chose, printed raw
 * enum values (`draft`, `tag_list`, `unsubscribed`), and named their inputs
 * with a placeholder only, which disappears as soon as something is typed and
 * is no accessible name (WCAG 2.2 SC 1.3.1, 3.3.2, 4.1.2).
 *
 * Every screen is rendered here with the bundles that ship, in both
 * languages, so a key missing from either fails rather than rendering
 * `newsletter.<key>`. The campaign's language is chosen from the languages the
 * sales channels offer instead of typed as free text (Tesler's Law).
 */

const get = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    useAuth: () => ({ hasPermission: () => true }),
    apiClient: { get: (url: string) => get(url), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

// ECharts draws on a canvas jsdom does not have; the axis it is handed is what is under test.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    EChart: ({ option }: { option: { xAxis: { data: string[] } } }): ReactNode => (
      <ul aria-label="chart">
        {option.xAxis.data.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
    ),
  };
});

// The e-mail canvas is Puck; the screens' own fields are under test, not the editor.
vi.mock('@endora-commerce/page-builder-admin/email', () => ({
  EmailEditorPane: (): ReactNode => <div data-testid="email-canvas" />,
  EmailSubjectWithVariables: ({ id, value }: { id?: string; value: string }): ReactNode => (
    <input id={id} value={value} readOnly />
  ),
  EmailVariablesProvider: ({ children }: { children: ReactNode }): ReactNode => <>{children}</>,
  listEmailTemplatesForApply: async () => [],
  loadEmailTemplateCanvas: async () => null,
  saveCanvasAsEmailTemplate: async () => undefined,
  mergeEmailVariables: () => [],
}));

const { newsletterClient } = await import('../../../../packages/modules/newsletter/src/admin/api/newsletter-client');
const { CampaignsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/CampaignsPage');
const { CampaignEditor } = await import('../../../../packages/modules/newsletter/src/admin/pages/CampaignEditor');
const { CampaignStats } = await import('../../../../packages/modules/newsletter/src/admin/pages/CampaignStats');
const { AutomationsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/AutomationsPage');
const { AutomationBuilder } = await import('../../../../packages/modules/newsletter/src/admin/pages/AutomationBuilder');
const { SubscribersPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/SubscribersPage');
const { TagsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/TagsPage');
const { BlocksPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/BlocksPage');
const { ProviderSettingsPage } = await import('../../../../packages/modules/newsletter/src/admin/pages/ProviderSettingsPage');

const CHANNELS = {
  items: [{ id: 'c1', code: 'b2c', name: { 'en-US': 'Shop' }, defaultLanguage: 'en-US' }],
  total: 1,
  page: 1,
  pageSize: 100,
};
const CHANNEL_DETAIL = { ...CHANNELS.items[0], languages: ['en-US', 'pl-PL'] };

const CAMPAIGN = {
  id: 'cmp-1',
  name: 'November',
  subject: 'Winter prices',
  status: 'draft',
  targetType: 'tag_list',
  scheduledAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const AUTOMATION = { id: 'aut-1', name: 'Welcome', triggerType: 'tag', status: 'paused', stepCount: 2 };
const SUBSCRIBER = { id: 's1', email: 'ann@example.test', status: 'unsubscribed', tags: [], source: null };

beforeEach(() => {
  get.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/v1/admin/sales-channels?')) return CHANNELS;
    if (url.startsWith('/api/v1/admin/sales-channels/b2c')) return CHANNEL_DETAIL;
    throw new Error(`unexpected GET ${url}`);
  });
  vi.spyOn(newsletterClient, 'listCampaigns').mockResolvedValue({ items: [CAMPAIGN], total: 1 } as never);
  vi.spyOn(newsletterClient, 'listAutomations').mockResolvedValue({ items: [AUTOMATION] } as never);
  vi.spyOn(newsletterClient, 'listSubscribers').mockResolvedValue({
    items: [SUBSCRIBER],
    total: 1,
    scopeNotice: null,
  } as never);
  vi.spyOn(newsletterClient, 'listTags').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'listCustomFields').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'listBlocks').mockResolvedValue({ items: [] } as never);
  vi.spyOn(newsletterClient, 'getProvider').mockResolvedValue({
    sender: { fromEmail: 'shop@example.test', fromName: 'Shop' },
    rateLimitPerSecond: 5,
  } as never);
  vi.spyOn(newsletterClient, 'campaignStats').mockResolvedValue({
    sent: 10,
    delivered: 9,
    failed: 1,
    opened: 4,
    clicked: 2,
    openRate: 0.4,
    clickRate: 0.2,
    perLinkClicks: [],
  } as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(['en', 'pl'] as const)('newsletter screens in %s (#1463)', (language) => {
  const own = shippedModuleBundle('newsletter', language).newsletter as Record<string, string>;
  const bundle = { ...shippedModuleBundle('newsletter', language), ...shippedCoreBundle(language) };
  const core = shippedCoreBundle(language).core as Record<string, string>;
  const key = (k: string): string => {
    const value = own[k];
    if (!value) throw new Error(`newsletter/i18n/${language}.json carries no "${k}"`);
    return value;
  };

  function mount(path: string, route: string, element: ReactElement): HTMLElement {
    return renderWithI18n(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={element} />
        </Routes>
      </MemoryRouter>,
      bundle,
      { language },
    ).container;
  }

  it('the campaign list names each campaign’s status and audience, never their codes', async () => {
    mount('/newsletter/campaigns', '/newsletter/campaigns', <CampaignsPage />);
    const row = (await screen.findByRole('link', { name: 'November' })).closest('tr')!;
    expect(within(row).getByText(key('campaign.status.draft'))).toBeInTheDocument();
    expect(within(row).getByText(key('campaign.target.tag_list'))).toBeInTheDocument();
    expect(within(row).queryByText('draft')).toBeNull();
    expect(within(row).queryByText('tag_list')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: key('campaigns.title') })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: key('campaigns.column.audience') })).toBeInTheDocument();
  });

  it('a new campaign labels every field and offers the sales channels’ languages', async () => {
    const container = mount('/newsletter/campaigns/new', '/newsletter/campaigns/:id', <CampaignEditor />);
    expect(screen.getByRole('heading', { level: 1, name: key('campaigns.new') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('campaign.field.name') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('campaign.field.subject') })).toBeInTheDocument();

    const audience = screen.getByRole('combobox', { name: key('campaign.field.audience') });
    expect(within(audience).getByRole('option', { name: key('campaign.target.all') })).toBeInTheDocument();
    expect(within(audience).getByRole('option', { name: key('campaign.target.group') })).toBeInTheDocument();

    const languageSelect = screen.getByRole('combobox', { name: key('campaign.field.language') });
    await waitFor(() => expect(within(languageSelect).getByRole('option', { name: 'pl-PL' })).toBeInTheDocument());
    expect(within(languageSelect).getByRole('option', { name: 'en-US' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/e\.g\. en-US/)).toBeNull();
    expect(orphanLabels(container)).toEqual([]);
  });

  it('campaign statistics are titled and charted in the operator’s language', async () => {
    mount('/newsletter/campaigns/cmp-1/stats', '/newsletter/campaigns/:id/stats', <CampaignStats />);
    expect(screen.getByRole('heading', { level: 1, name: key('stats.title') })).toBeInTheDocument();
    expect(await screen.findByText(key('stats.engagement'))).toBeInTheDocument();
    const axis = within(screen.getByRole('list', { name: 'chart' }));
    for (const metric of ['sent', 'delivered', 'failed', 'opened', 'clicked']) {
      expect(axis.getByText(key(`stats.metric.${metric}`))).toBeInTheDocument();
    }
  });

  it('the automation list names each automation’s status and trigger', async () => {
    mount('/newsletter/automations', '/newsletter/automations', <AutomationsPage />);
    const row = (await screen.findByRole('link', { name: 'Welcome' })).closest('tr')!;
    expect(within(row).getByText(key('automation.status.paused'))).toBeInTheDocument();
    expect(within(row).getByText(key('automation.trigger.tag'))).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: key('automations.action.activate') })).toBeInTheDocument();
  });

  it('a new automation labels its name and trigger', () => {
    const container = mount('/newsletter/automations/new', '/newsletter/automations/:id', <AutomationBuilder />);
    expect(screen.getByRole('heading', { level: 1, name: key('automations.new') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('automation.field.name') })).toBeInTheDocument();
    const trigger = screen.getByRole('combobox', { name: key('automation.field.trigger') });
    expect(within(trigger).getByRole('option', { name: key('automation.trigger.tag_list') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('automation.step.subject') })).toBeInTheDocument();
    expect(orphanLabels(container)).toEqual([]);
  });

  it('the subscriber list labels its filters and names each status', async () => {
    mount('/newsletter/subscribers', '/newsletter/subscribers', <SubscribersPage />);
    const row = (await screen.findByText('ann@example.test')).closest('tr')!;
    expect(within(row).getByText(key('subscriber.status.unsubscribed'))).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: key('subscribers.search') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('subscribers.tagFilter') })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: key('subscribers.export') })).toBeInTheDocument();
  });

  // Issue #1448 (DS-15): "no subscribers yet" and "no subscriber matches these
  // filters" are two empty states; only the second offers Clear filters.
  it('the subscriber list says nobody has subscribed yet on an unfiltered empty list', async () => {
    vi.mocked(newsletterClient.listSubscribers).mockResolvedValue({ items: [], total: 0, scopeNotice: null } as never);
    mount('/newsletter/subscribers', '/newsletter/subscribers', <SubscribersPage />);
    expect(await screen.findByText(key('subscribers.emptyState.title'))).toBeInTheDocument();
    expect(screen.getByText(key('subscribers.emptyState.body'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: core['common.emptyState.clearFilters']! })).toBeNull();
  });

  it('the subscriber list tells filters that match nobody apart, and clears them', async () => {
    mount('/newsletter/subscribers', '/newsletter/subscribers', <SubscribersPage />);
    await screen.findByText('ann@example.test');
    vi.mocked(newsletterClient.listSubscribers).mockResolvedValue({ items: [], total: 0, scopeNotice: null } as never);
    const search = screen.getByRole('searchbox', { name: key('subscribers.search') }) as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'zzzz' } });
    expect(await screen.findByText(key('subscribers.empty'))).toBeInTheDocument();
    expect(screen.queryByText(key('subscribers.emptyState.title'))).toBeNull();
    vi.mocked(newsletterClient.listSubscribers).mockResolvedValue({ items: [SUBSCRIBER], total: 1, scopeNotice: null } as never);
    fireEvent.click(screen.getByRole('button', { name: core['common.emptyState.clearFilters']! }));
    expect(await screen.findByText('ann@example.test')).toBeInTheDocument();
    expect(search.value).toBe('');
  });

  it('tags and custom fields label every input and name each field type', async () => {
    const container = mount('/newsletter/tags', '/newsletter/tags', <TagsPage />);
    await waitFor(() => expect(newsletterClient.listTags).toHaveBeenCalled());
    // The add forms are dialogs opened from each section's header (issue #1439, DS-05).
    fireEvent.click(await screen.findByRole('button', { name: key('tags.add') }));
    let dialog = screen.getByRole('dialog', { name: key('tags.dialog.title') });
    expect(within(dialog).getByRole('textbox', { name: key('tags.field.name') })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: key('tags.field.code') })).toBeInTheDocument();
    expect(orphanLabels(dialog)).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: core['common.action.cancel']! }));

    fireEvent.click(screen.getByRole('button', { name: key('fields.add') }));
    dialog = screen.getByRole('dialog', { name: key('fields.dialog.title') });
    expect(within(dialog).getByRole('textbox', { name: key('fields.field.label') })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: key('fields.field.key') })).toBeInTheDocument();
    const type = within(dialog).getByRole('combobox', { name: key('fields.field.type') });
    expect(within(type).getByRole('option', { name: key('fieldType.boolean') })).toBeInTheDocument();
    expect(within(type).queryByRole('option', { name: 'boolean' })).toBeNull();
    expect(orphanLabels(dialog)).toEqual([]);
    expect(orphanLabels(container)).toEqual([]);
  });

  it('a new e-mail block labels its code and name', async () => {
    mount('/newsletter/blocks', '/newsletter/blocks', <BlocksPage />);
    await waitFor(() => expect(newsletterClient.listBlocks).toHaveBeenCalled());
    expect(screen.getByRole('textbox', { name: key('emailBlocks.field.code') })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: key('emailBlocks.field.name') })).toBeInTheDocument();
    expect(screen.getByText(key('emailBlocks.empty'))).toBeInTheDocument();
  });

  it('the sending provider labels the sender and the throttle', async () => {
    mount('/newsletter/provider', '/newsletter/provider', <ProviderSettingsPage />);
    expect(await screen.findByRole('textbox', { name: key('provider.field.fromEmail') })).toHaveValue('shop@example.test');
    expect(screen.getByRole('textbox', { name: key('provider.field.fromName') })).toHaveValue('Shop');
    expect(screen.getByRole('spinbutton', { name: key('provider.field.rateLimit') })).toHaveValue(5);
    expect(screen.getByRole('heading', { level: 1, name: key('provider.title') })).toBeInTheDocument();
  });
});
