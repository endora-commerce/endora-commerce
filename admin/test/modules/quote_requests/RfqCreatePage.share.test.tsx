import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import { ORGANIZATION_CHANNEL_ID, organizationSalesChannelsAnswer } from '../../helpers/organization-sales-channels';

/**
 * `specs/192-quote-request-draft-share/` T041, T042 (US2, US3; FR-013, FR-020,
 * FR-031) — the create screen makes a quote the customer cannot see yet.
 * *Save as draft* creates it; *Create and share* creates it and then shares it
 * with `If-Match` = the version the create answered, and stops before sharing
 * when the create warns. The validity field is prefilled from the store's
 * default, counted from sharing. The bundles are the shipped English ones.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
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

const { RfqCreatePage } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage');

function bundle(module: string): Record<string, string> {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/${module}/i18n/en.json`), 'utf8'),
  ) as Record<string, string>;
}
const CORE_EN = bundle('_i18n');
const QUOTE_EN = bundle('quote_requests');
const core = (key: string): string => {
  const value = CORE_EN[key];
  if (value === undefined) throw new Error(`no core key ${key}`);
  return value;
};
const quote = (key: string): string => {
  const value = QUOTE_EN[key];
  if (value === undefined) throw new Error(`no quote_requests key ${key}`);
  return value;
};

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const NEW_ID = '00000000-0000-4000-8000-0000000000n1';
const CREATE = '/api/v1/admin/quote-requests';
const DEFAULTS = '/api/v1/admin/quote-requests/create-defaults';
const SHARE = `/api/v1/admin/quote-requests/${NEW_ID}/share`;
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationId: ORGANIZATION_ID,
  organizationName: 'Acme',
};
const PRODUCT = { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', type: 'simple', name: 'Widget' };

/** What the next defaults read answers: days, `null`, or a failure. */
let defaults: { validityDays: number | null } | 'fail' = { validityDays: 30 };
/** The price the customer's price book answers for a new line; `null` = none. */
let resolvedPrice: string | null = '10.00';
/** What the create answers. */
let createAnswer: Record<string, unknown> = { data: { id: NEW_ID, version: 1 } };
/** What the share answers: a reply, or an error to throw. */
let shareAnswer: unknown = { data: { id: NEW_ID, sharedWithCustomer: true, version: 2 } };

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  defaults = { validityDays: 30 };
  resolvedPrice = '10.00';
  createAnswer = { data: { id: NEW_ID, version: 1 } };
  shareAnswer = { data: { id: NEW_ID, sharedWithCustomer: true, version: 2 } };
  getSpy.mockImplementation((path: string) => {
    if (path === DEFAULTS) {
      return defaults === 'fail' ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve({ data: defaults });
    }
    const channels = organizationSalesChannelsAnswer(path);
    if (channels) return channels;
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) return Promise.resolve({ data: [PRODUCT] });
    return Promise.resolve({ data: [] });
  });
  postSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/price-books/resolve') {
      return Promise.resolve({
        data: [{ key: 'line', price: resolvedPrice === null ? null : { amount: resolvedPrice, currency: 'PLN', source: 'base' } }],
      });
    }
    if (path === CREATE) return Promise.resolve(createAnswer);
    if (path === SHARE) return shareAnswer instanceof Error ? Promise.reject(shareAnswer) : Promise.resolve(shareAnswer);
    return Promise.resolve({ data: {} });
  });
});

function renderPage(params: Record<string, string> = { customerAccountId: 'cust-1' }): void {
  const query = new URLSearchParams(params).toString();
  renderWithI18n(
    withSession(
      <MemoryRouter initialEntries={[`/quote-requests/new${query ? `?${query}` : ''}`]}>
        <RfqCreatePage />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), presence: modulePresence({ present: ['quote_requests'] }) },
    ),
    { core: CORE_EN, quote_requests: QUOTE_EN },
  );
}

const daysField = (): HTMLInputElement => screen.getByLabelText(quote('validity.unshared.field')) as HTMLInputElement;
const saveButton = (): HTMLElement => screen.getByRole('button', { name: core('rfqCreate.submit') });
const shareButton = (): HTMLElement => screen.getByRole('button', { name: quote('create.share') });
const priceInput = (): HTMLInputElement =>
  screen.getByRole('spinbutton', { name: `${core('rfqCreate.field.agreedUnitPrice')} Widget` }) as HTMLInputElement;
const creates = (): Array<Record<string, unknown>> =>
  postSpy.mock.calls.filter(([path]) => path === CREATE).map(([, body]) => body as Record<string, unknown>);
const shares = (): unknown[][] => postSpy.mock.calls.filter(([path]) => path === SHARE);

