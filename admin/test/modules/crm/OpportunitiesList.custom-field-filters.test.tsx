import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import type { CustomFieldListFilterField } from '@endora-commerce/contracts';
import { setMobileViewport } from '../../setup';
import { WORKFLOW, crmLookupResponse, renderCrm, summary } from './crm-fixtures';
import { expectNoAxeViolations } from '../../helpers/axe';

/**
 * Feature 157 (T051, US2) — custom-field filters on the Opportunities list
 * (FR-007, FR-011a, FR-013; `specs/157-custom-fields-list-filters/contracts/admin-surfaces.md` §2).
 *
 * The list offers what `…/opportunities/custom-field-filters` answers — the
 * definitions with the list-filter option on, whatever the board card shows —
 * and sends them as `custom:<key>` references in `fieldFilters`, never with
 * `cardValues`, so the server applies the list-filter rule and not the card's.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    usePageSizePreference: () => ({ pageSize: 20 as const, setPageSize: vi.fn() }),
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { OpportunitiesList } = await import(
  '../../../../packages/modules/crm/src/admin/pages/OpportunitiesList'
);

const LIST_PATH = '/api/v1/admin/crm/opportunities';
const OFFERED_PATH = '/api/v1/admin/crm/opportunities/custom-field-filters';

const SEGMENT: CustomFieldListFilterField = {
  key: 'segment',
  valueType: 'select',
  label: { en: 'Segment' },
  labelDefault: 'Segment',
  options: [
    { value: 'smb', label: { en: 'Small business' }, labelDefault: 'SMB' },
    { value: 'ent', label: { en: 'Enterprise' }, labelDefault: 'Enterprise' },
  ],
};

let listAnswer: (query: URLSearchParams) => Promise<unknown>;

function page(cursor: string | null): unknown {
  return { data: [summary()], pagination: { cursor, hasMore: cursor !== null, limit: 20 } };
}

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  listAnswer = async () => page(null);
  getSpy.mockImplementation((path: string) => {
    if (path === OFFERED_PATH) return Promise.resolve({ data: [SEGMENT] });
    if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) {
      return listAnswer(new URLSearchParams(path.split('?')[1] ?? ''));
    }
    if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
    const lookup = crmLookupResponse(path);
    if (lookup) return lookup;
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete (window as { __xss?: unknown }).__xss;
});

function listQueries(): URLSearchParams[] {
  return getSpy.mock.calls
    .map(([path]) => path as string)
    .filter((path) => path === LIST_PATH || path.startsWith(`${LIST_PATH}?`))
    .map((path) => new URLSearchParams(path.split('?')[1] ?? ''));
}

function lastQuery(): URLSearchParams {
  return listQueries().at(-1)!;
}

function fieldFiltersOf(query: URLSearchParams): unknown {
  const raw = query.get('fieldFilters');
  return raw === null ? null : JSON.parse(raw);
}

/** The address the list wrote, as the router holds it. */
function Address(): ReactNode {
  const location = useLocation();
  return <output data-testid="address">{location.search}</output>;
}

function address(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('address').textContent ?? '');
}

async function renderList(path = '/crm/opportunities'): Promise<void> {
  renderCrm(
    <StrictMode>
      <OpportunitiesList />
      <Address />
    </StrictMode>,
    { path },
  );
  await screen.findByText('Fleet renewal');
}

