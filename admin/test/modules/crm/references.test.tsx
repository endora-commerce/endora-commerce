import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityComment, OpportunityReference } from '@endora-commerce/contracts';
import {
  EVERY_CRM_PERMISSION,
  OPPORTUNITY_ID,
  ORDER_ID,
  ORDER_STATUS_GRAPH,
  core,
  crmLookupResponse,
  detail,
  en,
  renderCrm,
  caretAt,
  returningHere,
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
        data: [{ id: PRODUCT_ID, sku: 'VAN-L2', slug: 'cargo-van-l2', status: 'active', name: 'Cargo van L2' }],
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
    expect(within(description).getByRole('link', { name: /^Order:\s*ORD-1001$/ })).toHaveAttribute(
      'href',
      returningHere(`/orders/${ORDER_ID}`),
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
    const entry = (await within(panel).findByText(core('references.unavailable.product'))).closest('li') as HTMLElement;
    expect(within(entry).getByText(core('references.unavailable.order'))).toBeInTheDocument();
    expect(within(entry).queryByRole('link')).toBeNull();
    expect(entry).not.toHaveTextContent(HIDDEN_ORDER_ID);
    expect(entry).not.toHaveTextContent(GONE_PRODUCT_ID);
  });

  it('treats a token the server did not resolve as unavailable rather than guessing', async () => {
    notes = [note(`About [[product:${PRODUCT_ID}]].`, [])];
    const panel = await open(en('opportunity.tabs.notes'));
    expect(await within(panel).findByText(core('references.unavailable.product'))).toBeInTheDocument();
  });
});

