import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import corePl from '../../../../packages/modules/_i18n/i18n/pl.json';
import returnsPl from '../../../../packages/modules/returns/i18n/pl.json';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #1439 (UX audit 2026-11-17, DS-05, slice S5): the three returns
 * configuration lists — reasons, return delivery methods and statuses — create
 * from a *New …* in the page header that opens a `ModalDialog`, instead of a
 * create card drawn open under the list. With no record yet the empty state
 * carries the one create action. A refusal stays in the dialog, at its field;
 * a success closes it and says so beside the header's button. An operator
 * without `returns:write` (the code every write route enforces) sees the list
 * but is offered no write it would be refused.
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

const { ReturnReasonsPage } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnReasonsPage');
const { ReturnDeliveryMethodsPage } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnDeliveryMethodsPage'
);
const { ReturnStatusesConfigPage } = await import(
  '../../../../packages/modules/returns/src/admin/pages/ReturnStatusesConfigPage'
);

const BUNDLE = { core: corePl as Record<string, string>, returns: returnsPl as Record<string, string> };

/** Who is signed in: by default an operator holding every permission. */
let permissions: string[] = ['*'];
const READ_ONLY = ['returns:read'];

function render(node: React.ReactElement): void {
  renderWithI18n(withSession(<MemoryRouter>{node}</MemoryRouter>, { session: adminSession({ permissions }) }), BUNDLE, {
    language: 'pl',
  });
}

beforeEach(() => {
  permissions = ['*'];
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
});

describe('ReturnReasonsPage — create in a dialog', () => {
  const REASON = { id: 'r1', label: { en: 'Damaged', pl: 'Uszkodzony' }, appliesTo: 'complaint', weight: 10, isActive: true };

  function mount(rows: unknown[] = [REASON]): void {
    let current = rows;
    api.get.mockImplementation(() => Promise.resolve({ data: current }));
    api.post.mockImplementation((_path: string, body: { label: { en: string } }) => {
      current = [...current, { id: 'r9', label: body.label, appliesTo: 'both', weight: 100, isActive: true }];
      return Promise.resolve({ data: {} });
    });
    render(<ReturnReasonsPage />);
  }

  it('puts "New reason" in the header and draws no create form under the list', async () => {
    mount();
    await screen.findByText('Uszkodzony');
    expect(screen.getByRole('banner').contains(screen.getByRole('button', { name: 'Nowy powód' }))).toBe(true);
    expect(screen.queryByLabelText(/^Etykieta \(po angielsku\)/)).toBeNull();
  });

  it('creates a reason in the dialog, closes it, says so and returns focus to "New reason"', async () => {
    mount();
    await screen.findByText('Uszkodzony');
    const opener = screen.getByRole('button', { name: 'Nowy powód' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Nowy powód' });
    await userEvent.type(within(dialog).getByLabelText(/^Etykieta \(po angielsku\)/), 'Wrong size');
    await userEvent.selectOptions(within(dialog).getByLabelText('Dotyczy'), 'return');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj powód' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/reasons', {
      label: { en: 'Wrong size' },
      appliesTo: 'return',
      weight: 100,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Wrong size')).toBeTruthy();
    expect(screen.getByText('Dodano powód.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nowy powód' })));
  });

  it('creates a reason with a Polish label only (owner decision 2026-11-21)', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy powód' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy powód' });
    await userEvent.type(within(dialog).getByLabelText(/^Etykieta \(po polsku\)/), 'Zły rozmiar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj powód' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/reasons', {
      label: { pl: 'Zły rozmiar' },
      appliesTo: 'both',
      weight: 100,
    });
    expect(await screen.findByText('Zły rozmiar')).toBeTruthy();
    // The new row has no English label, and the list says so.
    expect(screen.getByText('Brak: angielski')).toBeTruthy();
  });

  it('edits a reason\'s labels in a dialog, keeping a language it does not show', async () => {
    mount([{ ...REASON, label: { en: 'Damaged', de: 'Beschädigt' } }]);
    api.patch.mockResolvedValueOnce({ data: {} });
    expect(await screen.findByText('Brak: polski')).toBeTruthy();
    const edit = screen.getByRole('button', { name: 'Edytuj: Damaged' });
    await userEvent.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj powód' });
    expect((within(dialog).getByLabelText(/^Etykieta \(po angielsku\)/) as HTMLInputElement).value).toBe('Damaged');
    expect((within(dialog).getByLabelText('Dotyczy') as HTMLSelectElement).value).toBe('complaint');
    await userEvent.type(within(dialog).getByLabelText(/^Etykieta \(po polsku\)/), 'Uszkodzony');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/returns/reasons/r1', {
      label: { en: 'Damaged', de: 'Beschädigt', pl: 'Uszkodzony' },
      appliesTo: 'complaint',
      weight: 10,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Zapisano powód.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('refuses an empty label at its field and sends nothing', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy powód' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy powód' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj powód' }));
    const field = within(dialog).getByLabelText(/^Etykieta \(po angielsku\)/);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('Podaj etykietę po angielsku lub po polsku.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('keeps the dialog and the typed label when the server refuses', async () => {
    mount();
    api.post.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy powód' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy powód' });
    await userEvent.type(within(dialog).getByLabelText(/^Etykieta \(po angielsku\)/), 'Wrong size');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj powód' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(within(dialog).getByRole('alert').textContent).not.toBe('');
    expect((within(dialog).getByLabelText(/^Etykieta \(po angielsku\)/) as HTMLInputElement).value).toBe('Wrong size');
  });

  it('with no reason yet, the empty state carries the one "New reason"', async () => {
    mount([]);
    expect(await screen.findByText('Brak powodów zwrotu')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Nowy powód' })).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('button')).toBeNull();
  });

  it('shows a read-only operator the reasons, with no "New reason", no delete and no toggle', async () => {
    permissions = READ_ONLY;
    mount();
    await screen.findByText('Uszkodzony');
    expect(screen.queryByRole('button', { name: 'Nowy powód' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edytuj: Uszkodzony' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuń: Uszkodzony' })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Aktywny: Uszkodzony' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives a read-only operator an empty state with no create action', async () => {
    permissions = READ_ONLY;
    mount([]);
    expect(await screen.findByText('Brak powodów zwrotu')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nowy powód' })).toBeNull();
  });

  it('moves focus to the empty state\'s "New reason" when the last reason is deleted', async () => {
    mount();
    api.delete.mockResolvedValueOnce({ data: {} });
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń: Uszkodzony' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń' }));
    expect(await screen.findByText('Brak powodów zwrotu')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nowy powód' })));
  });
});

