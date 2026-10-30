import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CustomFieldListFilterField, SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import en from '../../../../packages/modules/_i18n/i18n/en.json';
import pl from '../../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Custom fields as filters of the admin Orders list
 * (`specs/157-custom-fields-list-filters/` US1; FR-011, FR-013 – FR-015;
 * `contracts/admin-surfaces.md` §2; threat model F-5).
 */

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

installOffsetParentShim();

const { OrdersList } = await import('../../../../packages/modules/orders/src/admin/pages/OrdersList');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');
const { CustomFieldValuesPanel } = await import('@endora-commerce/admin-kit/components');

const FIELDS_ENDPOINT = '/api/v1/admin/orders/custom-field-filters';
const VIEWS_ENDPOINT = '/api/v1/admin/orders/list-views';
const OWNER = '00000000-0000-4000-8000-0000000000a1';

const SOURCE: CustomFieldListFilterField = {
  key: 'source',
  valueType: 'select',
  label: { en: 'Source', pl: 'Źródło klienta' },
  labelDefault: 'Source',
  options: [
    { value: 'web', label: { en: 'Web', pl: 'Sieć' }, labelDefault: 'Web' },
    { value: 'shop', label: { en: 'Shop', pl: 'Sklep' }, labelDefault: 'Shop' },
  ],
};

function view(id: string, name: string, filters: Record<string, unknown>): SavedListView {
  return { id, name, shared: false, ownerAdminUserId: OWNER, ownedByCaller: true, canModify: true, filters };
}

const WITH_SOURCE = view('11111111-1111-4111-8111-111111111111', 'Web orders', { customFields: { source: { in: ['web'] } } });
const WITH_RETIRED = view('22222222-2222-4222-8222-222222222222', 'Retired', {
  status: ['new'],
  customFields: { retired_field: { in: ['x'] }, source: { in: ['shop'] } },
});

const HOSTILE_KEY = `<img src=x onerror="window.__xss=1">${'a'.repeat(80)}`;

let offered: CustomFieldListFilterField[] = [SOURCE];
let refuse: string | null = null;
/** How the offered-fields GET answers; a test may leave it pending or reject it. */
let fieldsAnswer: () => Promise<unknown> = async () => ({ data: offered });
let listTotal = 1;
/** A filter key the server refuses as a validation failure (an inverted range). */
let invalidKey: string | null = null;
let currentSearch = '';

function LocationProbe(): ReactNode {
  currentSearch = useLocation().search;
  return null;
}

function row(id: string, biz: string) {
  return {
    id,
    businessId: biz,
    customerName: 'Jan Kowalski',
    status: 'new',
    statusName: { en: 'New' },
    paymentStatus: 'awaiting_payment',
    organizationId: OWNER,
    organizationName: 'Acme',
    total: 99.5,
    currency: 'PLN',
    placedAt: '2026-05-22T12:00:00Z',
  };
}

function refusal(key: string): InstanceType<typeof ApiError> {
  return new ApiError(400, {
    error: {
      code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE',
      message: `The filter on the custom field "${key}" is not available on this list.`,
      details: { key, keys: [key] },
    },
  } as never);
}

beforeEach(() => {
  offered = [SOURCE];
  refuse = null;
  fieldsAnswer = async () => ({ data: offered });
  listTotal = 1;
  invalidKey = null;
  currentSearch = '';
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith(FIELDS_ENDPOINT)) return fieldsAnswer();
    if (path.startsWith('/api/v1/admin/orders/statuses')) {
      return { data: { statuses: [{ code: 'new', name: { en: 'New' } }] } };
    }
    if (path.startsWith(VIEWS_ENDPOINT)) return { data: [WITH_SOURCE, WITH_RETIRED] };
    if (path.startsWith('/api/v1/admin/orders?')) {
      if (refuse !== null && path.includes('customFieldFilters')) throw refusal(refuse);
      if (invalidKey !== null && decodeURIComponent(path).includes(invalidKey)) {
        throw new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Request failed validation.' } } as never);
      }
      return { data: [row('o1', 'ORD-1')], pagination: { page: 1, pageSize: 20, total: listTotal }, counts: { new: 1 } };
    }
    return { data: [] };
  });
  api.post.mockImplementation(async (_path: string, body: Record<string, unknown>) => ({
    data: view('55555555-5555-4555-8555-555555555555', String(body['name']), {}),
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every list request's `customFieldFilters`, parsed (`null` when absent). */
function sentFilters(): Array<Record<string, unknown> | null> {
  return api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith('/api/v1/admin/orders?'))
    .map((path) => {
      const raw = new URLSearchParams(path.split('?')[1]).get('customFieldFilters');
      return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
    });
}

function lastListParams(): URLSearchParams {
  const path = [...api.get.mock.calls]
    .map(([p]) => p)
    .filter((p): p is string => typeof p === 'string' && p.startsWith('/api/v1/admin/orders?'))
    .at(-1);
  return new URLSearchParams(path?.split('?')[1] ?? '');
}

async function renderList(entry = '/orders', rowsExpected = true): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <OrdersList />
        <LocationProbe />
      </MemoryRouter>
    </StrictMode>,
    { core: en as Record<string, string> },
  );
  if (rowsExpected) await screen.findByText('#ORD-1');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith(FIELDS_ENDPOINT));
  return user;
}

