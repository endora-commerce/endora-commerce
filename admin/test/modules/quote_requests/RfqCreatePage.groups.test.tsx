import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Feature 159, T032 — the create-quote-request screen groups its lines
 * (`specs/159-quote-request-item-groups/contracts/ui.md` §2): the same editor,
 * products added through a group's *Add product* land in that group and the
 * quick search adds to *Ungrouped*, and *Create* sends `groups` and each line's
 * `groupKey` in display order. Without a group the request is the one it was.
 *
 * The product browser dialog is a stub here: it is the kit's, tested there,
 * and this file is about where its products land.
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

const PRODUCTS = [
  { id: 'prod-1', sku: 'SKU-1', slug: 'p1', status: 'active', type: 'simple', name: { 'en-US': 'Widget' } },
  { id: 'prod-2', sku: 'SKU-2', slug: 'p2', status: 'active', type: 'simple', name: { 'en-US': 'Gadget' } },
  { id: 'prod-3', sku: 'SKU-3', slug: 'p3', status: 'active', type: 'simple', name: { 'en-US': 'Sprocket' } },
];

vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return {
    ...actual,
    ProductBrowserDialog: (props: { open: boolean; onConfirm: (items: unknown[]) => void }) =>
      props.open ? (
        <div role="dialog" aria-label="browser">
          <button type="button" onClick={() => props.onConfirm([PRODUCTS[2]])}>
            confirm-sprocket
          </button>
        </div>
      ) : null,
  };
});

const { RfqCreatePage } = await import(
  '../../../../packages/modules/quote_requests/src/admin/pages/RfqCreatePage'
);

const REPO_ROOT = resolve(process.cwd(), '..');
const QR_EN = JSON.parse(
  readFileSync(join(REPO_ROOT, 'packages/modules/quote_requests/i18n/en.json'), 'utf8'),
) as Record<string, string>;

const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER = {
  id: 'cust-1',
  email: 'jan@acme.test',
  firstName: 'Jan',
  lastName: 'Kowalski',
  organizationId: ORGANIZATION_ID,
  organizationName: 'Acme',
};

const BUNDLE = {
  ...passthroughBundle('core', [
    'rfqCreate.submit',
    'rfqCreate.items.quickSearch',
    'rfqCreate.field.agreedUnitPrice',
    'rfqCreate.field.quantity',
  ]),
  quote_requests: QR_EN,
};

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  navigateSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/customers/cust-1') return Promise.resolve({ data: CUSTOMER });
    if (path.startsWith('/api/v1/admin/customers')) return Promise.resolve({ data: [CUSTOMER] });
    if (path.startsWith('/api/v1/admin/catalog/products')) {
      const q = new URLSearchParams(path.split('?')[1] ?? '').get('q') ?? '';
      return Promise.resolve({
        data: PRODUCTS.filter((p) => p.name['en-US'].toLowerCase().startsWith(q.toLowerCase())),
      });
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

function renderPage(): void {
  renderWithI18n(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/quote-requests/new?customerAccountId=cust-1']}>
          <RfqCreatePage />
        </MemoryRouter>,
        {
          session: adminSession({ permissions: ['*'] }),
          presence: modulePresence({ present: ['quote_requests'] }),
        },
      )}
    </StrictMode>,
    BUNDLE,
  );
}

async function quickAdd(name: string): Promise<void> {
  const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
  await userEvent.clear(quick);
  await userEvent.type(quick, name.slice(0, 3));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
  await waitFor(() =>
    expect(screen.getByRole('spinbutton', { name: `rfqCreate.field.agreedUnitPrice ${name}` })).toHaveValue(10),
  );
}

const rowgroup = (name: string): HTMLElement => screen.getByRole('rowgroup', { name });

