import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import type {
  FeedPriceBookOption,
  ProductFeedDto,
  UpdateFeedBody,
} from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * Issue #414 — a feed could be pinned to a price book only through the API.
 * The settings tab now carries the picker: every book of the feed's currency,
 * the ones that would not publish for this feed (feature 160 FR-029, owner
 * ruling 2026-10-23) disabled with the reason beside their name, and the book
 * the feed is pinned to kept selectable whatever its state, so opening the tab
 * and saving never changes the pin behind the operator's back.
 */

const update = vi.fn<(id: string, body: UpdateFeedBody) => Promise<{ data: ProductFeedDto }>>();
const priceBookOptions = vi.fn<(id: string) => Promise<{ data: FeedPriceBookOption[] }>>();

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<typeof import('../../../../packages/modules/product_feeds/src/admin/api')>(
    '../../../../packages/modules/product_feeds/src/admin/api',
  );
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      update: (id: string, body: UpdateFeedBody) => update(id, body),
      priceBookOptions: (id: string) => priceBookOptions(id),
      // The criteria panel previews the selection; nothing here is about it.
      previewSelection: () => Promise.resolve({ data: { matchedCount: 0, sample: [] } }),
    },
  };
});

const bundle = passthroughBundle('product_feeds', [
  'feeds.settings.prices',
  'feeds.settings.priceBook',
  'feeds.settings.priceBook.none',
  'feeds.settings.priceBook.base',
  'feeds.settings.priceBook.missing',
  'feeds.settings.priceBook.current',
  'feeds.settings.priceBook.unavailable',
  'feeds.settings.priceBook.hint',
  'feeds.settings.priceBook.loadFailed',
  'feeds.settings.priceBook.needPriceListsRead',
  'feeds.settings.priceBook.reason.not_found',
  'feeds.settings.priceBook.reason.currency_mismatch',
  'feeds.settings.priceBook.reason.not_active',
  'feeds.settings.priceBook.reason.outside_schedule',
  'feeds.settings.priceBook.reason.not_on_channel',
  'feeds.settings.priceBook.reason.audience_restricted',
  'feeds.pinnedBook.not_active',
  'feeds.settings.save',
  'feeds.settings.saved',
  'permission.needWrite',
]);

const { FeedSettingsForm } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedSettingsForm'
);

const FEED = {
  id: 'f1',
  name: 'Google Shopping',
  slug: 'google-shopping',
  feedTemplateId: 't1',
  feedTemplateName: 'Google',
  salesChannelId: 'sc1',
  salesChannelCode: 'web',
  languageCode: 'pl',
  currencyCode: 'PLN',
  priceListId: null,
  pricePresentation: 'net',
  taxCountry: null,
  selectionRule: { kind: 'all' },
  schedule: null,
  enabled: true,
  token: { prefix: '0fgh4wx9', rotatedAt: null, revokedAt: null, url: null, urlIsLive: false },
  lastRun: null,
  nextRunAt: null,
  publishedArtefactId: null,
  publishedItemCount: null,
  publishedAt: null,
  isRunning: false,
  scheduleTooTightWarning: false,
  pinnedPriceBookWarning: null,
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
} satisfies ProductFeedDto;

const OPTIONS: FeedPriceBookOption[] = [
  { id: 'base', name: 'Base PLN', isBase: true, unpublishableReason: null },
  { id: 'live', name: 'Summer sale', isBase: false, unpublishableReason: null },
  { id: 'draft', name: 'Autumn draft', isBase: false, unpublishableReason: 'not_active' },
];

function renderForm(feed: ProductFeedDto = FEED, permissions: string[] = ['*']): void {
  renderWithI18n(
    withSession(<FeedSettingsForm feed={feed} onSaved={vi.fn()} />, {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: ['product_feeds', 'price_lists'] }),
    }),
    bundle,
  );
}

const picker = (): HTMLSelectElement => screen.getByLabelText('feeds.settings.priceBook') as HTMLSelectElement;

describe('FeedSettingsForm — pinning the feed to a price book (issue #414)', () => {
  beforeEach(() => {
    update.mockReset();
    priceBookOptions.mockReset();
    update.mockImplementation((_id, body) => Promise.resolve({ data: { ...FEED, ...body } as ProductFeedDto }));
    priceBookOptions.mockResolvedValue({ data: OPTIONS });
  });

  it('offers no book, then every book; one that would not publish is disabled with its reason', async () => {
    renderForm();
    await waitFor(() => expect(within(picker()).getAllByRole('option')).toHaveLength(4));
    expect(priceBookOptions).toHaveBeenCalledWith('f1');
    const options = within(picker()).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => [o.value, o.disabled])).toEqual([
      ['', false],
      ['base', false],
      ['live', false],
      ['draft', true],
    ]);
    expect(options[0]!.textContent).toBe('feeds.settings.priceBook.none');
    expect(options[1]!.textContent).toContain('feeds.settings.priceBook.base');
    expect(options[3]!.textContent).toContain('Autumn draft');
    expect(options[3]!.textContent).toContain('feeds.settings.priceBook.reason.not_active');
    expect(picker().value).toBe('');
  });

  it('saves the chosen book as the feed’s priceListId', async () => {
    renderForm();
    await waitFor(() => expect(within(picker()).getAllByRole('option')).toHaveLength(4));
    await userEvent.selectOptions(picker(), 'live');
    await userEvent.click(screen.getByRole('button', { name: 'feeds.settings.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).toMatchObject({ priceListId: 'live' });
  });

  it('unpins with "no price book"', async () => {
    renderForm({ ...FEED, priceListId: 'live' });
    await waitFor(() => expect(picker().value).toBe('live'));
    await userEvent.selectOptions(picker(), '');
    await userEvent.click(screen.getByRole('button', { name: 'feeds.settings.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).toMatchObject({ priceListId: null });
  });

  it('keeps a pinned book that does not publish selected, and states why', async () => {
    renderForm({ ...FEED, priceListId: 'draft', pinnedPriceBookWarning: 'not_active' });
    await waitFor(() => expect(picker().value).toBe('draft'));
    const draft = within(picker()).getByRole('option', { name: /Autumn draft/ }) as HTMLOptionElement;
    expect(draft.disabled).toBe(false);
    expect(screen.getByText('feeds.pinnedBook.not_active')).toBeTruthy();
  });

  it('does not resend an unchanged pin, so a book that no longer exists does not block saving', async () => {
    renderForm({ ...FEED, priceListId: 'gone', pinnedPriceBookWarning: 'not_found' });
    await waitFor(() => expect(picker().value).toBe('gone'));
    expect(within(picker()).getByRole('option', { name: 'feeds.settings.priceBook.missing' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'feeds.settings.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update.mock.calls[0]![1]).not.toHaveProperty('priceListId');
  });

  it('without price_lists:read, shows the picker disabled and does not ask for the books', async () => {
    renderForm(FEED, ['product_feeds:read', 'product_feeds:write']);
    expect(picker().disabled).toBe(true);
    expect(screen.getByText('feeds.settings.priceBook.needPriceListsRead')).toBeTruthy();
    expect(priceBookOptions).not.toHaveBeenCalled();
  });

  it('says so when the books cannot be loaded, and keeps the pin as it is', async () => {
    priceBookOptions.mockRejectedValue(new Error('boom'));
    renderForm({ ...FEED, priceListId: 'live' });
    expect(await screen.findByText('feeds.settings.priceBook.loadFailed')).toBeTruthy();
    expect(picker().disabled).toBe(true);
  });
});
