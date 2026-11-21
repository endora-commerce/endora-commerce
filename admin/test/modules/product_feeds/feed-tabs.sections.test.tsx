import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { FeedDeliveryConfig } from '@endora-commerce/contracts';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import type { FeedTemplateSummary, ProductFeedDto } from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * Issue #1530 (UX audit 2026-11-17, CAT-20) and the DS-03 leftovers in
 * product feeds (#1437). The Settings and Delivery tabs were a column of
 * separate boxes, and the FTP/SFTP form put a help paragraph under almost
 * every field (Common Region; Signal-to-Noise). Each tab is now one card of
 * `EditorSection`s, the destructive action sits in its own last section, an
 * action's result is an `InlineStatus` beside its button (not an Alert
 * banner), and the help lines that restated the field are gone.
 */

const update = vi.fn();
const deliveryGet = vi.fn();
const deliverySave = vi.fn();
const listTemplates = vi.fn();
const importTemplate = vi.fn();

// The dropzone reads a real file; the import page's subject here is what it draws after.
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    FileDropzone: (props: { onFile: (name: string, base64: string) => void }) => (
      <button
        type="button"
        onClick={() =>
          props.onFile(
            'google.json',
            btoa(JSON.stringify({ template: { name: 'Google', outputFormat: 'xml', itemGranularity: 'product', fields: [] } })),
          )
        }
      >
        pick-file
      </button>
    ),
  };
});

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<typeof import('../../../../packages/modules/product_feeds/src/admin/api')>(
    '../../../../packages/modules/product_feeds/src/admin/api',
  );
  return {
    ...actual,
    productFeedsClient: {
      ...actual.productFeedsClient,
      update: (...args: unknown[]) => update(...args),
      priceBookOptions: () => Promise.resolve({ data: [] }),
      previewSelection: () => Promise.resolve({ data: { matchedCount: 0, sample: [] } }),
      listTemplates: () => listTemplates(),
      importTemplate: (...args: unknown[]) => importTemplate(...args),
    },
    feedDeliveryClient: {
      ...actual.feedDeliveryClient,
      get: () => deliveryGet(),
      listAttempts: () => Promise.resolve({ data: [] }),
      save: (...args: unknown[]) => deliverySave(...args),
    },
  };
});

const { FeedSettingsForm } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedSettingsForm'
);
const { FeedDeliveryPanel } = await import(
  '../../../../packages/modules/product_feeds/src/admin/components/FeedDeliveryPanel'
);
const { FeedLinkCard } = await import('../../../../packages/modules/product_feeds/src/admin/components/FeedLinkCard');
const { FeedTemplateImportPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/FeedTemplateImportPage'
);
const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { FeedTemplatesListPage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/FeedTemplatesListPage'
);

const bundle = passthroughBundle('product_feeds', [
  'feeds.settings.binding',
  'feeds.settings.criteria',
  'feeds.settings.schedule',
  'feeds.settings.danger',
  'feeds.settings.prices',
  'feeds.settings.presentation',
  'feeds.settings.presentation.net',
  'feeds.settings.presentation.gross',
  'feeds.settings.taxCountry',
  'feeds.settings.taxCountry.required',
  'feeds.settings.enabled',
  'feeds.settings.priceBook',
  'feeds.settings.save',
  'feeds.settings.saved',
  'delivery.title',
  'delivery.subtitle',
  'delivery.loading',
  'delivery.empty.title',
  'delivery.action.configure',
  'delivery.action.save',
  'delivery.action.test',
  'delivery.action.remove',
  'delivery.remove.title',
  'delivery.remove.help',
  'delivery.saved',
  'delivery.field.send',
  'delivery.field.enabled',
  'delivery.field.enabled.help',
  'delivery.field.protocol',
  'delivery.field.host',
  'delivery.field.host.help',
  'delivery.field.port',
  'delivery.field.username',
  'delivery.field.password',
  'delivery.field.privateKey',
  'delivery.field.privateKey.help',
  'delivery.field.directoryPath',
  'delivery.field.directoryPath.help',
  'delivery.history.title',
  'delivery.history.empty.title',
  'feeds.link.ready.title',
  'feeds.link.ready.body',
  'feeds.link.public',
  'feeds.link.copy',
  'feeds.link.rotate',
  'feeds.link.revoke',
  'feeds.action.download',
  'templates.mine',
  'templates.provided',
  'templates.view',
  'templates.duplicate',
  'templates.readyToUse',
  'templates.startingPoint',
  'templates.empty.mine.title',
  'permission.needWrite',
  'import.summary.title',
  'import.collision.title',
  'import.collision.keepBoth',
  'import.collision.replace',
  'import.action.import',
]);

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
  pricePresentation: 'gross',
  taxCountry: 'PL',
  selectionRule: { kind: 'all' },
  schedule: null,
  enabled: true,
  token: {
    prefix: 'abcdefgh',
    rotatedAt: '2026-08-01T10:00:00.000Z',
    revokedAt: null,
    url: 'https://api.example.com/api/v1/public/product-feeds/abcdefgh12345',
    urlIsLive: true,
  },
  lastRun: null,
  nextRunAt: null,
  publishedArtefactId: 'a1',
  publishedItemCount: 12,
  publishedAt: '2026-08-01T10:00:00.000Z',
  isRunning: false,
  scheduleTooTightWarning: false,
  pinnedPriceBookWarning: null,
  version: 1,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
} satisfies ProductFeedDto;

