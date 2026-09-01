import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * A failed mount read on the create form must render a message, not an empty
 * picker.
 *
 * Both of this screen's mount reads used to be `void client.x().then(…)` with no
 * `.catch`, so a failed request was an unhandled promise rejection and the
 * operator saw an empty template `<select>` and an empty language `<select>` —
 * a **failure that looks exactly like an absence**: "the platform ships no feed
 * templates", "this channel has no languages". Neither is something the screen
 * had any evidence for.
 *
 * So the assertion here is deliberately not "the screen still renders". It is
 * that a **rejecting** client produces text an operator can tell apart from
 * success. The happy paths are covered by this module's other files; a test that
 * only exercised them would leave the defect exactly where it was.
 *
 * The bundle is the module's **shipped** `en.json` rather than a
 * `passthroughBundle`, because one of the two sentences is a key this repair
 * added: a passthrough would render the key name and pass over a string that
 * never travelled.
 */

const listTemplates = vi.fn();
const channelList = vi.fn();
const channelGetByCode = vi.fn();

vi.mock('../../../../packages/modules/product_feeds/src/admin/api', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../packages/modules/product_feeds/src/admin/api')
  >('../../../../packages/modules/product_feeds/src/admin/api');
  return {
    ...actual,
    productFeedsClient: { ...actual.productFeedsClient, listTemplates: () => listTemplates() },
    feedSalesChannelReads: {
      list: (pageSize: number) => channelList(pageSize),
      getByCode: (code: string) => channelGetByCode(code),
    },
  };
});

/**
 * The channel picker is replaced by a button that reports one id.
 *
 * The real `SalesChannelPicker` is a `Combobox` over its own `apiClient` read,
 * and driving it would put a second, unrelated transport between this file and
 * the effect it is about. What this test needs from it is the one thing its
 * contract promises: `onChange(id)`.
 */
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    SalesChannelPicker: ({ onChange }: { onChange: (id: string) => void }): ReactNode => (
      <button type="button" onClick={() => onChange('channel-1')}>
        pick-channel
      </button>
    ),
  };
});

const EN = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../packages/modules/product_feeds/i18n/en.json'),
    'utf8',
  ),
) as Record<string, string>;

const bundle = { product_feeds: EN };

/**
 * A key read out of the shipped bundle, and a sentinel for one that is not
 * there. A bare `EN[key]` is `string | undefined`, and `undefined` handed to a
 * matcher is the same failure this whole file is about — an absence standing in
 * for a value nobody looked at.
 */
const MISSING: string[] = [];
const copy = (key: string): string => {
  const value = EN[key];
  if (value === undefined) {
    MISSING.push(key);
    return `«product_feeds is missing ${key}»`;
  }
  return value;
};

const TEMPLATES_LOAD_FAILED = copy('templates.loadFailed');
const CHANNEL_LOAD_FAILED = copy('feeds.create.channelLoadFailed');

const { ProductFeedCreatePage } = await import(
  '../../../../packages/modules/product_feeds/src/admin/pages/ProductFeedCreatePage'
);

function renderPage(): void {
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={['/product-feeds/new']}>
        <ProductFeedCreatePage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['product_feeds', 'sales_channels'] }),
      },
    ),
    bundle,
  );
}

async function apiError(status: number, message: string): Promise<Error> {
  const { ApiError } = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return new ApiError(status, {
    error: { code: 'INTERNAL', message, requestId: 'r' },
  } as never) as Error;
}

beforeEach(() => {
  listTemplates.mockReset();
  channelList.mockReset();
  channelGetByCode.mockReset();
  listTemplates.mockResolvedValue({ data: [] });
  channelList.mockResolvedValue({ items: [] });
});

describe('ProductFeedCreatePage — the sentences it now renders are in the shipped bundle', () => {
  it('finds every key this file asserts on', () => {
    expect(MISSING).toEqual([]);
  });
});

describe('ProductFeedCreatePage — a failed template load is not an empty shelf', () => {
  it('renders the server’s own sentence when the templates read fails', async () => {
    listTemplates.mockRejectedValue(await apiError(500, 'The template store is unavailable'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The template store is unavailable');
  });

  it('renders this module’s own sentence when the failure carries no envelope', async () => {
    listTemplates.mockRejectedValue(new Error('network'));

    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(TEMPLATES_LOAD_FAILED);
  });

  it('renders no alert at all when the read succeeds and the shelf is genuinely empty', async () => {
    // The control that makes the two cases above mean something: an empty
    // template list is not, on its own, enough to produce a message.
    listTemplates.mockResolvedValue({ data: [] });

    renderPage();

    await waitFor(() => expect(listTemplates).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ProductFeedCreatePage — a failed channel resolution is not a channel without languages', () => {
  it('says the channel could not be read instead of leaving the language list empty', async () => {
    channelList.mockRejectedValue(new Error('network'));

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'pick-channel' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(CHANNEL_LOAD_FAILED);
  });

  it('reports the detail read’s failure too, not only the list’s', async () => {
    channelList.mockResolvedValue({ items: [{ id: 'channel-1', code: 'main' }] });
    channelGetByCode.mockRejectedValue(await apiError(503, 'Sales channels are unavailable'));

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'pick-channel' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sales channels are unavailable');
  });
});