async function addLine(): Promise<void> {
  const quick = await screen.findByRole('combobox', { name: core('rfqCreate.items.quickSearch') });
  await userEvent.type(quick, 'Wid');
  await userEvent.click(await screen.findByRole('option', { name: /Widget/ }));
  await screen.findByText('Widget', { selector: '[data-line-name]' });
  if (resolvedPrice !== null) await waitFor(() => expect(priceInput()).toHaveValue(Number(resolvedPrice)));
}

async function ready(): Promise<void> {
  renderPage();
  await addLine();
  await waitFor(() => expect(saveButton()).toBeEnabled());
}

describe('RfqCreatePage — validity from the store default (T041, FR-031)', () => {
  it('prefills the default days and says they count from sharing; untouched sends them', async () => {
    await ready();
    await waitFor(() => expect(daysField()).toHaveValue(30));
    expect(daysField()).toHaveAccessibleDescription(quote('create.validity.hint'));

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).toMatchObject({ expiresInDays: 30 });
  });

  it('leaves the field empty for a default of no deadline, and sends nothing', async () => {
    defaults = { validityDays: null };
    await ready();
    await waitFor(() => expect(getSpy).toHaveBeenCalledWith(DEFAULTS));
    expect(daysField()).toHaveValue(null);

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).not.toHaveProperty('expiresInDays');
  });

  it('sends null once the operator clears the prefilled days', async () => {
    await ready();
    await waitFor(() => expect(daysField()).toHaveValue(30));
    await userEvent.clear(daysField());

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).toMatchObject({ expiresInDays: null });
  });

  it('sends the days the operator typed', async () => {
    await ready();
    await waitFor(() => expect(daysField()).toHaveValue(30));
    await userEvent.clear(daysField());
    await userEvent.type(daysField(), '45');

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).toMatchObject({ expiresInDays: 45 });
  });

  it('a failed defaults read leaves the field empty, the screen usable, and the default to the server', async () => {
    defaults = 'fail';
    await ready();
    expect(daysField()).toHaveValue(null);

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).not.toHaveProperty('expiresInDays');
  });

  it('refuses more days than 3650, said at the field, and sends nothing', async () => {
    await ready();
    await waitFor(() => expect(daysField()).toHaveValue(30));
    await userEvent.clear(daysField());
    await userEvent.type(daysField(), '3651');

    expect(daysField()).toHaveAttribute('aria-invalid', 'true');
    expect(daysField()).toHaveAccessibleDescription(core('rfq.detail.validity.error.days'));
    expect(saveButton()).toBeDisabled();
    expect(shareButton()).toBeDisabled();
  });
});