describe('a formatted text, as it is read (specs/158-crm-opportunity-inline-editing/, FR-010)', () => {
  it('draws bold, italic, strikethrough, lists and links as elements, and the markers not at all', async () => {
    notes = [note('**Deal** _soon_ ~~maybe~~\n- one\n- two\n3. three\n[offer](https://example.com/offer)')];
    const panel = await open(en('opportunity.tabs.notes'));
    const strong = await within(panel).findByText('Deal');
    const entry = strong.closest('li') as HTMLElement;
    expect(strong.tagName).toBe('STRONG');
    expect(within(entry).getByText('soon').tagName).toBe('EM');
    expect(within(entry).getByText('maybe').tagName).toBe('S');
    expect(entry.querySelectorAll('ul > li')).toHaveLength(2);
    expect(entry.querySelector('ol')).toHaveAttribute('start', '3');
    const link = within(entry).getByRole('link', { name: 'offer' });
    expect(link).toHaveAttribute('href', 'https://example.com/offer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(entry).not.toHaveTextContent(/\*\*|~~|\]\(/);
  });

  it('draws no link for an address a reader may not follow — it stays the characters it is', async () => {
    notes = [note('[click](javascript:alert(1))')];
    const panel = await open(en('opportunity.tabs.notes'));
    expect(await within(panel).findByText('[click](javascript:alert(1))')).toBeInTheDocument();
    expect(within(panel).queryByRole('link', { name: 'click' })).toBeNull();
  });
});

describe('an Order a text refers to (specs/158-crm-opportunity-inline-editing/, FR-012)', () => {
  const RICH_ORDER: OpportunityReference = {
    type: 'order',
    id: ORDER_ID,
    available: true,
    label: 'ORD-1001',
    url: `/orders/${ORDER_ID}`,
    order: {
      status: 'paid',
      total: '1234.50',
      currency: 'PLN',
      placedAt: '2026-10-01T09:30:00.000Z',
      customerName: 'Acme sp. z o.o.',
    },
  };

  it('says its status, total, date and customer beside its number', async () => {
    notes = [note(`See [[order:${ORDER_ID}]].`, [RICH_ORDER])];
    const panel = await open(en('opportunity.tabs.notes'));
    const number = await within(panel).findByRole('link', { name: /^Order:\s*ORD-1001$/ });
    const chip = number.closest('[data-order-reference]') as HTMLElement;
    expect(chip).toHaveTextContent('Paid');
    expect(chip).toHaveTextContent(/1[\s\u00a0\u202f]?234[.,]50/);
    expect(chip).toHaveTextContent(new Date('2026-10-01T09:30:00.000Z').toLocaleDateString('en'));
    expect(chip).toHaveTextContent('Acme sp. z o.o.');
  });

  it('opens the Order here with the way back to the Opportunity, or in a new tab from its own button', async () => {
    notes = [note(`See [[order:${ORDER_ID}]].`, [RICH_ORDER])];
    const panel = await open(en('opportunity.tabs.notes'));
    const number = await within(panel).findByRole('link', { name: /^Order:\s*ORD-1001$/ });
    expect(number).toHaveAttribute('href', returningHere(`/orders/${ORDER_ID}`));
    expect(number).not.toHaveAttribute('target');
    const newTab = within(panel).getByRole('link', {
      name: core('references.order.openInNewTab', { number: 'ORD-1001' }),
    });
    expect(newTab).toHaveAttribute('href', `/orders/${ORDER_ID}`);
    expect(newTab).toHaveAttribute('target', '_blank');
    expect(newTab.getAttribute('rel')).toContain('noopener');
  });

  it('names the status by its code when the statuses cannot be read', async () => {
    const original = getSpy.getMockImplementation();
    getSpy.mockImplementation((path: string) =>
      path === '/api/v1/admin/orders/statuses' ? Promise.reject(new Error('403')) : original?.(path),
    );
    notes = [note(`See [[order:${ORDER_ID}]].`, [RICH_ORDER])];
    const panel = await open(en('opportunity.tabs.notes'));
    const number = await within(panel).findByRole('link', { name: /^Order:\s*ORD-1001$/ });
    expect(number.closest('[data-order-reference]')).toHaveTextContent('paid');
  });
});

describe('the textarea that inserts references', () => {
  const composer = async (permissions?: readonly string[]): Promise<HTMLElement> => {
    const panel = await open(en('opportunity.tabs.notes'), permissions);
    await within(panel).findByLabelText(en('comments.notes.composer.label'));
    return panel;
  };

  // `specs/163-projects-and-tasks/` FR-044: an Order is now chosen from the
  // `@@` document list (*Insert document*), CRM's own lookup for this
  // Opportunity, rather than from `orders`' list by Organization.
  it('inserts an Order of this Organization where the caret is, and sends the token', async () => {
    postSpy.mockImplementation((_path: string, body: { body: string }) =>
      Promise.resolve({ data: note(body.body, REFERENCES.slice(1, 2)) }),
    );
    const panel = await composer();
    const field = within(panel).getByLabelText(en('comments.notes.composer.label')) as HTMLElement;
    await userEvent.type(field, 'As in  last year.');
    // Put the caret between the two spaces after "As in".
    caretAt(field, 6);

    await userEvent.click(within(panel).getByRole('button', { name: core('references.insert.document') }));
    await waitFor(() =>
      expect(
        getSpy.mock.calls.some(
          ([path]) =>
            String(path).startsWith('/api/v1/admin/crm/lookups/documents?') &&
            String(path).includes(`opportunityId=${OPPORTUNITY_ID}`),
        ),
      ).toBe(true),
    );
    await userEvent.click(within(panel).getByRole('combobox', { name: core('references.search.document') }));
    await userEvent.click(await screen.findByRole('option', { name: /ORD-1001/ }));

    const expected = `As in [[order:${ORDER_ID}]] last year.`;
    await waitFor(() => expect(storedText(field)).toBe(expected));
    // The search closes once it has done its job.
    expect(within(panel).queryByRole('combobox', { name: core('references.search.document') })).toBeNull();

    await userEvent.click(within(panel).getByRole('button', { name: en('comments.notes.composer.submit') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(COMMENTS_PATH, { kind: 'note', body: expected }));
    // Once saved, the reference reads as the Order's number.
    expect(await within(panel).findByRole('link', { name: /^Order:\s*ORD-1001$/ })).toHaveAttribute(
      'href',
      returningHere(`/orders/${ORDER_ID}`),
    );
  });

  it('inserts a Product chosen in the catalogue`s picker', async () => {
    const panel = await composer([...EVERY_CRM_PERMISSION, 'catalog:read']);
    const field = within(panel).getByLabelText(en('comments.notes.composer.label')) as HTMLElement;
    await userEvent.click(within(panel).getByRole('button', { name: core('references.insert.product') }));
    await userEvent.click(await within(panel).findByRole('combobox', { name: core('references.search.product') }));
    await userEvent.click(await screen.findByRole('option', { name: /Cargo van L2/ }));
    await waitFor(() => expect(storedText(field)).toBe(`[[product:${PRODUCT_ID}]]`));
  });

  it('offers only the searches the reader`s role can make', async () => {
    // No catalogue code: no product button, and the catalogue is never asked.
    const panel = await composer();
    expect(within(panel).queryByRole('button', { name: core('references.insert.product') })).toBeNull();
    expect(within(panel).getByRole('button', { name: core('references.insert.document') })).toBeInTheDocument();
    expect(getSpy.mock.calls.some(([path]) => String(path).includes('/catalog/products'))).toBe(false);
  });

  it('offers a role that may search neither Orders nor Products the people only', async () => {
    const panel = await composer(['crm:read', 'crm:write']);
    expect(within(panel).queryByRole('button', { name: core('references.insert.document') })).toBeNull();
    expect(within(panel).queryByRole('button', { name: core('references.insert.product') })).toBeNull();
    expect(within(panel).getByRole('button', { name: core('references.insert.person') })).toBeInTheDocument();
    expect(within(panel).getByText(core('references.hint'))).toBeInTheDocument();
    expect(within(panel).getByLabelText(en('comments.notes.composer.label'))).toBeInTheDocument();
  });
});
