import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 163 (FR-018, T155 finding §1.5c) — the operator names the sales
 * channel a quote request is raised on. The choices are exactly what the API
 * accepts (security review M1, `422 RFQ_SALES_CHANNEL_NOT_ALLOWED`): the
 * customer's Organization's own active channels — never another active channel,
 * nor the system default, when it has none. One is preselected when it is the
 * only one, else the operator must choose; with none, the screen says so and
 * nothing can be sent. The channel is sent as `salesChannelId`, and the lines
 * the answer warns about (`PRODUCT_UNAVAILABLE_IN_SCOPE`) are named before the
 * operator leaves the screen. When the Organization's channels cannot be read,
 * the screen says so with a retry and nothing can be sent: the server checks
 * the channel even when none is named (owner decision 2026-10-29 "A").
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
/** The quote-request creations posted (the price explanation posts too, feature 160). */
const creates = () => postSpy.mock.calls.filter(([path]) => path === '/api/v1/admin/quote-requests');
const navigateSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...a: unknown[]) => getSpy(...a),
      post: (...a: unknown[]) => postSpy(...a),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

const { RfqCreatePage } = await import(
  '../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage'
);

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationId: ORGANIZATION_ID,
  organizationName: 'Acme',
};
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', type: 'simple', name: 'Widget' };

const BUNDLE = passthroughBundle('core', [
  'rfqCreate.submit',
  'rfqCreate.back',
  'common.action.back',
  'rfqCreate.items.quickSearch',
  'rfqCreate.field.agreedUnitPrice',
  'rfqCreate.field.salesChannel',
  'rfqCreate.gate.missingChannel',
  'rfqCreate.noChannelWarning',
  'rfqCreate.channelsLoadError',
  'common.action.retry',
  'rfqCreate.warnings.title',
  'rfqCreate.warnings.open',
]);

const B2B = '00000000-0000-4000-8000-0000000000c1';
const B2C = '00000000-0000-4000-8000-0000000000c2';
const INACTIVE = '00000000-0000-4000-8000-0000000000c3';
const OPTIONS = [
  { id: B2B, code: 'b2b', name: { 'en-US': 'Wholesale' }, active: true, systemDefault: true },
  { id: B2C, code: 'b2c', name: { 'en-US': 'Retail', 'pl-PL': 'Detal' }, active: true, systemDefault: false },
  { id: INACTIVE, code: 'old', name: { 'en-US': 'Outlet' }, active: false, systemDefault: false },
];
let assigned: string[] | null = [B2C];

beforeEach(() => {
  assigned = [B2C];
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    if (path === `/api/v1/admin/organizations/${ORGANIZATION_ID}/sales-channels`) {
      return assigned === null
        ? Promise.reject(new Error('forbidden'))
        : Promise.resolve({ data: { organizationId: ORGANIZATION_ID, assignedSalesChannelIds: assigned, options: OPTIONS } });
    }
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/api/v1/admin/price-books/resolve'
        ? { data: [{ key: 'line', price: { amount: '10.00', currency: 'PLN', source: 'base' } }] }
        : { data: { id: 'new-rfq-1' } },
    ),
  );
});

async function pick(comboLabel: string, optionLabel: string): Promise<void> {
  await userEvent.click(screen.getByLabelText(comboLabel));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(optionLabel) }));
}

function page(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return withSession(
    <MemoryRouter initialEntries={[`/quote-requests/new${query ? `?${query}` : ''}`]}>
      <RfqCreatePage />
    </MemoryRouter>,
    {
      session: adminSession({ permissions: ['*'] }),
      presence: modulePresence({ present: ['quote_requests'] }),
    },
  );
}

function renderPage(params: Record<string, string> = {}, language: 'en' | 'pl' = 'en'): void {
  renderWithI18n(page(params), BUNDLE, { language });
}