describe('RfqCreatePage — Save as draft and Create and share (T042, FR-020)', () => {
  it('Save as draft creates and lands on the quote, sharing nothing', async () => {
    await ready();
    await userEvent.click(saveButton());

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/quote-requests/${NEW_ID}`));
    expect(shares()).toHaveLength(0);
  });

  it('Create and share asks first, naming the customer and the validity; No creates nothing', async () => {
    await ready();
    await waitFor(() => expect(daysField()).toHaveValue(30));
    await userEvent.click(shareButton());

    const dialog = await answerConfirm(false);
    expect(dialog).toHaveTextContent('Jan Kowalski');
    expect(dialog).toHaveTextContent('valid for 30 days');
    expect(creates()).toHaveLength(0);
  });

  it('Create and share creates, shares with If-Match = the created version, and lands on the shared quote', async () => {
    await ready();
    await userEvent.click(shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/quote-requests/${NEW_ID}`));
    expect(creates()).toHaveLength(1);
    expect(shares()).toEqual([[SHARE, {}, { headers: { 'If-Match': '"1"' } }]]);
    // Create first, then share.
    const order = postSpy.mock.calls.map(([path]) => path).filter((path) => path === CREATE || path === SHARE);
    expect(order).toEqual([CREATE, SHARE]);
  });

  it('keeps the opener\'s way back after a successful share', async () => {
    const RETURN_TO = '/crm/opportunities/00000000-0000-4000-8000-0000000000b1';
    renderPage({ customerAccountId: 'cust-1', returnTo: RETURN_TO });
    await addLine();
    await waitFor(() => expect(shareButton()).toBeEnabled());
    await userEvent.click(shareButton());
    await answerConfirm(true);

    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith(RETURN_TO, { state: { createdDocument: { id: NEW_ID } } }),
    );
  });

  it('a refused share lands on the draft with the refusal, keeping the way back (US2 #7)', async () => {
    const RETURN_TO = '/crm/opportunities/00000000-0000-4000-8000-0000000000b1';
    shareAnswer = new ApiError(409, {
      error: { code: 'RFQ_SHARE_CUSTOMER_UNAVAILABLE', message: "This quote cannot be shared: its customer's account is blocked.", details: { code: 'blocked' } },
    } as never);
    renderPage({ customerAccountId: 'cust-1', returnTo: RETURN_TO });
    await addLine();
    await waitFor(() => expect(shareButton()).toBeEnabled());
    await userEvent.click(shareButton());
    await answerConfirm(true);

    await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
    const [target, options] = navigateSpy.mock.calls[0] as [string, { state: unknown }];
    expect(target).toBe(`/quote-requests/${NEW_ID}?returnTo=${encodeURIComponent(RETURN_TO)}`);
    expect(options.state).toEqual({
      shareRefusal: {
        code: 'RFQ_SHARE_CUSTOMER_UNAVAILABLE',
        message: "This quote cannot be shared: its customer's account is blocked.",
        lines: [],
      },
    });
    // One create: a refused share never creates a second quote.
    expect(creates()).toHaveLength(1);
  });

  it('create warnings stop before the share: the draft stays, the warnings are shown with Open draft and Share (US2 #8)', async () => {
    createAnswer = {
      data: { id: NEW_ID, version: 1 },
      warnings: [{ productId: 'prod-1', code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }],
    };
    await ready();
    await userEvent.click(shareButton());
    await answerConfirm(true);

    const alert = (await screen.findByText(core('rfqCreate.warnings.title'))).closest<HTMLElement>('[role="alert"]')!;
    expect(alert).toHaveTextContent(quote('create.warnings.notShared'));
    expect(within(alert).getByText('Widget')).toBeInTheDocument();
    expect(shares()).toHaveLength(0);
    expect(navigateSpy).not.toHaveBeenCalled();
    // Neither create action is offered again: the quote exists.
    expect(screen.queryByRole('button', { name: core('rfqCreate.submit') })).toBeNull();
    expect(screen.queryByRole('button', { name: quote('create.share') })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: core('rfqCreate.warnings.open') }));
    expect(navigateSpy).toHaveBeenCalledWith(`/quote-requests/${NEW_ID}`);
  });

  it('after warnings, Share with customer shares the created quote once confirmed', async () => {
    createAnswer = {
      data: { id: NEW_ID, version: 1 },
      warnings: [{ productId: 'prod-1', code: 'PRODUCT_UNAVAILABLE_IN_SCOPE' }],
    };
    await ready();
    await userEvent.click(shareButton());
    await answerConfirm(true);
    await screen.findByText(core('rfqCreate.warnings.title'));

    await userEvent.click(screen.getByRole('button', { name: quote('share.action') }));
    await answerConfirm(true);
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith(`/quote-requests/${NEW_ID}`));
    expect(shares()).toEqual([[SHARE, {}, { headers: { 'If-Match': '"1"' } }]]);
    expect(creates()).toHaveLength(1);
  });

  it('a line with no price: Save as draft sends it without a price; Create and share is disabled and says why (FR-013)', async () => {
    resolvedPrice = null;
    renderPage();
    await addLine();
    await waitFor(() => expect(saveButton()).toBeEnabled());

    expect(priceInput()).toHaveValue(null);
    expect(priceInput()).not.toHaveAttribute('aria-invalid');
    expect(shareButton()).toBeDisabled();
    expect(shareButton()).toHaveAccessibleDescription(quote('create.gate.prices'));

    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    const items = creates()[0]!['items'] as Array<Record<string, unknown>>;
    expect(items).toEqual([{ productId: 'prod-1', quantity: 1 }]);
  });

  it('a price that is not one blocks both actions', async () => {
    await ready();
    await userEvent.clear(priceInput());
    await userEvent.type(priceInput(), '-1');

    expect(priceInput()).toHaveAttribute('aria-invalid', 'true');
    expect(priceInput()).toHaveAccessibleDescription(quote('create.line.priceInvalid'));
    expect(saveButton()).toBeDisabled();
    expect(shareButton()).toBeDisabled();
  });

  it('an empty quantity still blocks both actions', async () => {
    await ready();
    const qty = screen.getByRole('textbox', { name: `${core('rfqCreate.field.quantity')} Widget` });
    await userEvent.clear(qty);

    expect(saveButton()).toBeDisabled();
    expect(shareButton()).toBeDisabled();
  });

  it('both actions are disabled while one is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    postSpy.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/price-books/resolve') {
        return Promise.resolve({ data: [{ key: 'line', price: { amount: '10.00', currency: 'PLN', source: 'base' } }] });
      }
      if (path === CREATE) return new Promise((done) => (finish = done));
      return Promise.resolve({ data: {} });
    });
    await ready();
    await userEvent.click(saveButton());

    await waitFor(() => expect(creates()).toHaveLength(1));
    const save = screen.getByRole('button', { name: core('rfqCreate.submitting') });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-busy', 'true');
    expect(shareButton()).toBeDisabled();
    finish({ data: { id: NEW_ID, version: 1 } });
    await waitFor(() => expect(navigateSpy).toHaveBeenCalled());
  });

  it('sends the channel it was given', async () => {
    await ready();
    await userEvent.click(saveButton());
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]).toMatchObject({ salesChannelId: ORGANIZATION_CHANNEL_ID });
  });
});
