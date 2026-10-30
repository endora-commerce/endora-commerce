import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { customFieldCarrySkipReasonSchema } from '@endora-commerce/contracts';
import { passthroughBundle } from '../../helpers/render-with-i18n';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import ordersEn from '../../../../packages/modules/orders/i18n/en.json';
import ordersPl from '../../../../packages/modules/orders/i18n/pl.json';

/**
 * Feature 162 (T047, US1-4, FR-010a, SC-006) — the system note the platform
 * writes into an Order's comments when a custom-field value could not be
 * carried into it, read in the operator's language
 * (`specs/162-custom-fields-value-carry/contracts/admin-surfaces.md` §2).
 *
 * Owner ruling V3 (2026-10-21, T067): a skip line names the field by the label
 * stored with the skip — the reader's language, then the default label, then
 * the key for a note written before labels were stored — without reading any
 * field definition, so every reader of the Order sees the name.
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

// The overview's values panel (feature 055) reads the Order definitions on its
// own; it is not what this suite is about, and leaving it out lets the suite
// prove the system note needs no definition read of its own (V3).
vi.mock('@endora-commerce/admin-kit/components', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/components')>(
    '@endora-commerce/admin-kit/components',
  );
  return { ...actual, CustomFieldValuesPanel: () => null };
});

const { OrderDetail } = await import('../../../../packages/modules/orders/src/admin/pages/OrderDetail');

const ORDER = {
  id: 'o1',
  organizationId: '00000000-0000-4000-8000-0000000000a1',
  placedByCustomerAccountId: '00000000-0000-4000-8000-0000000000c1',
  status: 'new',
  paymentStatus: 'awaiting_payment',
  deliveryAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  billingAddress: { street: 'S', city: 'C', postalCode: '00-000', country: 'PL' },
  deliveryMethod: { code: 'dm', name: { en: 'DM' }, cost: 0 },
  paymentMethod: { code: 'pm', name: { en: 'PM' }, kind: 'bank_transfer' },
  items: [],
  subtotal: 10,
  taxTotal: 0,
  discountTotal: 0,
  deliveryTotal: 0,
  total: 10,
  currency: 'PLN',
  customerNote: null,
  placedAt: '2026-05-22T12:00:00Z',
};

const LONG_KEY = `k${'x'.repeat(70)}`;
const LONG_LABEL = `L${'y'.repeat(70)}`;

const SYSTEM_NOTE = {
  id: 'c-system',
  body: 'Not carried from quote request QR-000042: order_source (target_missing)',
  isCustomerVisible: false,
  notifyCustomer: false,
  authorAdminUserId: null,
  authorCustomerAccountId: null,
  systemNote: {
    kind: 'custom_field_carry_skipped',
    source: { entityType: 'quote_request', recordId: '00000000-0000-4000-8000-0000000000d1', reference: 'QR-000042' },
    skipped: [
      // Written before labels were stored: named by its key.
      { key: 'order_source', reason: 'target_missing' },
      { key: 'fair', reason: 'value_invalid', label: { labelDefault: 'Trade fair', labels: { en: 'Trade fair', pl: 'Targi' } } },
      // No Polish label: a Polish reader gets the default label.
      { key: 'region', reason: 'value_type_mismatch', label: { labelDefault: 'Region', labels: { en: 'Sales region' } } },
      { key: LONG_KEY, reason: 'audience_mismatch' },
      { key: 'long_label', reason: 'target_missing', label: { labelDefault: LONG_LABEL, labels: {} } },
    ],
  },
  createdAt: '2026-05-22T12:30:00Z',
};

const STAFF_NOTE = {
  id: 'c-staff',
  body: 'called the buyer',
  isCustomerVisible: true,
  notifyCustomer: false,
  authorAdminUserId: 'a1',
  authorCustomerAccountId: null,
  systemNote: null,
  createdAt: '2026-05-22T12:40:00Z',
};

/** The read Phase 8 made to name a field; a stored label makes it unnecessary (V3). */
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions?entityType=order';
const askedForDefinitions = (): boolean =>
  getSpy.mock.calls.some(([path]) => typeof path === 'string' && path.startsWith('/api/v1/admin/custom-fields/'));

let comments: unknown[] = [];

beforeEach(() => {
  comments = [SYSTEM_NOTE, STAFF_NOTE];
  getSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/orders/o1') return Promise.resolve({ data: ORDER });
    if (path === '/api/v1/admin/orders/statuses') {
      return Promise.resolve({ data: { statuses: [{ code: 'new', name: { en: 'New' }, isTerminal: false }], transitions: [] } });
    }
    if (path === '/api/v1/admin/orders/o1/comments') return Promise.resolve({ data: comments });
    return Promise.resolve({ data: [] });
  });
});

const CORE = passthroughBundle('core', [
  'orderDetail.tabs.comments',
  'orderDetail.comments.internal',
  'orderDetail.comments.byStaff',
  'orderDetail.comments.byCustomer',
]).core!;

type Bundle = Record<string, string>;
const text = (bundle: Bundle, key: string, params: Record<string, string> = {}): string =>
  bundle[key]!.replace(/\{(\w+)\}/g, (_m, name: string) => params[name] ?? '');