describe('ReturnDeliveryMethodsPage — create in a dialog', () => {
  const ROWS = [{ id: 'm1', deliveryMethodId: 'dm-1', returnCost: 0, currency: 'PLN', isActive: true }];
  const METHODS = [
    { id: 'dm-1', code: 'courier', name: { en: 'Courier', pl: 'Kurier' } },
    { id: 'dm-2', code: 'parcel_locker', name: { en: 'Parcel locker', pl: 'Paczkomat' } },
  ];

  function mount(methods: () => Promise<unknown> = () => Promise.resolve({ data: METHODS }), rows: unknown[] = ROWS): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/delivery-methods') return Promise.resolve({ data: rows });
      if (path === '/api/v1/admin/delivery-methods') return methods();
      return Promise.resolve({ data: [] });
    });
    api.post.mockResolvedValue({ data: {} });
    render(<ReturnDeliveryMethodsPage />);
  }

  it('puts the create action in the header and the form in a dialog', async () => {
    mount();
    await screen.findByText('Kurier');
    expect(screen.queryByLabelText(/^Metoda dostawy/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowa metoda dostawy zwrotnej' });
    const select = within(dialog).getByLabelText(/^Metoda dostawy/);
    // A method that already has a return setting is not offered again.
    expect(within(select).queryByRole('option', { name: 'Kurier' })).toBeNull();
    await userEvent.selectOptions(select, 'dm-2');
    await userEvent.clear(within(dialog).getByLabelText('Koszt zwrotu'));
    await userEvent.type(within(dialog).getByLabelText('Koszt zwrotu'), '9.99');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj metodę' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/delivery-methods', {
      deliveryMethodId: 'dm-2',
      returnCost: 9.99,
      currency: 'PLN',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Dodano metodę.')).toBeTruthy();
  });

  it('refuses a missing method at its field', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj metodę' }));
    expect(within(dialog).getByLabelText(/^Metoda dostawy/).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('Wybierz metodę dostawy.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('says so when every delivery method already has a return setting', async () => {
    mount(() => Promise.resolve({ data: [METHODS[0]] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Każda metoda dostawy ma już ustawienia zwrotu.')).toBeTruthy());
    expect((within(dialog).getByRole('button', { name: 'Dodaj metodę' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('takes the method ID in the dialog when the delivery methods cannot be read', async () => {
    mount(() => Promise.reject(new Error('403')));
    await screen.findByText('dm-1');
    await userEvent.click(screen.getByRole('button', { name: 'Nowa metoda dostawy zwrotnej' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^ID metody dostawy/)).toBeTruthy();
  });

  it('shows a read-only operator the methods, with no create action, no delete and no toggle', async () => {
    permissions = READ_ONLY;
    mount();
    await screen.findByText('Kurier');
    expect(screen.queryByRole('button', { name: 'Nowa metoda dostawy zwrotnej' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuń: Kurier' })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Aktywna: Kurier' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('with no method yet, the empty state carries the one create action', async () => {
    mount(undefined, []);
    expect(await screen.findByText('Brak metod dostawy zwrotnej')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Nowa metoda dostawy zwrotnej' })).toHaveLength(1);
    expect(screen.getByRole('banner').querySelector('button')).toBeNull();
  });
});

describe('ReturnStatusesConfigPage — create in a dialog', () => {
  const status = (code: string, over: Record<string, unknown> = {}) => ({
    code,
    name: { en: code[0]!.toUpperCase() + code.slice(1) },
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
  const GRAPH = { statuses: [status('new', { isInitial: true }), status('received')], transitions: [] };

  function mount(graph: unknown = GRAPH): void {
    api.get.mockImplementation((path: string) => {
      if (path === '/api/v1/admin/returns/statuses') return Promise.resolve({ data: graph });
      if (path === '/api/v1/admin/returns/notification-health')
        return Promise.resolve({ data: { recipientsMissing: { global: false, salesChannelIds: [] } } });
      return Promise.resolve({ data: { items: [] }, items: [] });
    });
    render(<ReturnStatusesConfigPage />);
  }

  it('creates a status from the header through a dialog, the code following the name', async () => {
    mount();
    await screen.findByText('received');
    expect(screen.queryByLabelText(/^Nazwa \(po angielsku\)/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Nowy status' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy status' });
    await userEvent.type(within(dialog).getByLabelText(/^Nazwa \(po angielsku\)/), 'In inspection');
    expect((within(dialog).getByLabelText(/^Kod nowego statusu/) as HTMLInputElement).value).toBe('in_inspection');
    api.post.mockResolvedValueOnce({ data: GRAPH });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj status' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/statuses', {
      code: 'in_inspection',
      name: { en: 'In inspection' },
      defaultName: 'In inspection',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Dodano status.')).toBeTruthy();
  });

  it('creates a status with a Polish name only, the code and default name following it', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy status' }));
    const dialog = await screen.findByRole('dialog', { name: 'Nowy status' });
    await userEvent.type(within(dialog).getByLabelText(/^Nazwa \(po polsku\)/), 'W oględzinach');
    expect((within(dialog).getByLabelText(/^Kod nowego statusu/) as HTMLInputElement).value).toBe('w_ogledzinach');
    api.post.mockResolvedValueOnce({ data: GRAPH });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj status' }));
    expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/statuses', {
      code: 'w_ogledzinach',
      name: { pl: 'W oględzinach' },
      defaultName: 'W oględzinach',
    });
  });

  it('edits a status\'s names in a dialog, with no code field, and says it is missing a language', async () => {
    mount();
    expect(await screen.findAllByText('Brak: polski')).toHaveLength(2);
    api.patch.mockResolvedValueOnce({ data: GRAPH });
    const edit = screen.getByRole('button', { name: 'Edytuj status: Received' });
    await userEvent.click(edit);
    const dialog = await screen.findByRole('dialog', { name: 'Edytuj status' });
    expect(within(dialog).queryByLabelText(/^Kod nowego statusu/)).toBeNull();
    await userEvent.type(within(dialog).getByLabelText(/^Nazwa \(po polsku\)/), 'Odebrane');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(api.patch).toHaveBeenCalledWith('/api/v1/admin/returns/statuses/received', {
      name: { en: 'Received', pl: 'Odebrane' },
      defaultName: 'Received',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Zapisano status.')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(edit));
  });

  it('refuses an empty name at its field', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy status' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj status' }));
    expect(within(dialog).getByLabelText(/^Nazwa \(po angielsku\)/).getAttribute('aria-invalid')).toBe('true');
    expect(within(dialog).getByText('Podaj nazwę po angielsku lub po polsku.')).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the server refusal inside the dialog, not behind it', async () => {
    mount();
    api.post.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(await screen.findByRole('button', { name: 'Nowy status' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Nazwa \(po angielsku\)/), 'In inspection');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj status' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).not.toBe(''));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a read-only operator the statuses, with no "New status", no delete and no e-mail toggle', async () => {
    permissions = READ_ONLY;
    mount({ ...GRAPH, statuses: [...GRAPH.statuses, status('inspecting', { isSystem: false })] });
    await screen.findByText('inspecting');
    expect(screen.queryByRole('button', { name: 'Nowy status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edytuj status: Inspecting' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usuń status: Inspecting' })).toBeNull();
    const notify = screen.getByRole('checkbox', { name: /Inspecting$/ }) as HTMLInputElement;
    expect(notify.disabled).toBe(true);
  });

  it('moves focus to "New status" when the last deletable status is deleted', async () => {
    mount({ ...GRAPH, statuses: [...GRAPH.statuses, status('inspecting', { isSystem: false })] });
    api.delete.mockResolvedValueOnce({ data: GRAPH });
    await userEvent.click(await screen.findByRole('button', { name: 'Usuń status: Inspecting' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Usuń' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Nowy status' })));
  });
});