describe('RfqCreatePage — groups (T032)', () => {
  it('groups lines, adds through a group’s Add product into that group, and sends groups and groupKey in display order', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await quickAdd('Widget');
    await quickAdd('Gadget');

    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'Hall A');
    // The quick search still adds to Ungrouped; the menu moves Gadget into Hall A.
    await userEvent.click(screen.getByRole('button', { name: 'Move Gadget to group' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hall A' }));
    // A group's Add product opens the browser and lands its products in that group.
    await userEvent.click(within(rowgroup('Hall A')).getByRole('button', { name: 'Add product' }));
    await userEvent.click(await screen.findByRole('button', { name: 'confirm-sprocket' }));
    await waitFor(() => expect(within(rowgroup('Hall A')).getByText('Sprocket')).toBeInTheDocument());
    expect(within(rowgroup('Ungrouped')).getByText('Widget')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Sprocket' })).toHaveValue(10),
    );
    // The section summary: two lines, 20.00 net.
    expect(rowgroup('Hall A')).toHaveTextContent('2 items · Net 20.00');

    const submit = screen.getByText('rfqCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    const [, body] = creates()[0] as [string, { groups: Array<{ key: string; name: string }>; items: Array<Record<string, unknown>> }];
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toEqual({ key: expect.any(String), name: 'Hall A' });
    expect(body.items).toEqual([
      { productId: 'prod-2', quantity: 1, agreedUnitPrice: 10, groupKey: body.groups[0]!.key },
      { productId: 'prod-3', quantity: 1, agreedUnitPrice: 10, groupKey: body.groups[0]!.key },
      { productId: 'prod-1', quantity: 1, agreedUnitPrice: 10, groupKey: null },
    ]);
  });

  it('places one product on two lines in two groups, each priced and sent on its own (N-31)', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await quickAdd('Widget');
    // The same product again is a second line — the quick search no longer refuses it.
    const quick = screen.getByRole('combobox', { name: 'rfqCreate.items.quickSearch' });
    await userEvent.clear(quick);
    await userEvent.type(quick, 'Wid');
    const option = await screen.findByRole('option', { name: /Widget/ });
    expect(option).not.toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(option);
    await waitFor(() =>
      expect(screen.getAllByRole('spinbutton', { name: 'rfqCreate.field.agreedUnitPrice Widget' })).toHaveLength(2),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Group name' }), 'Hall A');
    await userEvent.click(screen.getAllByRole('button', { name: 'Move Widget to group' })[1]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Hall A' }));
    const hallQuantity = within(rowgroup('Hall A')).getByRole('textbox', { name: 'rfqCreate.field.quantity Widget' });
    await userEvent.clear(hallQuantity);
    await userEvent.type(hallQuantity, '5');
    // Each line asks its own price, at its own quantity.
    await waitFor(() =>
      expect(
        postSpy.mock.calls.some(
          ([url, body]) =>
            url === '/api/v1/admin/price-books/resolve' &&
            (body as { lines: Array<{ quantity: number }> }).lines[0]?.quantity === 5,
        ),
      ).toBe(true),
    );
    expect(within(rowgroup('Ungrouped')).getByRole('textbox', { name: 'rfqCreate.field.quantity Widget' })).toHaveValue('1');

    const submit = screen.getByText('rfqCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    const [, body] = creates()[0] as [string, { groups: Array<{ key: string }>; items: Array<Record<string, unknown>> }];
    expect(body.items).toEqual([
      { productId: 'prod-1', quantity: 5, agreedUnitPrice: 10, groupKey: body.groups[0]!.key },
      { productId: 'prod-1', quantity: 1, agreedUnitPrice: 10, groupKey: null },
    ]);
  });

  it('blocks Create while a group has no name', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await quickAdd('Widget');
    await userEvent.click(screen.getByRole('button', { name: 'Add group' }));
    expect(screen.getByText('rfqCreate.submit')).toBeDisabled();
  });

  it('without a group sends the request it always sent', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByLabelText('customerAccountId')).toHaveValue('Jan Kowalski'));
    await quickAdd('Widget');
    const submit = screen.getByText('rfqCreate.submit');
    await waitFor(() => expect(submit).not.toBeDisabled());
    await userEvent.click(submit);
    await waitFor(() => expect(creates()).toHaveLength(1));
    expect(creates()[0]![1]).toEqual({
      organizationId: ORGANIZATION_ID,
      customerAccountId: 'cust-1',
      items: [{ productId: 'prod-1', quantity: 1, agreedUnitPrice: 10 }],
    });
  });
});
