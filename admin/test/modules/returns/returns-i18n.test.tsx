import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { formatMoney } from '@endora-commerce/admin-kit/lib';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import returnsPl from '../../../../packages/modules/returns/i18n/pl.json';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { CASE_180 } from './return-detail-fixture';

/**
 * Issue #1472 (UX audit 2026-11-17, SALES-07): the returns admin screens speak
 * the operator's language and name things instead of printing codes — the
 * case detail, and the reasons, statuses and return-delivery-methods
 * configuration screens. Rendered in Polish with the real bundles, so an
 * English literal left in the JSX shows up as English text.
 */

installOffsetParentShim();

vi.mock('echarts', () => {
  const chart = { setOption: (): void => {}, resize: (): void => {}, dispose: (): void => {}, on: (): void => {}, off: (): void => {}, dispatchAction: (): void => {} };
  return { init: () => chart, default: { init: () => chart } };
});

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnDetail } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnDetail');
const { ReturnReasonsPage } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnReasonsPage');
const { ReturnDeliveryMethodsPage } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDeliveryMethodsPage'
);
const { ReturnStatusesConfigPage } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage'
);

const BUNDLE = { core: corePl as Record<string, string>, returns: returnsPl as Record<string, string> };

/** English copy the screens used to hard-code; none may reach a Polish operator. */
const ENGLISH = [
  'Authorize (assign RMA)',
  'Product',
  'Qty',
  'Default refund',
  'Return shipments',
  'Record inbound shipment',
  'Direction',
  'Tracking',
  'Mark received',
  'Reasons',
  'Methods',
  'Label',
  'Applies to',
  'Weight',
  'Active',
  'Add reason',
  'Add method',
  'Delivery method id',
  'Return cost',
  'Currency',
  'active',
  'inactive',
];

/** A table cell whose whole text is `text` — money carries a no-break space the string matcher does not fold. */
function cell(text: string): (content: string, element: Element | null) => boolean {
  return (_content, element) => element?.tagName === 'TD' && element.textContent === text;
}

function expectNoEnglish(): void {
  for (const text of ENGLISH) expect(screen.queryByText(text, { exact: true }), text).toBeNull();
}

const ORDER_ID = CASE_180.orderId;

const status = (code: string, pl: string, over: Record<string, unknown> = {}) => ({
  code,
  name: { en: code[0]!.toUpperCase() + code.slice(1), pl },
  defaultName: code[0]!.toUpperCase() + code.slice(1),
  isInitial: false,
  isTerminal: false,
  isSystem: true,
  weight: 10,
  color: '#64748b',
  notifyCustomerOnEntry: false,
  inUseCount: 0,
  ...over,
});

const GRAPH = {
  statuses: [status('new', 'Nowy', { isInitial: true }), status('authorized', 'Autoryzowany'), status('received', 'Odebrany')],
  transitions: [
    { fromStatusCode: 'authorized', toStatusCode: 'received' },
    { fromStatusCode: 'new', toStatusCode: 'authorized' },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: { ok: true } });
});

