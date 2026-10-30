import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { CustomFieldListFilterField, SavedListView } from '@endora-commerce/contracts';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../../helpers/axe';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import pl from '../../../../packages/modules/_i18n/i18n/pl.json';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import en from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Custom fields as filters of the admin Quote Request list
 * (`specs/157-custom-fields-list-filters/` US2; FR-009, FR-011, FR-013,
 * FR-014; `contracts/admin-surfaces.md` §2; threat model F-5). The filter is
 * applied by the server: the list is re-read when it changes, and the
 * client-side status, search, sort and paging run over what comes back.
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
    useAuth: () => ({ me: { role: { code: 'platform_admin' } } }),
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

const { RfqList } = await import('../../../../packages/modules/quote_requests/src/admin/pages/RfqList');
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

const FIELDS_ENDPOINT = '/api/v1/admin/quote-requests/custom-field-filters';
const VIEWS_ENDPOINT = '/api/v1/admin/quote-requests/list-views';
const LIST = '/api/v1/admin/quote-requests?';
const OWNER = '00000000-0000-4000-8000-0000000000b1';
const ACME = '00000000-0000-4000-8000-0000000000a1';

const SOURCE: CustomFieldListFilterField = {
  key: 'source',
  valueType: 'select',
  label: { en: 'Source', pl: 'Źródło klienta' },
  labelDefault: 'Source',
  options: [
    { value: 'web', label: { en: 'Web' }, labelDefault: 'Web' },
    { value: 'shop', label: { en: 'Shop' }, labelDefault: 'Shop' },
  ],
};

function view(id: string, name: string, filters: Record<string, unknown>): SavedListView {
  return { id, name, shared: false, ownerAdminUserId: OWNER, ownedByCaller: true, canModify: true, filters };
}

const WITH_SOURCE = view('11111111-1111-4111-8111-111111111111', 'Web requests', {
  scope: 'all',
  customFields: { source: { in: ['web'] } },
});
const WITH_RETIRED = view('22222222-2222-4222-8222-222222222222', 'Retired', {
  scope: 'all',
  customFields: { retired_field: { in: ['x'] }, source: { in: ['shop'] } },
});

const HOSTILE_KEY = `<img src=x onerror="window.__xss=1">${'a'.repeat(80)}`;

function rfq(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    businessId: `RFQ-${n}`,
    organizationId: ACME,
    organizationName: 'Acme',
    customerAccountId: '00000000-0000-4000-8000-0000000000c1',
    customerDisplayName: 'Buyer',
    status: 'Pending',
    awaitingCustomerRevisionAcceptance: false,
    lineCount: 2,
    totalAtCustomerPrice: 100 + n,
    totalAtAgreedPrice: null,
    currency: 'PLN',
    submittedAt: null,
    expiresAt: null,
    updatedAt: `2026-05-${String((n % 28) + 1).padStart(2, '0')}T12:00:00Z`,
    version: 1,
  };
}

/** Thirty rows unfiltered; twenty-three when the filter narrows them (two pages at 20). */
const ALL_ROWS = Array.from({ length: 30 }, (_, i) => rfq(i + 1));
const NARROWED = ALL_ROWS.slice(0, 23);

let offered: CustomFieldListFilterField[] = [SOURCE];
let refuse: string | null = null;
let fieldsAnswer: () => Promise<unknown> = async () => ({ data: offered });
let invalidKey: string | null = null;
let currentSearch = '';

