import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityComment, OpportunityReference } from '@endora-commerce/contracts';
import {
  EVERY_CRM_PERMISSION,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  ORGANIZATION_ID,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  caretAt,
  storedText,
} from './crm-fixtures';

/**
 * References to Products and Orders in a description, a note and a message
 * (`specs/143-crm-sales-opportunities/`, User Story 12 — task T127; FR-044,
 * FR-045): the textarea that inserts a token where the caret is, and the text
 * shown with each token as a link — or, for a target that is gone or out of the
 * reader's reach, as a chip that says so and leaks nothing.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunityDetail } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunityDetail'
);

const DETAIL_PATH = `/api/v1/admin/crm/opportunities/${OPPORTUNITY_ID}`;
const COMMENTS_PATH = `${DETAIL_PATH}/comments`;
const PRODUCT_ID = '00000000-0000-4000-8000-00000000aa01';
const GONE_PRODUCT_ID = '00000000-0000-4000-8000-00000000aa02';
const HIDDEN_ORDER_ID = '00000000-0000-4000-8000-0000000000c7';
const ME = '00000000-0000-4000-8000-00000000ad01';

const REFERENCES: OpportunityReference[] = [
  { type: 'product', id: PRODUCT_ID, available: true, label: 'Cargo van L2', url: `/catalog/products/${PRODUCT_ID}` },
  { type: 'order', id: ORDER_ID, available: true, label: 'ORD-1001', url: `/orders/${ORDER_ID}` },
  { type: 'product', id: GONE_PRODUCT_ID, available: false, label: null, url: null },
  { type: 'order', id: HIDDEN_ORDER_ID, available: false, label: null, url: null },
];

const note = (body: string, references: OpportunityReference[] = []): OpportunityComment => ({
  id: '00000000-0000-4000-8000-0000000c0001',
  kind: 'note',
  author: { id: ME, name: 'Ada Min' },
  body,
  references,
  editedAt: null,
  createdAt: '2026-10-05T10:00:00.000Z',
});

let notes: OpportunityComment[];

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  notes = [];
  getSpy.mockImplementation((path: string) => {
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    if (path === DETAIL_PATH) {
      return Promise.resolve({
        data: detail({
          description: `Forty of [[product:${PRODUCT_ID}]], as in [[order:${ORDER_ID}]]. <b>Not bold</b> [[order:nope]]`,
          references: REFERENCES.slice(0, 2),
        }),
      });
    }
    if (path === '/api/v1/admin/orders/statuses') return Promise.resolve({ data: ORDER_STATUS_GRAPH });
    if (path.startsWith('/api/v1/admin/orders?')) {
      return Promise.resolve({
        data: [{ id: ORDER_ID, businessId: 'ORD-1001', status: 'new', total: 990, currency: 'PLN' }],
      });
    }
    if (path.startsWith('/api/v1/admin/catalog/products?')) {
      return Promise.resolve({
        data: [{ id: PRODUCT_ID, sku: 'VAN-L2', slug: 'cargo-van-l2', status: 'active', name: { en: 'Cargo van L2' } }],
        pagination: { page: 0, pageSize: 20, total: 1 },
      });
    }
    if (path.startsWith(`${COMMENTS_PATH}?`)) return Promise.resolve({ data: notes });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

async function open(tab: string | null, permissions?: readonly string[]): Promise<HTMLElement> {
  renderCrm(<OpportunityDetail />, {
    path: `/crm/opportunities/${OPPORTUNITY_ID}`,
    pattern: '/crm/opportunities/:id',
    ...(permissions ? { permissions } : {}),
  });
  await screen.findByRole('heading', { level: 1, name: /Fleet renewal/ });
  if (tab) await userEvent.click(screen.getByRole('tab', { name: tab }));
  return screen.findByRole('tabpanel', { name: tab ?? en('opportunity.tabs.overview') });
}

describe('a text with references, as it is read', () => {
  it('shows each resolved token as a link under the target`s current name', async () => {
    const panel = await open(null);
    const product = await within(panel).findByRole('link', { name: /Cargo van L2/ });
    expect(product).toHaveAttribute('href', `/catalog/products/${PRODUCT_ID}`);
    // The description is a section of the Overview tab, no longer one row of a list.
    const description = product.closest('section') as HTMLElement;
    expect(within(description).getByRole('link', { name: /ORD-1001/ })).toHaveAttribute(
      'href',
      `/orders/${ORDER_ID}`,
    );
    // The token itself is not on screen.
    expect(panel).not.toHaveTextContent(`[[product:${PRODUCT_ID}]]`);
  });

  it('shows markup as the characters that were typed, and leaves a malformed token alone', async () => {
    const panel = await open(null);
    await within(panel).findByRole('link', { name: /Cargo van L2/ });
    expect(panel).toHaveTextContent('<b>Not bold</b> [[order:nope]]');
    expect(panel.querySelector('b')).toBeNull();
  });

  it('marks a target that is gone or out of reach as unavailable — no link, no name, no id', async () => {
    notes = [
      note(`See [[product:${GONE_PRODUCT_ID}]] and [[order:${HIDDEN_ORDER_ID}]].`, REFERENCES.slice(2)),
    ];
    const panel = await open(en('opportunity.tabs.notes'));
    const entry = (await within(panel).findByText(en('references.unavailable.product'))).closest('li') as HTMLElement;
    expect(within(entry).getByText(en('references.unavailable.order'))).toBeInTheDocument();
    expect(within(entry).queryByRole('link')).toBeNull();
    expect(entry).not.toHaveTextContent(HIDDEN_ORDER_ID);
    expect(entry).not.toHaveTextContent(GONE_PRODUCT_ID);
  });

  it('treats a token the server did not resolve as unavailable rather than guessing', async () => {
    notes = [note(`About [[product:${PRODUCT_ID}]].`, [])];
    const panel = await open(en('opportunity.tabs.notes'));
    expect(await within(panel).findByText(en('references.unavailable.product'))).toBeInTheDocument();
  });
});

describe('the textarea that inserts references', () => {
  const composer = async (permissions?: readonly string[]): Promise<HTMLElement> => {
    const panel = await open(en('opportunity.tabs.notes'), permissions);
    await within(panel).findByLabelText(en('comments.notes.composer.label'));
    return panel;
  };

  it('inserts an Order of this Organization where the caret is, and sends the token', async () => {
    postSpy.mockImplementation((_path: string, body: { body: string }) =>
      Promise.resolve({ data: note(body.body, REFERENCES.slice(1, 2)) }),
    );
    const panel = await composer();
    const field = within(panel).getByLabelText(en('comments.notes.composer.label')) as HTMLElement;
    await userEvent.type(field, 'As in  last year.');
    // Put the caret between the two spaces after "As in".
    caretAt(field, 6);

    await userEvent.click(within(panel).getByRole('button', { name: en('references.insert.order') }));
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([path]) =>
            String(path).startsWith('/api/v1/admin/orders?') &&
            String(path).includes(`organizationId=${ORGANIZATION_ID}`),
        ),
      ).toBe(true),
    );
    await userEvent.click(within(panel).getByRole('combobox', { name: en('references.search.order') }));
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1001/ }));

    const expected = `As in [[order:${ORDER_ID}]] last year.`;
    await waitFor(() => expect(storedText(field)).toBe(expected));
    // The search closes once it has done its job.
    expect(within(panel).queryByRole('combobox', { name: en('references.search.order') })).toBeNull();

    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { kind: 'note', body: expected }));
    // Once saved, the reference reads as the Order's number.
    expect(await within(panel).findByRole('link', { name: /ORD-1001/ })).toHaveAttribute('href', `/orders/${ORDER_ID}`);
  });

  it('inserts a Product chosen in the catalogue`s picker', async () => {
    const panel = await composer([...EVERY_CRM_PERMISSION, 'catalog:read']);
    const field = within(panel).getByLabelText(en('comments.notes.composer.label')) as HTMLElement;
    await userEvent.click(within(panel).getByRole('button', { name: en('references.insert.product') }));
    await userEvent.click(await within(panel).findByRole('combobox', { name: en('references.search.product') }));
    await userEvent.click(await screen.findByRole('option', { name: /Cargo van L2/ }));
    await waitFor(() => expect(storedText(field)).toBe(`[[product:${PRODUCT_ID}]]`));
  });

  it('offers only the searches the reader`s role can make', async () => {
    // No catalogue code: no product button, and the catalogue is never asked.
    const panel = await composer();
    expect(within(panel).queryByRole('button', { name: en('references.insert.product') })).toBeNull();
    expect(within(panel).getByRole('button', { name: en('references.insert.order') })).toBeInTheDocument();
    expect(getSpy.mock.calls.some(([path]) => String(path).includes('/catalog/products'))).toBe(false);
  });

  it('offers a role that may search neither Orders nor Products the people only', async () => {
    const panel = await composer(['crm:read', 'crm:write']);
    expect(within(panel).queryByRole('button', { name: en('references.insert.order') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: en('references.insert.product') })).toBeNull();
    expect(within(panel).getByRole('button', { name: en('references.insert.person') })).toBeInTheDocument();
    expect(within(panel).getByText(en('references.hint'))).toBeInTheDocument();
    expect(within(panel).getByLabelText(en('comments.notes.composer.label'))).toBeInTheDocument();
  });
});