describe('ReturnDetail in Polish (#1472)', () => {
  const CASE = {
    ...CASE_180,
    rmaNumber: 'RMA-7',
    kind: 'return',
    statusCode: 'authorized',
    statusLabel: 'Autoryzowany',
    items: [
      {
        id: 'i1',
        orderItemId: 'oi1',
        productName: 'Wiertarka',
        quantity: 2,
        defaultRefundAmount: 1234.5,
        approvedRefundAmount: 1000,
        returnableAtPurchase: true,
      },
    ],
  };

  function mount(over: { order?: () => Promise<unknown> } = {}): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: CASE });
      if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: GRAPH });
      if (path === '/api/v1/admin/returns/r1/shipments')
        return Promise.resolve({ data: [{ id: 's1', direction: 'inbound', status: 'pending', externalReference: null }] });
      if (path === `/api/v1/admin/orders/${ORDER_ID}`)
        return over.order ? over.order() : Promise.resolve({ data: { id: ORDER_ID, businessId: 'ZAM-2026-0042' } });
      return Promise.resolve({ data: [] });
    });
    renderWithI18n(
      <MemoryRouter initialEntries={['/returns/r1']}>
        <Routes>
          <Route path="/returns/:id" element={<ReturnDetail />} />
        </Routes>
      </MemoryRouter>,
      BUNDLE,
      { language: 'pl' },
    );
  }

  it('labels a transition with the target status name, not its code or an arrow', async () => {
    mount();
    const button = await screen.findByRole('button', { name: 'Przenieś do: Odebrany' });
    expect(button.textContent).not.toContain('→');
    expect(screen.queryByRole('button', { name: /received/ })).toBeNull();

    api.post.mockResolvedValueOnce({ data: CASE });
    await userEvent.click(button);
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/r1/transition', { to: 'received' });
    // The result is an InlineStatus beside the actions (#1499), not a page banner.
    const result = await screen.findByText('Przeniesiono do: Odebrany.');
    expect(result.closest('[role="status"]')).not.toBeNull();
    expect(result.closest('[data-slot="alert"]')).toBeNull();
    expect(result.closest('[data-actions-card]')).toBe(button.closest('[data-actions-card]'));
  });

  it('reports a shipment result beside the shipments card, not as a banner', async () => {
    mount();
    const record = await screen.findByRole('button', { name: 'Zarejestruj przesyłkę przychodzącą' });
    api.post.mockResolvedValueOnce({ data: { id: 's2' } });
    await userEvent.click(record);
    const result = await screen.findByText('Zarejestrowano przesyłkę przychodzącą.');
    expect(result.closest('[role="status"]')).not.toBeNull();
    expect(result.closest('[data-slot="alert"]')).toBeNull();
    expect(result.closest('[data-shipments-card]')).toBe(record.closest('[data-shipments-card]'));
  });

  it('links the order by its business ID, and still links it when the number cannot be read', async () => {
    mount();
    const link = await screen.findByRole('link', { name: 'Zamówienie ZAM-2026-0042' });
    expect(link.getAttribute('href')).toBe(`/orders/${ORDER_ID}`);
    expect(screen.queryByText(new RegExp(ORDER_ID))).toBeNull();
  });

  it('falls back to a plain order link when the orders list cannot be read', async () => {
    mount({ order: () => Promise.reject(new Error('403')) });
    const link = await screen.findByRole('link', { name: 'Otwórz zamówienie' });
    expect(link.getAttribute('href')).toBe(`/orders/${ORDER_ID}`);
  });

  it('formats amounts with the case currency and translates the items and shipments', async () => {
    mount();
    const items = (await screen.findByText('Wiertarka')).closest('table')!;
    expect(within(items).getByText(cell(formatMoney(1234.5, 'PLN')))).toBeTruthy();
    expect(within(items).getByText(cell(formatMoney(1000, 'PLN')))).toBeTruthy();
    expect(within(items).getByText('Ilość')).toBeTruthy();

    expect(screen.getByText('Przesyłki zwrotne')).toBeTruthy();
    expect(screen.getByText('Przychodząca (od klienta)')).toBeTruthy();
    expect(screen.getByText('Oczekuje')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Oznacz jako odebraną' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zarejestruj przesyłkę przychodzącą' })).toBeTruthy();
    expect(screen.queryByText('inbound')).toBeNull();
    expect(screen.queryByText('pending')).toBeNull();
    expectNoEnglish();
  });

  it('names the authorize action and its result in Polish', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/r1') return Promise.resolve({ data: { ...CASE, statusCode: 'new' } });
      if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: GRAPH });
      return Promise.resolve({ data: [] });
    });
    renderWithI18n(
      <MemoryRouter initialEntries={['/returns/r1']}>
        <Routes>
          <Route path="/returns/:id" element={<ReturnDetail />} />
        </Routes>
      </MemoryRouter>,
      BUNDLE,
      { language: 'pl' },
    );
    const authorize = await screen.findByRole('button', { name: 'Autoryzuj i nadaj numer RMA' });
    api.post.mockResolvedValueOnce({ data: { rmaNumber: 'RMA-7', statusCode: 'authorized' } });
    await userEvent.click(authorize);
    const result = await screen.findByText('Autoryzowano i nadano numer RMA.');
    expect(result.closest('[data-slot="alert"]')).toBeNull();
    expect(screen.getByText('Brak zarejestrowanych przesyłek.')).toBeTruthy();
  });
});