/** Opens *More filters*, where the custom-field filters are (issue #1505), unless it is open. */
function openMoreFilters(): void {
  const toggle = screen.queryByRole('button', { name: /^More filters/ });
  if (toggle && toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
}

async function chooseSmb(): Promise<void> {
  openMoreFilters();
  fireEvent.click(await screen.findByRole('button', { name: 'Segment' }));
  fireEvent.click(screen.getByLabelText('Small business'));
}

describe('OpportunitiesList — custom-field filters', () => {
  it('offers the fields the offered-fields endpoint answers', async () => {
    await renderList();
    openMoreFilters();
    expect(await screen.findByRole('button', { name: 'Segment' })).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith(OFFERED_PATH);
  });

  it('sends a choice as a custom: reference in fieldFilters, never with cardValues', async () => {
    await renderList();
    await chooseSmb();
    await waitFor(() => expect(fieldFiltersOf(lastQuery())).toEqual({ 'custom:segment': { in: ['smb'] } }));
    for (const query of listQueries()) expect(query.has('cardValues')).toBe(false);
  });

  it('returns to the first page when a filter changes', async () => {
    listAnswer = async (query) => page(query.has('cursor') ? null : 'c2');
    await renderList();
    fireEvent.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(lastQuery().get('cursor')).toBe('c2'));
    await chooseSmb();
    await waitFor(() => expect(fieldFiltersOf(lastQuery())).not.toBeNull());
    expect(lastQuery().has('cursor')).toBe(false);
  });

  it('writes cf.* into the address, other parameters kept', async () => {
    await renderList('/crm/opportunities?tab=x');
    await chooseSmb();
    await waitFor(() => expect(address().getAll('cf.segment.in')).toEqual(['smb']));
    expect(address().get('tab')).toBe('x');
  });

  it('applies the filters an address carries on the first request', async () => {
    await renderList('/crm/opportunities?cf.segment.in=ent');
    expect(fieldFiltersOf(listQueries()[0]!)).toEqual({ 'custom:segment': { in: ['ent'] } });
  });

  it('reports an unavailable filter by its name and removes it on request (FR-011a)', async () => {
    listAnswer = async (query) => {
      if (query.has('fieldFilters')) {
        throw new ApiError(400, {
          error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE' as never, message: 'refused', details: { key: 'gone', keys: ['gone'] } },
        });
      }
      return page(null);
    };
    renderCrm(
      <StrictMode>
        <OpportunitiesList />
        <Address />
      </StrictMode>,
      { path: '/crm/opportunities?cf.gone.in=x' },
    );
    const alert = await screen.findByText('The filter “gone” is no longer available on this list.');
    expect(screen.queryByText(/CUSTOM_FIELD_FILTER_UNAVAILABLE/)).toBeNull();
    fireEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Remove this filter' }));
    await screen.findByText('Fleet renewal');
    expect(lastQuery().has('fieldFilters')).toBe(false);
    expect(address().has('cf.gone.in')).toBe(false);
  });

  it('names an offered field by its label', async () => {
    listAnswer = async (query) => {
      if (query.has('fieldFilters')) {
        throw new ApiError(400, {
          error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE' as never, message: 'refused', details: { key: 'segment', keys: ['segment'] } },
        });
      }
      return page(null);
    };
    renderCrm(
      <StrictMode>
        <OpportunitiesList />
      </StrictMode>,
      { path: '/crm/opportunities?cf.segment.in=smb' },
    );
    expect(await screen.findByText('The filter “Segment” is no longer available on this list.')).toBeInTheDocument();
  });

  it('renders a markup-bearing refused key as truncated text (threat model F-5)', async () => {
    const key = `<img src=x onerror="window.__xss=1">${'a'.repeat(80)}`;
    listAnswer = async (query) => {
      if (query.has('fieldFilters')) {
        throw new ApiError(400, {
          error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE' as never, message: 'refused', details: { key, keys: [key] } },
        });
      }
      return page(null);
    };
    renderCrm(
      <StrictMode>
        <OpportunitiesList />
      </StrictMode>,
      { path: '/crm/opportunities?cf.segment.in=smb' },
    );
    const shown = `${key.slice(0, 64)}…`;
    expect(await screen.findByText(`The filter “${shown}” is no longer available on this list.`)).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
    expect((window as { __xss?: unknown }).__xss).toBeUndefined();
  });

  describe('review round', () => {
    const refuseSegment = async (query: URLSearchParams): Promise<unknown> => {
      if (query.has('fieldFilters')) {
        throw new ApiError(400, {
          error: { code: 'CUSTOM_FIELD_FILTER_UNAVAILABLE' as never, message: 'refused', details: { key: 'segment', keys: ['segment'] } },
        });
      }
      return page(null);
    };

    it('clears a refusal once a later request succeeds', async () => {
      listAnswer = refuseSegment;
      renderCrm(
        <StrictMode>
          <OpportunitiesList />
        </StrictMode>,
        { path: '/crm/opportunities?cf.segment.in=smb' },
      );
      await screen.findByText('The filter “Segment” is no longer available on this list.');
      listAnswer = async () => page(null);
      // The search request follows a 300 ms typing pause: step over it rather
      // than wait it out, which a loaded runner stretches towards the test
      // timeout. Fake timers go in only after the first render settled on real
      // ones, and follow the wall clock so the `waitFor` below still polls.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      fireEvent.change(screen.getByLabelText(/search/i), { target: { value: 'fleet' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await waitFor(() =>
        expect(screen.queryByText('The filter “Segment” is no longer available on this list.')).toBeNull(),
      );
    });

    it('drops an option the field no longer has from the address', async () => {
      await renderList('/crm/opportunities?cf.segment.in=smb&cf.segment.in=removed');
      await waitFor(() => expect(address().getAll('cf.segment.in')).toEqual(['smb']));
      expect(fieldFiltersOf(lastQuery())).toEqual({ 'custom:segment': { in: ['smb'] } });
    });

    it('reads the list once under StrictMode when the address carries a filter', async () => {
      await renderList('/crm/opportunities?cf.segment.in=smb');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(listQueries()).toHaveLength(1);
    });

    it('shows the server’s sentence, never its code, for an inverted range in the address', async () => {
      getSpy.mockImplementation((path: string) => {
        if (path === OFFERED_PATH) {
          return Promise.resolve({
            data: [SEGMENT, { key: 'amount', valueType: 'number', label: { en: 'Amount' }, labelDefault: 'Amount', options: [] }],
          });
        }
        if (path.startsWith(`${LIST_PATH}?`) && decodeURIComponent(path).includes('custom:amount')) {
          return Promise.reject(new ApiError(400, { error: { code: 'VALIDATION_FAILED' as never, message: 'Request failed validation.' } }));
        }
        if (path === LIST_PATH || path.startsWith(`${LIST_PATH}?`)) return Promise.resolve(page(null));
        if (path === '/api/v1/admin/crm/workflow') return Promise.resolve({ data: WORKFLOW });
        const lookup = crmLookupResponse(path);
        if (lookup) return lookup;
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
      renderCrm(
        <StrictMode>
          <OpportunitiesList />
        </StrictMode>,
        { path: '/crm/opportunities?cf.amount.min=10&cf.amount.max=1' },
      );
      expect(await screen.findByText(/Request failed validation\./)).toBeInTheDocument();
      expect(screen.queryByText(/VALIDATION_FAILED/)).toBeNull();
    });

    it('moves focus to the results once a refused filter is removed', async () => {
      listAnswer = refuseSegment;
      renderCrm(
        <StrictMode>
          <OpportunitiesList />
        </StrictMode>,
        { path: '/crm/opportunities?cf.segment.in=smb' },
      );
      await screen.findByText('The filter “Segment” is no longer available on this list.');
      listAnswer = async () => page(null);
      fireEvent.click(screen.getByRole('button', { name: 'Remove this filter' }));
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    });

    it('has no axe violations with a refusal on screen', async () => {
      listAnswer = refuseSegment;
      const { container } = renderCrm(
        <StrictMode>
          <OpportunitiesList />
        </StrictMode>,
        { path: '/crm/opportunities?cf.segment.in=smb' },
      );
      await screen.findByText('The filter “Segment” is no longer available on this list.');
      await expectNoAxeViolations(container);
    });

    it('speaks Polish: the refusal and its remove action', async () => {
      listAnswer = refuseSegment;
      renderCrm(
        <StrictMode>
          <OpportunitiesList />
        </StrictMode>,
        { path: '/crm/opportunities?cf.segment.in=smb', language: 'pl' },
      );
      expect(await screen.findByText('Filtr „Segment” nie jest już dostępny na tej liście.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Usuń ten filtr' })).toBeInTheDocument();
    });
  });
});