const SFTP = {
  protocol: 'sftp',
  httpLabel: null,
  enabled: true,
  host: 'sftp.partner.example',
  port: 22,
  username: 'shop',
  directoryPath: '/in',
  requestUrl: null,
  headers: [],
  passwordSet: true,
  privateKeySet: false,
  version: 1,
} as unknown as FeedDeliveryConfig;

function withAdmin(node: React.ReactNode): React.ReactElement {
  return withSession(<MemoryRouter>{node}</MemoryRouter>, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: ['product_feeds', 'price_lists'] }),
  });
}

/** The headings of the sections directly under one card, in order. */
function sectionTitles(card: Element): string[] {
  return [...card.querySelectorAll('section[data-slot=editor-section] > div h2')].map((h) => h.textContent ?? '');
}

beforeEach(() => {
  update.mockReset();
  deliveryGet.mockReset();
  deliverySave.mockReset();
  listTemplates.mockReset();
});

describe('Settings tab (#1530)', () => {
  it('is one card of sections, with the on/off switch in the first one and no "danger zone"', () => {
    renderWithI18n(withAdmin(<FeedSettingsForm feed={FEED} onSaved={vi.fn()} />), bundle);
    const cards = document.querySelectorAll('[data-slot=card]');
    expect(cards).toHaveLength(1);
    expect(sectionTitles(cards[0]!)).toEqual([
      'feeds.settings.binding',
      'feeds.settings.prices',
      'feeds.settings.criteria',
      'feeds.settings.schedule',
    ]);
    const binding = screen.getByRole('region', { name: 'feeds.settings.binding' });
    expect(within(binding).getByRole('checkbox', { name: 'feeds.settings.enabled' })).toBeChecked();
    expect(screen.queryByText('feeds.settings.danger')).toBeNull();
  });

  it('labels the price display and the tax country in words, not raw values', () => {
    renderWithI18n(withAdmin(<FeedSettingsForm feed={FEED} onSaved={vi.fn()} />), bundle);
    const presentation = screen.getByRole('combobox', { name: 'feeds.settings.presentation' });
    expect(within(presentation).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'feeds.settings.presentation.net',
      'feeds.settings.presentation.gross',
    ]);
    expect(screen.getByRole('textbox', { name: 'feeds.settings.taxCountry' })).toHaveValue('PL');
  });

  it('reports the save in the action bar, in a live region mounted before it', async () => {
    update.mockResolvedValue({ data: FEED });
    renderWithI18n(withAdmin(<FeedSettingsForm feed={FEED} onSaved={vi.fn()} />), bundle);
    const save = screen.getByRole('button', { name: 'feeds.settings.save' });
    const bar = save.closest('[data-slot=sticky-form-actions]')!;
    expect(bar).toBeTruthy();
    const status = within(bar as HTMLElement).getByRole('status');
    expect(status).toHaveTextContent('');
    await userEvent.click(save);
    await waitFor(() => expect(status).toHaveTextContent('feeds.settings.saved'));
  });

  it('says why a gross feed cannot be saved without a tax country, linked to the field', async () => {
    renderWithI18n(
      withAdmin(<FeedSettingsForm feed={{ ...FEED, taxCountry: null }} onSaved={vi.fn()} />),
      bundle,
    );
    const field = screen.getByRole('textbox', { name: 'feeds.settings.taxCountry' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('feeds.settings.taxCountry.required');
    expect(screen.getByRole('button', { name: 'feeds.settings.save' })).toBeDisabled();
  });
});

describe('Delivery tab (#1530)', () => {
  it('says it is loading instead of rendering nothing', () => {
    deliveryGet.mockReturnValue(new Promise(() => undefined));
    renderWithI18n(withAdmin(<FeedDeliveryPanel feedId="f1" />), bundle);
    expect(screen.getByRole('status')).toHaveTextContent('delivery.loading');
  });

  it('is one card: delivery, history, then the removal on its own at the end', async () => {
    deliveryGet.mockResolvedValue({ data: SFTP });
    renderWithI18n(withAdmin(<FeedDeliveryPanel feedId="f1" />), bundle);
    await screen.findByRole('region', { name: 'delivery.title' });
    const cards = document.querySelectorAll('[data-slot=card]');
    expect(cards).toHaveLength(1);
    expect(sectionTitles(cards[0]!)).toEqual(['delivery.title', 'delivery.history.title', 'delivery.remove.title']);
    const removal = screen.getByRole('region', { name: 'delivery.remove.title' });
    expect(within(removal).getByRole('button', { name: 'delivery.action.remove' })).toBeTruthy();
    const delivery = screen.getByRole('region', { name: 'delivery.title' });
    expect(within(delivery).queryByRole('button', { name: 'delivery.action.remove' })).toBeNull();
  });

  it('shows the empty state and the history in the same card when nothing is configured', async () => {
    deliveryGet.mockResolvedValue({ data: null });
    renderWithI18n(withAdmin(<FeedDeliveryPanel feedId="f1" />), bundle);
    await screen.findByText('delivery.empty.title');
    const cards = document.querySelectorAll('[data-slot=card]');
    expect(cards).toHaveLength(1);
    expect(sectionTitles(cards[0]!)).toEqual(['delivery.title', 'delivery.history.title']);
  });

  it('drops the help lines that restated the field, and switches delivery with a checkbox', async () => {
    deliveryGet.mockResolvedValue({ data: SFTP });
    renderWithI18n(withAdmin(<FeedDeliveryPanel feedId="f1" />), bundle);
    expect(await screen.findByRole('checkbox', { name: 'delivery.field.send' })).toBeChecked();
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('delivery.field.enabled.help');
    expect(text).not.toContain('delivery.field.host.help');
    expect(screen.getByRole('textbox', { name: 'delivery.field.port' })).toHaveValue('22');
  });

  it('reports a save beside the button, not in a banner', async () => {
    deliveryGet.mockResolvedValue({ data: SFTP });
    deliverySave.mockResolvedValue({ data: SFTP });
    renderWithI18n(withAdmin(<FeedDeliveryPanel feedId="f1" />), bundle);
    const save = await screen.findByRole('button', { name: 'delivery.action.save' });
    const status = within(save.parentElement!).getByRole('status');
    expect(status).toHaveTextContent('');
    await userEvent.click(save);
    await waitFor(() => expect(status).toHaveTextContent('delivery.saved'));
    expect(document.querySelector('[data-slot=alert]')).toBeNull();
  });
});

describe('Overview tab link card (DS-03)', () => {
  it('is a region named by its heading', () => {
    renderWithI18n(withAdmin(<FeedLinkCard feed={FEED} issuedToken={null} onChanged={vi.fn()} />), bundle);
    expect(screen.getByRole('region', { name: 'feeds.link.ready.title' })).toBeTruthy();
  });
});

function template(over: Partial<FeedTemplateSummary> & { id: string }): FeedTemplateSummary {
  return {
    name: `Template ${over.id}`,
    description: 'A description',
    providerCode: 'google',
    outputFormat: 'xml',
    itemGranularity: 'product',
    taxonomyProviderCode: null,
    isSystem: true,
    systemCode: null,
    usedByFeedCount: 0,
    fieldCount: 20,
    version: 1,
    updatedAt: '2026-08-01T10:00:00.000Z',
    ...over,
  } as FeedTemplateSummary;
}

describe('Templates list (DS-03)', () => {
  it('lists the platform templates as rows of one card, not a card each', async () => {
    listTemplates.mockResolvedValue({ data: [template({ id: 'a' }), template({ id: 'b', fieldCount: 5 })] });
    renderWithI18n(withAdmin(<FeedTemplatesListPage />), bundle);
    const provided = await screen.findByRole('region', { name: 'templates.provided' });
    await within(provided).findByText('Template a');
    expect(provided.querySelectorAll('[data-slot=card] [data-slot=card]')).toHaveLength(0);
    expect(provided.querySelectorAll('[data-slot=card]')).toHaveLength(0);
    expect(within(provided).getAllByRole('listitem')).toHaveLength(2);
  });

  it('keeps one primary action: each row’s Duplicate is not a filled button', async () => {
    listTemplates.mockResolvedValue({ data: [template({ id: 'a' })] });
    renderWithI18n(withAdmin(<FeedTemplatesListPage />), bundle);
    const provided = await screen.findByRole('region', { name: 'templates.provided' });
    const duplicate = await within(provided).findByRole('button', { name: 'templates.duplicate' });
    expect(duplicate.className).not.toMatch(/\bbg-primary\b/);
  });
});

describe('Template import (DS-03)', () => {
  it('shows the summary as the page’s one card, and a name clash as a group of it, not a box inside it', async () => {
    importTemplate.mockRejectedValue(
      new ApiError(409, {
        error: { code: 'conflict', message: 'taken', details: { reason: 'template_name_conflict', existingName: 'Google' } },
      } as never),
    );
    renderWithI18n(withAdmin(<FeedTemplateImportPage />), bundle);
    await userEvent.click(screen.getByRole('button', { name: 'pick-file' }));
    const summary = await screen.findByRole('region', { name: 'import.summary.title' });
    await userEvent.click(within(summary).getByRole('button', { name: 'import.action.import' }));
    const group = await within(summary).findByRole('group', { name: 'import.collision.title' });
    expect(group.className).not.toMatch(/\brounded/);
    expect(within(group).getByRole('radio', { name: 'import.collision.keepBoth' })).toBeChecked();
    expect(summary.querySelectorAll('[data-slot=card]')).toHaveLength(0);
  });
});