describe('ReturnReasonsPage in Polish (#1472)', () => {
  const REASONS = [
    { id: 'r1', label: { en: 'Damaged', pl: 'Uszkodzony' }, appliesTo: 'complaint', weight: 10, isActive: true },
    { id: 'r2', label: { en: 'Changed my mind' }, appliesTo: 'both', weight: 20, isActive: false },
  ];

  function mount(rows: unknown[] = REASONS): void {
    api.get.mockImplementation(() => Promise.resolve({ data: rows }));
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ReturnReasonsPage />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
      { language: 'pl' },
    );
  }

  it('shows labels in the operator language and translates what a reason applies to', async () => {
    mount();
    const table = (await screen.findByText('Uszkodzony')).closest('table')!;
    expect(within(table).getByText('Changed my mind')).toBeTruthy();
    expect(within(table).getByText('Reklamacje')).toBeTruthy();
    expect(within(table).getByText('Zwroty i reklamacje')).toBeTruthy();
    expect(screen.queryByText('complaint')).toBeNull();
    expectNoEnglish();
  });

  it('toggles a reason with a named switch', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: 'Aktywny: Uszkodzony' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/returns/reasons/r1', { isActive: false });

  });

  it('asks before deleting a reason, deletes inside the dialog and moves focus to the next row', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń: Uszkodzony' }));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć ten powód?' });
    expect(api.delete).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Uszkodzony')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Usuń: Uszkodzony' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń' }));
    expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/returns/reasons/r1');
    await waitFor(() => expect(screen.queryByText('Uszkodzony')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Usuń: Changed my mind' })));
  });

  it('moves focus to "New reason" when the last reason is deleted', async () => {
    mount([REASONS[0]]);
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń: Uszkodzony' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Brak powodów zwrotu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nowy powód' })));
  });

  it('adds a reason through labelled kit fields in the "New reason" dialog', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy powód' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowy powód' }));
    await userEvent.type(dialog.getByLabelText(/^Etykieta \(po angielsku\)/), 'Wrong size');
    await userEvent.selectOptions(dialog.getByLabelText('Dotyczy'), 'return');
    await userEvent.clear(dialog.getByLabelText('Waga sortowania'));
    await userEvent.type(dialog.getByLabelText('Waga sortowania'), '5');
    api.post.mockResolvedValueOnce({ data: {} });
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj powód' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/reasons', {
      label: { en: 'Wrong size' },
      appliesTo: 'return',
      weight: 5,
    });
  });

  it('says so when there are no reasons', async () => {
    mount([]);
    expect(await screen.findByText('Brak powodów zwrotu')).toBeTruthy();
  });
});