async function openComments(
  orders: Bundle,
  permissions: string[] = ['*'],
  language: 'en' | 'pl' = 'en',
): Promise<HTMLElement[]> {
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <TranslationProvider language={language} initialBundle={{ core: CORE, orders }}>
      <>{children}</>
    </TranslationProvider>
  );
  render(
    <StrictMode>
      {withSession(
        <MemoryRouter initialEntries={['/orders/o1']}>
          <Routes>
            <Route path="/orders/:id" element={<OrderDetail />} />
          </Routes>
        </MemoryRouter>,
        { session: adminSession({ permissions }), presence: modulePresence({ present: ['orders', 'payments'] }) },
      )}
    </StrictMode>,
    { wrapper },
  );
  await userEvent.click(await screen.findByText('orderDetail.tabs.comments'));
  await waitFor(() => expect(screen.getAllByTestId('order-comment')).toHaveLength(comments.length));
  return screen.getAllByTestId('order-comment');
}

describe.each([
  ['en', ordersEn as Bundle],
  ['pl', ordersPl as Bundle],
] as const)('OrderDetail — the carry system note (%s)', (language, orders) => {
  it('names System as its author, marks it internal and says where the values came from', async () => {
    const [note] = await openComments(orders, ['*'], language);
    expect(within(note!).getByText(text(orders, 'orderDetail.comments.systemAuthor'))).toBeInTheDocument();
    expect(within(note!).queryByText('orderDetail.comments.byStaff')).toBeNull();
    expect(within(note!).getByText('orderDetail.comments.internal')).toBeInTheDocument();
    expect(
      within(note!).getByText(
        text(orders, 'orderDetail.comments.systemNote.customFieldCarrySkipped.quote_request', { reference: 'QR-000042' }),
      ),
    ).toBeInTheDocument();
    // The English fallback body is not shown beside the readable note.
    expect(within(note!).queryByText(SYSTEM_NOTE.body)).toBeNull();
  });

  it('lists one line per skipped field with its translated reason, named by its stored label in the reader\'s language', async () => {
    const [note] = await openComments(orders, ['*'], language);
    const line = (field: string, reason: string): string =>
      text(orders, 'orderDetail.comments.carryLine', {
        field,
        reason: text(orders, `orderDetail.comments.carryReason.${reason}`),
      });
    const items = within(note!).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      // No stored label (an old note): the key.
      line('order_source', 'target_missing'),
      line(language === 'pl' ? 'Targi' : 'Trade fair', 'value_invalid'),
      // No label in the reader's language: the default label.
      line(language === 'pl' ? 'Region' : 'Sales region', 'value_type_mismatch'),
      line(`${LONG_KEY.slice(0, 64)}…`, 'audience_mismatch'),
      line(`${LONG_LABEL.slice(0, 64)}…`, 'target_missing'),
    ]);
    // The name comes with the note: no field definition is read for it.
    expect(askedForDefinitions()).toBe(false);
  });

  it('names the sales opportunity a note came from', async () => {
    comments = [
      { ...SYSTEM_NOTE, systemNote: { ...SYSTEM_NOTE.systemNote, source: { ...SYSTEM_NOTE.systemNote.source, entityType: 'opportunity', reference: 'OPP-000007' } } },
    ];
    const [note] = await openComments(orders, ['*'], language);
    expect(
      within(note!).getByText(
        text(orders, 'orderDetail.comments.systemNote.customFieldCarrySkipped.opportunity', { reference: 'OPP-000007' }),
      ),
    ).toBeInTheDocument();
  });

  it('renders a comment without a system note as before', async () => {
    const [, staff] = await openComments(orders, ['*'], language);
    expect(within(staff!).getByText('orderDetail.comments.byStaff')).toBeInTheDocument();
    expect(within(staff!).getByText('called the buyer')).toBeInTheDocument();
    expect(within(staff!).queryByText(text(orders, 'orderDetail.comments.systemAuthor'))).toBeNull();
  });
});

describe('OrderDetail — the carry system note, degraded', () => {
  it('names every field by its stored label to a reader without custom_fields:read (V3)', async () => {
    const [note] = await openComments(ordersPl as Bundle, ['orders:read', 'orders:write'], 'pl');
    expect(within(note!).getByText(/^Targi — /)).toBeInTheDocument();
    expect(within(note!).getByText(/^Region — /)).toBeInTheDocument();
    expect(within(note!).queryByText(/^fair — /)).toBeNull();
    expect(getSpy).not.toHaveBeenCalledWith(DEFINITIONS_URL);
    expect(askedForDefinitions()).toBe(false);
  });

  it('falls back to the stored body for a reason it has no sentence for', async () => {
    comments = [{ ...SYSTEM_NOTE, systemNote: { ...SYSTEM_NOTE.systemNote, skipped: [{ key: 'order_source', reason: 'brand_new' }] } }];
    const [note] = await openComments(ordersEn as Bundle);
    expect(within(note!).getByText(SYSTEM_NOTE.body)).toBeInTheDocument();
    expect(within(note!).queryByText(/brand_new/)).toBeNull();
  });

  it('ships a reason sentence for every reason the contract can answer, in both languages', () => {
    for (const reason of customFieldCarrySkipReasonSchema.options) {
      const key = `orderDetail.comments.carryReason.${reason}`;
      expect((ordersEn as Bundle)[key], `en ${key}`).toBeTruthy();
      expect((ordersPl as Bundle)[key], `pl ${key}`).toBeTruthy();
      expect((ordersPl as Bundle)[key]).not.toBe((ordersEn as Bundle)[key]);
    }
  });
});