/** One priced line, added through the quick search (feature 145), then submit. */
async function addLineAndSubmit(): Promise<void> {
  const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
  await userEvent.type(quick, 'Wid');
  await userEvent.click(await screen.findByRole('option', { name: /Widget/ }));
  await waitFor(() =>
    expect(screen.getByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' })).toHaveValue(10),
  );
  const submit = screen.getByText('rfqCreate.submit');
  await waitFor(() => expect(submit).not.toBeDisabled());
  await userEvent.click(submit);
}

async function addLine(): Promise<void> {
  const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
  await userEvent.type(quick, 'Wid');
  await userEvent.click(await screen.findByRole('option', { name: /Widget/ }));
  await waitFor(() =>
    expect(screen.getByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' })).toHaveValue(10),
  );
}

/** The price-prefill questions asked so far. */
const resolves = () => postSpy.mock.calls.filter(([path]) => path === '/api/v1/admin/price-books/resolve');

/**
 * One line added while no channel is settled: it stays unpriced, and no price is
 * asked without a channel (owner decision 2026-10-29 "A" — a channel-less
 * request is never sent, so a channel-less price would answer nothing).
 */
async function addUnpricedLine(): Promise<void> {
  const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
  await userEvent.type(quick, 'Wid');
  await userEvent.click(await screen.findByRole('option', { name: /Widget/ }));
  const price = await screen.findByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' });
  expect(price).toHaveValue(null);
  expect(resolves()).toHaveLength(0);
}

const priceOfWidget = () => screen.getByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' });

const openForCustomer = (): void => renderPage({ customerAccountId: 'cust-1', organizationId: ORGANIZATION_ID });

describe('RfqCreatePage — the sales channel', () => {
  it('preselects the Organization’s only channel and sends it', async () => {
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    await addLineAndSubmit();
    expect(creates()[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it('prefills the agreed prices on the chosen channel', async () => {
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    await addLine();
    const resolves = postSpy.mock.calls.filter(([path]) => path === '/api/v1/admin/price-books/resolve');
    expect(resolves.at(-1)?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it('asks the operator to choose when the Organization shops on several channels', async () => {
    assigned = [B2B, B2C];
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue(''));
    await addUnpricedLine();
    const submit = screen.getByText('rfqCreate.submit');
    expect(submit).toBeDisabled();
    // The disabled action says why (the order create screen's gate hint).
    expect(screen.getByText('rfqCreate.gate.missingChannel')).toBeInTheDocument();
    await pick('rfqCreate.field.salesChannel', 'Wholesale');
    await waitFor(() => expect(priceOfWidget()).toHaveValue(10));
    expect(resolves().every(([, body]) => (body as { salesChannelId?: string }).salesChannelId === B2B)).toBe(true);
    await waitFor(() => expect(submit).not.toBeDisabled());
    expect(screen.queryByText('rfqCreate.gate.missingChannel')).toBeNull();
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]?.[1]).toMatchObject({ salesChannelId: B2B });
  });

  it('names the lines unavailable on the channel before leaving the screen', async () => {
    postSpy.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/api/v1/admin/price-books/resolve'
          ? { data: [{ key: 'line', price: { amount: '10.00', currency: 'PLN', source: 'base' } }] }
          : { data: { id: 'new-rfq-1' }, warnings: [{ productId: 'prod-1', code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }] },
      ),
    );
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    await addLineAndSubmit();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('rfqCreate.warnings.title');
    expect(alert).toHaveTextContent('Widget');
    expect(navigateSpy).not.toHaveBeenCalled();
    // The request exists: it cannot be sent a second time.
    expect(screen.queryByText('rfqCreate.submit')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'rfqCreate.warnings.open' }));
    expect(navigateSpy).toHaveBeenCalledWith('/quote-requests/new-rfq-1');
  });

  it('offers only the Organization’s active channels: never an inactive one of its own', async () => {
    assigned = [INACTIVE, B2C];
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    await userEvent.click(screen.getByLabelText('rfqCreate.field.salesChannel'));
    const offered = (await screen.findAllByRole('option')).map((o) => o.textContent ?? '');
    expect(offered.some((label) => label.includes('Retail'))).toBe(true);
    expect(offered.some((label) => label.includes('Outlet') || label.includes('Wholesale'))).toBe(false);
  });

  it.each([
    ['no channel at all', [] as string[]],
    ['only an inactive channel', [INACTIVE]],
  ])(
    'says so, offers nothing and sends nothing when the Organization has %s — not even the system default',
    async (_what, channels) => {
      assigned = channels;
      openForCustomer();
      expect(await screen.findByText('rfqCreate.noChannelWarning')).toBeInTheDocument();
      expect(screen.queryByLabelText('rfqCreate.field.salesChannel')).toBeNull();
      // Nothing to choose: the generic "choose a channel" hint would be wrong.
      expect(screen.queryByText('rfqCreate.gate.missingChannel')).toBeNull();
      await addUnpricedLine();
      const submit = screen.getByText('rfqCreate.submit');
      expect(submit).toBeDisabled();
      await userEvent.click(submit);
      expect(creates()).toHaveLength(0);
    },
  );

  it('names the channel in the admin language', async () => {
    renderPage({ customerAccountId: 'cust-1', organizationId: ORGANIZATION_ID }, 'pl');
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Detal'));
  });

  it('keeps Create disabled while the Organization’s channels are still being read', async () => {
    let answer: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      answer = resolve;
    });
    const read = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === `/api/v1/admin/organizations/${ORGANIZATION_ID}/sales-channels` ? pending : read(path),
    );
    openForCustomer();
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await addUnpricedLine();
    const submit = screen.getByText('rfqCreate.submit');
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(creates()).toHaveLength(0);
    answer({ data: { organizationId: ORGANIZATION_ID, assignedSalesChannelIds: [B2C], options: OPTIONS } });
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    await waitFor(() => expect(priceOfWidget()).toHaveValue(10));
    // Asked once, on the channel — never first without one.
    expect(resolves()).toHaveLength(1);
    expect(resolves()[0]?.[1]).toMatchObject({ salesChannelId: B2C });
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });

  it('says the channels cannot be read, keeps Create disabled and offers a retry that recovers', async () => {
    // Owner decision 2026-10-29 "A": the server checks the channel either way, so
    // a request sent without one is refused unless the system default happens to
    // be the Organization's — the screen does not send one blind.
    assigned = null;
    openForCustomer();
    expect(await screen.findByText('rfqCreate.channelsLoadError')).toBeInTheDocument();
    expect(screen.queryByLabelText('rfqCreate.field.salesChannel')).toBeNull();
    // Nothing to choose yet: the generic "choose a channel" hint would be wrong.
    expect(screen.queryByText('rfqCreate.gate.missingChannel')).toBeNull();
    await addUnpricedLine();
    const submit = screen.getByText('rfqCreate.submit');
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(creates()).toHaveLength(0);

    // The retry is held open: the alert stays and its button goes inert meanwhile.
    let answer: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      answer = resolve;
    });
    const read = getSpy.getMockImplementation()!;
    getSpy.mockImplementation((path: string) =>
      path === `/api/v1/admin/organizations/${ORGANIZATION_ID}/sales-channels` ? pending : read(path),
    );
    const retry = screen.getByRole('button', { name: 'common.action.retry' });
    await userEvent.click(retry);
    await waitFor(() => expect(retry).toBeDisabled());
    expect(screen.getByText('rfqCreate.channelsLoadError')).toBeInTheDocument();
    expect(submit).toBeDisabled();

    answer({ data: { organizationId: ORGANIZATION_ID, assignedSalesChannelIds: [B2C], options: OPTIONS } });
    await waitFor(() => expect(screen.getByLabelText('rfqCreate.field.salesChannel')).toHaveValue('Retail'));
    expect(screen.queryByText('rfqCreate.channelsLoadError')).toBeNull();
    await waitFor(() => expect(priceOfWidget()).toHaveValue(10));
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]?.[1]).toMatchObject({ salesChannelId: B2C });
  });
});