function LocationProbe(): ReactNode {
  currentSearch = useLocation().search;
  return null;
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
  invalidKey = null;
  currentSearch = '';
  for (const fn of Object.values(api)) fn.mockReset();
  api.get.mockImplementation(async (path: string) => {
    if (path.startsWith(FIELDS_ENDPOINT)) return fieldsAnswer();
    if (path.startsWith(VIEWS_ENDPOINT)) return { data: [WITH_SOURCE, WITH_RETIRED] };
    if (path.startsWith(LIST)) {
      const filtered = new URLSearchParams(path.split('?')[1]).has('customFieldFilters');
      if (refuse !== null && filtered) throw refusal(refuse);
      if (invalidKey !== null && decodeURIComponent(path).includes(invalidKey)) {
        throw new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Request failed validation.' } } as never);
      }
      return { data: filtered ? NARROWED : ALL_ROWS };
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

function listParams(): URLSearchParams[] {
  return api.get.mock.calls
    .map(([path]) => path)
    .filter((path): path is string => typeof path === 'string' && path.startsWith(LIST))
    .map((path) => new URLSearchParams(path.split('?')[1]));
}

function sentFilters(): Array<Record<string, unknown> | null> {
  return listParams().map((params) => {
    const raw = params.get('customFieldFilters');
    return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
  });
}

async function renderList(entry = '/quote-requests', rowsExpected = true): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  renderWithI18n(
    <StrictMode>
      <MemoryRouter initialEntries={[entry]}>
        <RfqList />
        <LocationProbe />
      </MemoryRouter>
    </StrictMode>,
    { core: en as Record<string, string> },
  );
  if (rowsExpected) await screen.findAllByText(/^#RFQ-/);
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

describe('RfqList — custom-field filters', () => {
  it('offers the field among the advanced filters', async () => {
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

  it('re-reads the list from the server with both options, keeping scope and organization, and writes the address', async () => {
    const user = await renderList('/quote-requests?scope=all&keep=1');
    await openFilters(user);
    await pickOptions(user, 'Web', 'Shop');
    await waitFor(() => expect(sentFilters().at(-1)).toEqual({ source: { in: ['web', 'shop'] } }));
    expect(listParams().at(-1)?.get('assignmentScope')).toBe('all');
    await waitFor(() => expect(new URLSearchParams(currentSearch).getAll('cf.source.in')).toEqual(['web', 'shop']));
    expect(new URLSearchParams(currentSearch).get('keep')).toBe('1');
  });

  it('counts and pages the narrowed response', async () => {
    const user = await renderList('/quote-requests?scope=all&cf.source.in=web');
    expect(sentFilters()[0]).toEqual({ source: { in: ['web'] } });
    // Newest first: the narrowed set's 23 rows are RFQ-23 … RFQ-1.
    expect(await screen.findByText('#RFQ-23')).toBeInTheDocument();
    expect(screen.getByText(/of 23/)).toBeInTheDocument();
    expect(screen.queryByText('#RFQ-3')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Next/ }));
    expect(await screen.findByText('#RFQ-1')).toBeInTheDocument();
    expect(screen.queryByText('#RFQ-24')).toBeNull();
  });

  it('shows a chip, and removing it clears the filter', async () => {
    const user = await renderList('/quote-requests?scope=all&cf.source.in=web');
    await user.click(await screen.findByRole('button', { name: /Source: Web/ }));
    await waitFor(() => expect(sentFilters().at(-1)).toBeNull());
  });

  it('keeps the filter in a saved view and restores it when the view is loaded', async () => {
    const user = await renderList('/quote-requests?scope=all&cf.source.in=shop');
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save view' });
    await user.type(within(dialog).getByLabelText('Name'), 'Mine{Enter}');
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls.find(([path]) => path === VIEWS_ENDPOINT)?.[1] as {
      filters: Record<string, unknown>;
    };
    expect(body.filters['customFields']).toEqual({ source: { in: ['shop'] } });

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

  it('reports a refused filter by the field’s name and removes it on request', async () => {
    refuse = 'source';
    const user = await renderList('/quote-requests?scope=all&cf.source.in=web', false);
    const alert = await screen.findByText('The filter “Source” is no longer available on this list.');
    refuse = null;
    await user.click(
      within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Remove this filter' }),
    );
    await waitFor(() => expect(sentFilters().at(-1)).toBeNull());
  });

  it('renders a hostile refused key as text, truncated', async () => {
    refuse = HOSTILE_KEY;
    await renderList('/quote-requests?scope=all&cf.source.in=web', false);
    const expected = `${HOSTILE_KEY.slice(0, 64)}…`;
    expect(await screen.findByText(`The filter “${expected}” is no longer available on this list.`)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  describe('review round', () => {
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

    it('reads the list once under StrictMode when the address carries a filter', async () => {
      await renderList('/quote-requests?scope=all&cf.source.in=web');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(listParams()).toHaveLength(1);
    });

    it('shows a refusal in place of the results, and moves focus to them once it is removed', async () => {
      refuse = 'source';
      const user = await renderList('/quote-requests?scope=all&cf.source.in=web', false);
      await screen.findByText('The filter “Source” is no longer available on this list.');
      expect(screen.queryByText(/Showing|No results/)).toBeNull();
      refuse = null;
      await user.click(screen.getByRole('button', { name: 'Remove this filter' }));
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    });

    it('shows the server’s sentence, never its code, for an inverted range in the address', async () => {
      offered = [SOURCE, { key: 'amount', valueType: 'number', label: { en: 'Amount' }, labelDefault: 'Amount', options: [] }];
      invalidKey = '"amount"';
      await renderList('/quote-requests?scope=all&cf.amount.min=10&cf.amount.max=1', false);
      expect(await screen.findByText('Request failed validation.')).toBeInTheDocument();
      expect(screen.queryByText(/VALIDATION_FAILED/)).toBeNull();
    });

    it('has no axe violations with chips, a refusal and a dropped-filters notice on screen', async () => {
      refuse = 'source';
      const user = await renderList();
      await screen.findByRole('option', { name: WITH_RETIRED.name });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Saved views' }), WITH_RETIRED.id);
      await screen.findByText(/no longer available and were removed/);
      await screen.findByText('The filter “Source” is no longer available on this list.');
      await expectNoAxeViolations(document.body);
    });

    it('speaks Polish: the chip, the refusal and the dropped-filters notice', async () => {
      refuse = 'source';
      const user = userEvent.setup();
      render(
        <StrictMode>
          <TranslationProvider language="pl" initialBundle={{ core: pl as Record<string, string> }}>
            <MemoryRouter>
              <RfqList />
            </MemoryRouter>
          </TranslationProvider>
        </StrictMode>,
      );
      await screen.findByRole('option', { name: WITH_RETIRED.name });
      await user.selectOptions(screen.getByRole('combobox', { name: /widok/i }), WITH_RETIRED.id);
      expect(
        await screen.findByText('Niektóre filtry tego widoku nie są już dostępne i zostały usunięte: retired_field.'),
      ).toBeInTheDocument();
      expect(await screen.findByText('Filtr „Źródło klienta” nie jest już dostępny na tej liście.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Usuń filtr Źródło klienta: Shop' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Usuń ten filtr' })).toBeInTheDocument();
    });
  });
});
