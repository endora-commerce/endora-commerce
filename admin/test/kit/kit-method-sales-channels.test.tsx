import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * The sales-channel field and cell the two method screens share
 * (`@endora-commerce/admin-kit/components`).
 *
 * For a method an **empty** selection means "every channel", the opposite of
 * what an empty multi-select usually says, so most of this file is about what
 * the operator is told in each state — and about the one thing the field must
 * never do: let an unloaded list turn into "every channel" on save.
 *
 * `apiClient` is mocked on the kit's `lib` barrel, the seam
 * `kit-pickers.test.tsx` documents.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const {
  MethodSalesChannelsCell,
  MethodSalesChannelsField,
  salesChannelIdsToSubmit,
  useSalesChannelOptions,
} = await import('@endora-commerce/admin-kit/components');

const CHANNEL_A = '00000000-0000-4000-8000-0000000000a1';
const CHANNEL_B = '00000000-0000-4000-8000-0000000000b1';
const CHANNEL_C = '00000000-0000-4000-8000-0000000000c1';

function channel(id: string, code: string, name: string, active = true): Record<string, unknown> {
  return {
    id,
    code,
    name: { 'en-US': name },
    active,
    systemDefault: code === 'default',
    defaultLanguage: 'en-US',
    defaultCurrency: 'PLN',
    themeCode: null,
    logoAssetId: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const CHANNELS = {
  items: [
    channel(CHANNEL_A, 'default', 'Default shop'),
    channel(CHANNEL_B, 'b2b-eu', 'B2B Europe'),
    channel(CHANNEL_C, 'old', 'Old shop', false),
  ],
  page: 0,
  pageSize: 200,
  total: 3,
};

/** Real sentences for the keys whose parameters a case reads back. */
const BUNDLE = {
  core: {
    'methodSalesChannels.all': 'All channels',
    'methodSalesChannels.column': 'Sales channels',
    'methodSalesChannels.count': '{count} selected',
    'methodSalesChannels.helpAll': 'Offered in every sales channel.',
    'methodSalesChannels.helpSelected': 'Offered only in: {channels}.',
    'methodSalesChannels.inactiveOption': '{channel} (inactive)',
    'methodSalesChannels.label': 'Sales channels',
    'methodSalesChannels.loadError': 'The sales channels could not be loaded.',
    'methodSalesChannels.loading': 'Loading sales channels…',
    'methodSalesChannels.retry': 'Try again',
    'methodSalesChannels.search': 'Search sales channels…',
    'methodSalesChannels.unlisted': '{count} more',
  },
};

/** The field as a screen mounts it, reporting what a save would send. */
function Harness({ initial, onState }: { initial: string[]; onState: (v: unknown) => void }): ReactNode {
  const options = useSalesChannelOptions(true);
  const [value, setValue] = useState(initial);
  onState({ status: options.status, submit: salesChannelIdsToSubmit(options, value) });
  return (
    <>
      <MethodSalesChannelsField options={options} value={value} onChange={setValue} />
      <MethodSalesChannelsCell options={options} salesChannelIds={value} />
    </>
  );
}

function mount(initial: string[]): { last: () => { status: string; submit: string[] | undefined } } {
  let state: { status: string; submit: string[] | undefined } = {
    status: 'loading',
    submit: undefined,
  };
  renderWithI18n(
    <Harness
      initial={initial}
      onState={(v): void => {
        state = v as typeof state;
      }}
    />,
    BUNDLE,
  );
  return { last: () => state };
}

beforeEach(() => {
  getSpy.mockReset();
});

describe('MethodSalesChannelsField', () => {
  it('asks for every channel of the instance, inactive ones included', async () => {
    getSpy.mockResolvedValue(CHANNELS);
    mount([]);

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(1));
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/sales-channels?pageSize=200');
  });

  it('says "All channels" for an empty selection, and that a save sends the empty set', async () => {
    getSpy.mockResolvedValue(CHANNELS);
    const view = mount([]);

    const trigger = await screen.findByRole('button', { name: 'Sales channels' });
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(trigger).toHaveTextContent('All channels');
    expect(screen.getByRole('status')).toHaveTextContent('Offered in every sales channel.');
    // The list cell agrees with the field.
    expect(screen.getAllByText('All channels').length).toBeGreaterThanOrEqual(2);
    expect(view.last().submit).toEqual([]);
  });

  it('names the selected channels in words, and marks an inactive one', async () => {
    getSpy.mockResolvedValue(CHANNELS);
    const view = mount([CHANNEL_B, CHANNEL_C]);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Offered only in: B2B Europe, Old shop (inactive).',
      ),
    );
    // Not "All channels": the trigger must not go on claiming the empty state.
    expect(screen.getByRole('button', { name: 'Sales channels' })).not.toHaveTextContent(
      'All channels',
    );
    expect(view.last().submit).toEqual([CHANNEL_B, CHANNEL_C]);
  });

  it('adds and removes a channel with the keyboard-reachable checkboxes', async () => {
    getSpy.mockResolvedValue(CHANNELS);
    const view = mount([CHANNEL_A]);
    const user = userEvent.setup();

    const trigger = await screen.findByRole('button', { name: 'Sales channels' });
    await waitFor(() => expect(trigger).toBeEnabled());
    await user.click(trigger);
    await user.click(screen.getByRole('checkbox', { name: 'B2B Europe' }));

    expect(view.last().submit).toEqual([CHANNEL_A, CHANNEL_B]);

    await user.click(screen.getByRole('checkbox', { name: 'Default shop' }));
    await user.click(screen.getByRole('checkbox', { name: 'B2B Europe' }));

    // Back to nothing ticked: every channel, said in both places.
    expect(view.last().submit).toEqual([]);
    expect(screen.getByRole('status')).toHaveTextContent('Offered in every sales channel.');
  });

  it('keeps an assigned channel the loaded list does not contain', async () => {
    getSpy.mockResolvedValue({ ...CHANNELS, items: CHANNELS.items.slice(0, 1) });
    const view = mount([CHANNEL_A, CHANNEL_B]);
    const user = userEvent.setup();

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Offered only in: Default shop, 1 more.'),
    );
    await user.click(screen.getByRole('button', { name: 'Sales channels' }));
    await user.click(screen.getByRole('checkbox', { name: 'Default shop' }));

    // Unticking the one listed channel must not drop the unlisted one.
    expect(view.last().submit).toEqual([CHANNEL_B]);
  });

  it('is disabled and announces loading until the list arrives, and a save omits the field', async () => {
    let resolve: (v: unknown) => void = () => {};
    getSpy.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const view = mount([CHANNEL_A]);

    const trigger = screen.getByRole('button', { name: 'Sales channels' });
    expect(trigger).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading sales channels…');
    expect(view.last().submit).toBeUndefined();

    resolve(CHANNELS);
    await waitFor(() => expect(trigger).toBeEnabled());
    expect(view.last().submit).toEqual([CHANNEL_A]);
  });

  /**
   * The state that must not fail open. With the list unavailable the form's
   * value is whatever it started as — `[]` on a new method — and sending that
   * would be read by the API as "every channel".
   */
  it('on a failed load explains, offers a retry, and makes a save omit the field', async () => {
    getSpy.mockRejectedValueOnce(new Error('503'));
    const view = mount([]);
    const user = userEvent.setup();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The sales channels could not be loaded.');
    expect(screen.queryByRole('button', { name: 'Sales channels' })).not.toBeInTheDocument();
    expect(view.last().submit).toBeUndefined();

    getSpy.mockResolvedValue(CHANNELS);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sales channels' })).toBeEnabled(),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.last().submit).toEqual([]);
  });
});

describe('MethodSalesChannelsCell', () => {
  it('lists the channels by name once they are known', async () => {
    getSpy.mockResolvedValue(CHANNELS);
    mount([CHANNEL_A, CHANNEL_C]);

    const list = await screen.findByRole('list');
    expect(list).toHaveTextContent('Default shop');
    expect(list).toHaveTextContent('Old shop (inactive)');
  });

  it('shows a count rather than raw ids while the names are unavailable', async () => {
    getSpy.mockRejectedValue(new Error('403'));
    mount([CHANNEL_A, CHANNEL_B]);

    await screen.findByRole('alert');
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });
});