describe('ReturnDeliveryMethodsPage in Polish (#1472)', () => {
  const ROWS = [
    { id: 'm1', deliveryMethodId: 'dm-1', returnCost: 0, currency: 'PLN', isActive: true },
    { id: 'm2', deliveryMethodId: 'dm-9', returnCost: 15.5, currency: 'PLN', isActive: false },
  ];
  const METHODS = [
    { id: 'dm-1', code: 'courier', name: { en: 'Courier', pl: 'Kurier' } },
    { id: 'dm-2', code: 'parcel_locker', name: { en: 'Parcel locker', pl: 'Paczkomat' } },
  ];

  function mount(methods: () => Promise<unknown> = () => Promise.resolve({ data: METHODS })): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/delivery-methods') return Promise.resolve({ data: ROWS });
      if (path === '/api/v1/admin/delivery-methods') return methods();
      return Promise.resolve({ data: [] });
    });
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ReturnDeliveryMethodsPage />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
      { language: 'pl' },
    );
  }

  it('names the delivery method, formats the cost and says a zero cost is free', async () => {
    mount();
    expect(await screen.findByText('Kurier')).toBeTruthy();
    expect(screen.getByText('Bezpłatny (płaci sklep)')).toBeTruthy();
    expect(screen.getByText(cell(formatMoney(15.5, 'PLN')))).toBeTruthy();
    // A method the list no longer holds is said to be unknown, not printed as a UUID.
    expect(screen.getByText('Nieznana metoda dostawy')).toBeTruthy();
    expectNoEnglish();
  });

  it('puts "0 = free" in the cost field hint, not in the page description', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const cost = within(await screen.findByRole('dialog')).getByLabelText('Koszt zwrotu');
    const hintId = cost.getAttribute('aria-describedby') ?? '';
    expect(hintId).not.toBe('');
    expect(document.getElementById(hintId.split(' ')[0]!)?.textContent).toBe('0 oznacza bezpłatny zwrot, za który płaci sklep.');
  });

  it('offers the delivery methods by name and creates the chosen one', async () => {
    mount();
    await screen.findByText('Kurier');
    await userEvent.click(screen.getByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const dialog = within(await screen.findByRole('dialog'));
    const select = dialog.getByLabelText(/^Metoda dostawy/);
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Paczkomat' })).toBeTruthy());
    await userEvent.selectOptions(select, 'dm-2');
    await userEvent.clear(dialog.getByLabelText('Koszt zwrotu'));
    await userEvent.type(dialog.getByLabelText('Koszt zwrotu'), '9.99');
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj metodę' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/delivery-methods', {
      deliveryMethodId: 'dm-2',
      returnCost: 9.99,
      currency: 'PLN',
    });
  });

  it('toggles a method with a named switch', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: 'Aktywna: Kurier' });
    await userEvent.click(toggle);
    expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/returns/delivery-methods/m1', { isActive: false });
  });

  it('asks before deleting a return delivery method and moves focus to the next row', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń: Kurier' }));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć tę metodę dostawy zwrotnej?' });
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }));
    expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/returns/delivery-methods/m1');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Usuń: Nieznana metoda dostawy' })),
    );
  });

  it('falls back to an ID field when the delivery methods cannot be read', async () => {
    mount(() => Promise.reject(new Error('403')));
    await screen.findByText('dm-1');
    await userEvent.click(screen.getByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    expect(within(await screen.findByRole('dialog')).getByLabelText(/^ID metody dostawy/)).toBeTruthy();
  });
});

describe('ReturnStatusesConfigPage in Polish (#1472)', () => {
  function mount(): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: GRAPH });
      if (path === '/api/v1/admin/returns/notification-health')
        return Promise.resolve({ data: { recipientsMissing: { global: false, salesChannelIds: [] } } });
      return Promise.resolve({ data: { items: [] }, items: [] });
    });
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ReturnStatusesConfigPage />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
      { language: 'pl' },
    );
  }

  it('names statuses in the operator language', async () => {
    mount();
    const table = (await screen.findByText('received')).closest('table')!;
    expect(within(table).getByText('Odebrany')).toBeTruthy();
    expect(within(table).getByText('Autoryzowany')).toBeTruthy();
  });

  it('derives the new status code from its name through labelled kit fields', async () => {
    mount();
    await screen.findByText('received');
    await userEvent.click(screen.getByRole('button', { name: 'Nowy status' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Nowy status' }));
    await userEvent.type(dialog.getByLabelText(/^Nazwa \(po angielsku\)/), 'In inspection');
    expect((dialog.getByLabelText(/^Kod nowego statusu/) as HTMLInputElement).value).toBe('in_inspection');
    api.post.mockResolvedValueOnce({ data: GRAPH });
    await userEvent.click(dialog.getByRole('button', { name: 'Dodaj status' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/statuses', {
      code: 'in_inspection',
      name: { en: 'In inspection' },
      defaultName: 'In inspection',
    });
  });

  it('names the delete button after the status and asks before deleting it', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/statuses')
        return Promise.resolve({ data: { ...GRAPH, statuses: [...GRAPH.statuses, status('inspecting', 'W ocenie', { isSystem: false })] } });
      return Promise.resolve({ data: { recipientsMissing: { global: false, salesChannelIds: [] } }, items: [] });
    });
    renderWithI18n(
      withSession(
        <MemoryRouter>
          <ReturnStatusesConfigPage />
        </MemoryRouter>,
        { session: adminSession({ permissions: ['*'] }) },
      ),
      BUNDLE,
      { language: 'pl' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń status: W ocenie' }));
    const dialog = await screen.findByRole('dialog', { name: 'Usunąć ten status?' });
    expect(api.delete).not.toHaveBeenCalled();
    api.delete.mockResolvedValueOnce({ data: GRAPH });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Usuń' }));
    expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/returns/statuses/inspecting');
    // The last deletable status is gone: focus goes to the header's "New status".
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nowy status' })));
  });
});