async function openFilters(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /^Filters/ }));
}

async function pickOptions(user: ReturnType<typeof userEvent.setup>, ...labels: string[]): Promise<void> {
  const trigger = await screen.findByRole('button', { name: 'Source', expanded: false });
  await user.click(trigger);
  const listbox = within(trigger.parentElement as HTMLElement).getByRole('listbox');
  for (const label of labels) await user.click(within(listbox).getByLabelText(label));
}

describe('OrdersList — custom-field filters', () => {
  it('offers the field among the advanced filters, labelled in the operator’s language', async () => {
    const user = await renderList();
    await openFilters(user);
    expect(await screen.findByRole('button', { name: 'Source', expanded: false })).toBeInTheDocument();
  });

  it('offers nothing when the list offers no field', async () => {
    offered = [];
    const user = await renderList();
    await openFilters(user);
    expect(screen.queryByRole('button', { name: 'Source' })).toBeNull();
  });

  it('sends both chosen options on the first page, beside a status filter, and writes them to the address', async () => {
    const user = await renderList('/orders?status=new&keep=1');
    await openFilters(user);
    await pickOptions(user, 'Web', 'Shop');
    await waitFor(() => expect(sentFilters().at(-1)).toEqual({ source: { in: ['web', 'shop'] } }));
    const params = lastListParams();
    expect(params.get('page')).toBe('1');
    expect(params.getAll('status')).toEqual(['new']);
    await waitFor(() => expect(new URLSearchParams(currentSearch).getAll('cf.source.in')).toEqual(['web', 'shop']));
    expect(new URLSearchParams(currentSearch).get('keep')).toBe('1');
  });

  it('applies a filter from the address on the first request', async () => {
    await renderList('/orders?cf.source.in=web');
    expect(sentFilters()[0]).toEqual({ source: { in: ['web'] } });
  });

  it('shows a chip, and removing it clears the filter', async () => {
    const user = await renderList('/orders?cf.source.in=web');
    const chip = await screen.findByRole('button', { name: /Source: Web/ });
    await user.click(chip);
    await waitFor(() => expect(sentFilters().at(-1)).toBeNull());
    expect(screen.queryByRole('button', { name: /Source: Web/ })).toBeNull();
  });

  it('keeps the filter in a saved view and restores it when the view is loaded', async () => {
    const user = await renderList('/orders?cf.source.in=shop');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Mine{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls.find(([path]) => path === VIEWS_ENDPOINT)?.[1] as { filters: unknown };
    expect(body.filters).toEqual({ customFields: { source: { in: ['shop'] } } });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_SOURCE.id);
    await waitFor(() => expect(sentFilters().at(-1)).toEqual({ source: { in: ['web'] } }));
  });

  it('drops a saved filter that is no longer offered, with a notice, and never sends it', async () => {
    const user = await renderList();
    await screen.findByRole('option', { name: WITH_RETIRED.name });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
    expect(await screen.findByText(/no longer available and were removed: retired_field/)).toBeInTheDocument();
    await waitFor(() => expect(sentFilters().at(-1)).toEqual({ source: { in: ['shop'] } }));
    for (const sent of sentFilters()) expect(JSON.stringify(sent ?? {})).not.toContain('retired_field');
  });

  it('reports a refused filter by the field’s name and removes it on request; the export is withheld meanwhile', async () => {
    refuse = 'source';
    const user = await renderList('/orders?cf.source.in=web', false);
    const alert = await screen.findByText('The filter “Source” is no longer available on this list.');
    expect(screen.queryByRole('link', { name: /Export CSV/ })).toBeNull();
    refuse = null;
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Remove this filter' }));
    await waitFor(() => expect(sentFilters().at(-1)).toBeNull());
    expect(await screen.findByRole('link', { name: /Export CSV/ })).toBeInTheDocument();
  });

  it('renders a hostile refused key as text, truncated', async () => {
    refuse = HOSTILE_KEY;
    await renderList('/orders?cf.source.in=web', false);
    const expected = `${HOSTILE_KEY.slice(0, 64)}…`;
    expect(await screen.findByText(`The filter “${expected}” is no longer available on this list.`)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  it('labels the filter in Polish as the Order detail panel labels the same field', async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <TranslationProvider language="pl" initialBundle={{ core: pl as Record<string, string> }}>
          <MemoryRouter>
            <OrdersList />
          </MemoryRouter>
        </TranslationProvider>
      </StrictMode>,
    );
    await screen.findByText('#ORD-1');
    await user.click(screen.getByRole('button', { name: new RegExp(`^${(pl as Record<string, string>)['orders.filter.toggle']}`) }));
    const filterLabel = (await screen.findByRole('button', { name: 'Źródło klienta', expanded: false })).getAttribute('aria-label');

    api.get.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/admin/custom-fields/definitions')
        ? {
            data: [
              {
                id: 'def-1',
                entityType: 'order',
                key: 'source',
                label: SOURCE.label,
                labelDefault: SOURCE.labelDefault,
                valueType: 'select',
                required: false,
                audience: 'internal',
                sortOrder: 0,
                config: {},
                listFilter: true,
                options: [],
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          }
        : { data: [] },
    );
    render(
      <TranslationProvider language="pl" initialBundle={{ core: pl as Record<string, string> }}>
        <CustomFieldValuesPanel entityType="order" values={{ source: 'web' }} language="pl" save={async () => undefined} />
      </TranslationProvider>,
    );
    expect(await screen.findAllByText(filterLabel ?? '')).not.toHaveLength(0);
  });

  it('exports with the same custom-field filters', async () => {
    await renderList('/orders?cf.source.in=web');
    const link = await screen.findByRole('link', { name: /Export CSV/ });
    const exported = new URLSearchParams((link.getAttribute('href') ?? '').split('?')[1]);
    expect(JSON.parse(exported.get('customFieldFilters') ?? 'null')).toEqual({ source: { in: ['web'] } });
  });

  describe('review round', () => {
    const NOTE: CustomFieldListFilterField = { key: 'note', valueType: 'text', label: { en: 'Note' }, labelDefault: 'Note', options: [] };
    const AMOUNT: CustomFieldListFilterField = { key: 'amount', valueType: 'number', label: { en: 'Amount' }, labelDefault: 'Amount', options: [] };
    const DUE: CustomFieldListFilterField = { key: 'due', valueType: 'date', label: { en: 'Due' }, labelDefault: 'Due', options: [] };
    const VIP: CustomFieldListFilterField = { key: 'vip', valueType: 'boolean', label: { en: 'VIP' }, labelDefault: 'VIP', options: [] };

    it.each([
      ['pending', () => new Promise<unknown>(() => undefined)],
      ['rejected', () => Promise.reject(new Error('down'))],
    ])('keeps a saved view’s filters as saved, with no notice, while the fields are %s', async (_name, answer) => {
      fieldsAnswer = answer;
      const user = await renderList();
      await screen.findByRole('option', { name: WITH_RETIRED.name });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
      await waitFor(() =>
        expect(sentFilters().at(-1)).toEqual({ retired_field: { in: ['x'] }, source: { in: ['shop'] } }),
      );
      expect(screen.queryByText(/no longer available and were removed/)).toBeNull();
    });

    it('never sends a changed custom filter with a page other than the first', async () => {
      listTotal = 50;
      const user = await renderList();
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(lastListParams().get('page')).toBe('2'));
      await openFilters(user);
      await pickOptions(user, 'Web');
      await waitFor(() => expect(sentFilters().at(-1)).toEqual({ source: { in: ['web'] } }));
      const paths = api.get.mock.calls
        .map(([path]) => path)
        .filter((path): path is string => typeof path === 'string' && path.startsWith('/api/v1/admin/orders?'));
      for (const path of paths) {
        const params = new URLSearchParams(path.split('?')[1]);
        if (params.has('customFieldFilters')) expect(params.get('page')).toBe('1');
      }
    });

    it('names each chip’s remove action', async () => {
      await renderList('/orders?cf.source.in=web');
      expect(await screen.findByRole('button', { name: 'Remove filter Source: Web' })).toBeInTheDocument();
    });

    it('shows a refusal in place of the results, and moves focus to them once it is removed', async () => {
      refuse = 'source';
      const user = await renderList('/orders?cf.source.in=web', false);
      await screen.findByText('The filter “Source” is no longer available on this list.');
      expect(screen.queryByText(/Showing|No results/)).toBeNull();
      refuse = null;
      await user.click(screen.getByRole('button', { name: 'Remove this filter' }));
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement?.getAttribute('aria-busy')).not.toBeNull();
    });

    it('clears the dropped-filters notice on Clear all and on a custom-filter change', async () => {
      const user = await renderList();
      await screen.findByRole('option', { name: WITH_RETIRED.name });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
      expect(await screen.findByText(/no longer available and were removed/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: /Source: Shop/ }));
      await waitFor(() => expect(screen.queryByText(/no longer available and were removed/)).toBeNull());
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_SOURCE.id);
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
      expect(await screen.findByText(/no longer available and were removed/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(screen.queryByText(/no longer available and were removed/)).toBeNull());
    });

    it('has no axe violations with chips, a refusal and a dropped-filters notice on screen', async () => {
      refuse = 'source';
      const user = await renderList();
      await screen.findByRole('option', { name: WITH_RETIRED.name });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
      await screen.findByText(/no longer available and were removed/);
      await screen.findByText('The filter “Source” is no longer available on this list.');
      expect(screen.getByRole('button', { name: /Source: Shop/ })).toBeInTheDocument();
      await expectNoAxeViolations(document.body);
    });

    it('shows the server’s sentence, never its code, for an inverted range in the address', async () => {
      offered = [SOURCE, AMOUNT];
      invalidKey = '"amount"';
      await renderList('/orders?cf.amount.min=10&cf.amount.max=1', false);
      expect(await screen.findByText('Request failed validation.')).toBeInTheDocument();
      expect(screen.queryByText(/VALIDATION_FAILED/)).toBeNull();
    });

    it.each([
      ['text', NOTE, 'cf.note.contains=acme', { note: { contains: 'acme' } }, 'Note: contains “acme”'],
      ['number', AMOUNT, 'cf.amount.min=1&cf.amount.max=9.5', { amount: { min: '1', max: '9.5' } }, 'Amount: 1 – 9.5'],
      ['date', DUE, 'cf.due.from=2026-01-01&cf.due.to=2026-01-31', { due: { from: '2026-01-01', to: '2026-01-31' } }, 'Due: 2026-01-01 – 2026-01-31'],
      ['boolean', VIP, 'cf.vip.is=true', { vip: { is: true } }, 'VIP: Yes'],
    ])('a %s field: from the address to the request and a chip, and its control back to the address', async (_type, field, query, payload, chip) => {
      offered = [field];
      const user = await renderList(`/orders?${query}`);
      expect(sentFilters()[0]).toEqual(payload);
      expect(await screen.findByRole('button', { name: new RegExp(chip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })).toBeInTheDocument();
      await openFilters(user);
      if (field.valueType === 'boolean') {
        await user.selectOptions(screen.getByLabelText('VIP'), 'No');
        await waitFor(() => expect(new URLSearchParams(currentSearch).get('cf.vip.is')).toBe('false'));
        await waitFor(() => expect(sentFilters().at(-1)).toEqual({ vip: { is: false } }));
      } else if (field.valueType === 'text') {
        const input = screen.getByLabelText('Note');
        await user.clear(input);
        await user.type(input, 'beta');
        await waitFor(() => expect(new URLSearchParams(currentSearch).get('cf.note.contains')).toBe('beta'));
        await waitFor(() => expect(sentFilters().at(-1)).toEqual({ note: { contains: 'beta' } }));
      } else if (field.valueType === 'number') {
        const max = screen.getByLabelText('Amount: Maximum');
        await user.clear(max);
        await user.type(max, '20');
        await waitFor(() => expect(new URLSearchParams(currentSearch).get('cf.amount.max')).toBe('20'));
        await waitFor(() => expect(sentFilters().at(-1)).toEqual({ amount: { min: '1', max: '20' } }));
      } else {
        fireEvent.change(screen.getByLabelText('Due: To'), { target: { value: '2026-02-28' } });
        await waitFor(() => expect(new URLSearchParams(currentSearch).get('cf.due.to')).toBe('2026-02-28'));
        await waitFor(() => expect(sentFilters().at(-1)).toEqual({ due: { from: '2026-01-01', to: '2026-02-28' } }));
      }
    });
  });
});
